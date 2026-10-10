"""Opt-in HF segments-only replay evidence, after the main audio run stops.

No audio column is selected. Intervals retain their original types/coordinates.
An unavailable config is explicit; it never gains fabricated intervals.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
import urllib.error

import duckdb

from lib.hf_serial_ranges import SerialTransport, range_proxy, safe_response_text


SELECTED_FIELDS = ('surah', 'ayah', 'segments', 'duration_ms', 'source_offset_ms')


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def segment_sha(segments):
    # Same serialization as the retained diagnostic run. No type conversion.
    return sha(json.dumps(segments, separators=(',', ':')).encode())


def validate_complete(diagnosis, original, original_sha):
    if diagnosis.get('original_evidence_sha256') != original_sha:
        raise ValueError('ORIGINAL_EVIDENCE_SHA_MISMATCH')
    expected = {slug for slug, row in original['results'].items() if row['verification_status'] == 'failed'}
    results = diagnosis.get('results', {})
    if set(results) != expected:
        raise ValueError('MAIN_DIAGNOSIS_NOT_COMPLETE_NO_NETWORK_REQUESTED')
    if any(row.get('status') not in ('measured', 'source_unavailable') for row in results.values()):
        raise ValueError('MAIN_DIAGNOSTIC_ERROR_OR_UNKNOWN_STATUS_REQUIRES_REVIEW')
    return sorted(expected)


def select_sql(pairs):
    if (not pairs or len(set(pairs)) != len(pairs) or
            any(type(surah) is not int or type(ayah) is not int or surah <= 0 or ayah <= 0 for surah, ayah in pairs)):
        raise ValueError('UNIQUE_POSITIVE_INTEGER_SAMPLE_PAIRS_REQUIRED')
    chapters = ','.join(map(str, sorted({surah for surah, _ in pairs})))
    predicate = ' OR '.join(f'(surah={surah} AND ayah={ayah})' for surah, ayah in pairs)
    return f"SELECT {','.join(SELECTED_FIELDS)} FROM read_parquet(?) WHERE surah IN ({chapters}) AND ({predicate})"


def index_rows(rows):
    result = {}
    for surah, ayah, segments, duration, offset in rows:
        pair = (surah, ayah)
        if pair in result:
            raise ValueError('DUPLICATE_HF_SEGMENT_ROW')
        result[pair] = (segments, duration, offset)
    return result


def fetch_segments(files, pairs, transport):
    sql = select_sql(pairs)
    connection = duckdb.connect()
    try:
        connection.execute('SET threads=1; SET http_retries=0; SET http_timeout=120;')
        with range_proxy(files, transport) as urls:
            metadata = connection.execute(
                "SELECT file_name,stats_min,stats_max FROM parquet_metadata(?) WHERE path_in_schema='surah'", [urls]).fetchall()
            chapters = sorted({surah for surah, _ in pairs})
            candidates = {url for url, low, high in metadata if low is None or high is None or
                          any(int(low) <= chapter <= int(high) for chapter in chapters)}
            selected = [url for url in urls if url in candidates]
            return index_rows(connection.execute(sql, [selected]).fetchall()) if selected else {}
    finally:
        connection.close()


def sample_evidence(segments, duration, offset, retained):
    # Strict JSON cannot encode a nonfinite interval; do not replace its values.
    json.dumps(segments, allow_nan=False)
    current_sha = segment_sha(segments)
    hash_match = current_sha == retained['supplied_segments_sha256']
    metadata_match = duration == retained['hf_duration_ms'] and offset == retained['source_offset_ms']
    return {'segments': segments, 'supplied_segments_sha256': current_sha,
            'retained_segments_sha256': retained['supplied_segments_sha256'],
            'hash_matches_retained': hash_match, 'metadata_matches_retained': metadata_match,
            'duration_ms': duration, 'source_offset_ms': offset,
            'replay_input_verified': hash_match and metadata_match,
            'mismatch_reason': None if hash_match and metadata_match else 'HF_ROLLING_SNAPSHOT_MISMATCH_NO_HEAL'}


def validate_resume(report, identity):
    if report.get('identity') != identity:
        raise ValueError('SEGMENTS_REPLAY_RESUME_INPUT_OR_SCRIPT_SHA_MISMATCH')


def main():
    parser = argparse.ArgumentParser()
    for option in ('manifest', 'diagnosis', 'original-evidence', 'output'):
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--confirm-main-stopped', action='store_true')
    args = parser.parse_args()
    diagnosis_bytes = Path(args.diagnosis).read_bytes()
    original_bytes = Path(args.original_evidence).read_bytes()
    manifest_bytes = Path(args.manifest).read_bytes()
    diagnosis, original, manifest = map(json.loads, (diagnosis_bytes, original_bytes, manifest_bytes))
    if not args.execute:
        print(json.dumps({'preparation_only': True, 'network_requests': 0, 'audio_bytes_requested': False,
                          'selected_fields': SELECTED_FIELDS,
                          'diagnosis_records': len(diagnosis.get('results', {})),
                          'expected_failed_configs': sum(row['verification_status'] == 'failed' for row in original['results'].values())}))
        return
    if not args.confirm_main_stopped:
        raise SystemExit('MAIN_RUN_STOP_CONFIRMATION_REQUIRED_NO_NETWORK_REQUESTED')
    targets = validate_complete(diagnosis, original, sha(original_bytes))
    identity = {'method_version': 'B-segments-only-replay-1', 'diagnosis_snapshot_sha256': sha(diagnosis_bytes),
                'original_evidence_sha256': sha(original_bytes), 'manifest_sha256': sha(manifest_bytes),
                'script_sha256': sha(Path(__file__).read_bytes()),
                'transport_sha256': sha(Path(__file__).with_name('lib').joinpath('hf_serial_ranges.py').read_bytes()),
                'diagnosis_calculator': diagnosis['calculator']}
    target = Path(args.output)
    report = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {
        'read_only': True, 'audio_bytes_requested': False, 'intervals_transformed': False,
        'selected_fields': SELECTED_FIELDS, 'identity': identity, 'samples': {}, 'configs': {},
        'target_config_count': len(targets)}
    validate_resume(report, identity)
    transport = SerialTransport()
    for slug in targets:
        prior = report['configs'].get(slug)
        if prior and prior['status'] in ('collected', 'skipped_no_retained_measured_segments'):
            continue
        if prior:
            attempts = prior['attempts']
            if len(attempts) >= 3 or time.time() - attempts[-1]['finished_epoch'] < 1800:
                continue
        inherited = diagnosis['results'][slug]
        checked_at = datetime.now(timezone.utc).isoformat()
        result = {'checked_at': checked_at, 'main_audio_status': inherited['status']}
        if inherited['status'] == 'source_unavailable':
            result.update(status='skipped_no_retained_measured_segments', reason=inherited.get('reason'),
                          source_scope='metadata_replay_unavailable_without_retained_segment_hashes')
        else:
            try:
                pairs = [(row['surah'], row['ayah']) for row in inherited['samples']]
                files = [row['url'] for row in manifest['parquet_files'] if row['config'] == slug and row['split'] == 'train']
                rows = fetch_segments(files, pairs, transport)
                exported = {}
                for retained in inherited['samples']:
                    pair = (retained['surah'], retained['ayah'])
                    if pair not in rows:
                        raise ValueError('HF_RETAINED_SAMPLE_SEGMENTS_MISSING')
                    exported[f'{pair[0]}:{pair[1]}'] = sample_evidence(*rows[pair], retained)
                report['samples'][slug] = exported
                result.update(status='collected', sample_count=len(exported),
                              all_replay_inputs_verified=all(row['replay_input_verified'] for row in exported.values()))
            except (urllib.error.URLError, OSError, ValueError, TypeError, KeyError, duckdb.Error) as error:
                result.update(status='source_unavailable' if isinstance(error, (urllib.error.URLError, duckdb.HTTPException)) else 'diagnostic_error',
                              reason=type(error).__name__, needs_review=True,
                              error_detail=safe_response_text(str(error).encode())[:2000], source_scope='HF_segments_metadata_only')
        result['attempts'] = (prior.get('attempts', []) if prior else []) + [
            {'finished_epoch': time.time(), 'status': result['status'], 'reason': result.get('reason')}]
        report['configs'][slug] = result
        report.update(checked_at=datetime.now(timezone.utc).isoformat(), transport_stats=transport.stats,
                      status_counts=dict(Counter(row['status'] for row in report['configs'].values())))
        checkpoint = target.with_suffix(target.suffix + '.tmp')
        checkpoint.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        checkpoint.replace(target)
        print(json.dumps({'config': slug, 'status': result['status'], 'sample_count': result.get('sample_count', 0),
                          'all_replay_inputs_verified': result.get('all_replay_inputs_verified')}), flush=True)
        if result['status'] == 'diagnostic_error':
            raise SystemExit('SEGMENTS_DIAGNOSTIC_ERROR_REQUIRES_REVIEW; network_audit_stopped')


if __name__ == '__main__':
    main()
