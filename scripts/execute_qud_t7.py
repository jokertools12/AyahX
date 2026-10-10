"""Consume an immutable T7 selection. Default: inventory only, no network/audio/DB.

Root explicitly enables --execute --approved-t0-t6 after acceptance. Every output
is private and retained. No source selection, filesystem cleanup, database writes,
publication changes, or accelerated HTTP retries are implemented here.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import urllib.error

from lib.t7_offset_execution import (AuditRequestUnavailable, SingleWindowTransport,
    canonical, digest, download_once, evaluate_recitation, load_diagnostic_modules, measured_sample)
from lib.acoustic_diagnostics import log_mel, rms_envelope
from lib.hf_serial_ranges import safe_response_text

HF_INDEX = 'https://datasets-server.huggingface.co/parquet?dataset=QUD-Technologies/quranic-universal-ayahs'


def utc():
    return datetime.now(timezone.utc).isoformat()


def private_path(path):
    path = Path(path).resolve()
    if any((parent / '.git').exists() for parent in (path, *path.parents)):
        raise ValueError('PRIVATE_OUTPUT_OUTSIDE_ALL_GIT_CHECKOUTS_REQUIRED')
    return path


def checked_json(path, expected):
    data = Path(path).read_bytes()
    if not re.fullmatch('[a-f0-9]{64}', expected or '') or digest(data) != expected:
        raise ValueError('INPUT_FILE_SHA256_MISMATCH')
    return json.loads(data)


def locked_manifest(path, expected):
    manifest = checked_json(path, expected)
    proof = dict(manifest)
    signature = proof.pop('selection_sha256', None)
    if signature != digest(canonical(proof)):
        raise ValueError('MANIFEST_SELECTION_SHA256_MISMATCH')
    policy = manifest['comparison_policy']
    if (policy['trim_each_side_ms'] != 300 or policy['v1'] != {
            'NCC_min': .95, 'duration_difference_ms_max': 30, 'absolute_lag_ms_max': 30}
            or not policy['full_clip_duration_gate_is_untrimmed']
            or policy['hf_request_spacing_ms_min'] != 2000
            or policy['hf_retry_windows_max'] != 3 or policy['hf_retry_window_spacing_ms_min'] != 1800000
            or policy['v2'] != {'envelope_NCC_min': .9, 'VAD_agreement_min': .9,
                'duration_difference_ms_max': 30, 'absolute_lag_ms_max': 30,
                'extra_log_mel_score_min': .9, 'codec_cause_must_be_proven': True,
                'exact_contiguous_encoded_interior_copy_required': True, 'fixed_position_PCM_NCC_min': .95,
                'fixed_position_minimum_interior_ms': 800, 'retained_source_identity_must_be_proven': True,
                'drift_or_different_recording_never_eligible': True, 'numeric_pass_alone_not_accepted': True}):
        raise ValueError('UNAPPROVED_COMPARISON_POLICY')
    if set(manifest['results']) != set(manifest['boundary_cohort']).union(manifest['drive_retry_cohort']):
        raise ValueError('LOCKED_COHORT_MISMATCH')
    for slug, row in manifest['results'].items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+', slug):
            raise ValueError('UNSAFE_MANIFEST_CONFIG_ID')
        if row['channel'] == 'youtube':
            raise ValueError('YOUTUBE_PROHIBITED')
        if row['state'] == 'prepared':
            pairs = {(item['surah'], item['ayah']) for item in row['samples']}
            if (any(not isinstance(value, int) or isinstance(value, bool) or value <= 0 for pair in pairs for value in pair)
                    or len(pairs) != len(row['samples']) or pairs.intersection(map(tuple, row['retained_excluded_pairs']))):
                raise ValueError('LOCKED_NEW_SAMPLE_IDS_INVALID')
            grouped = {chapter: sorted(ayah for surah, ayah in pairs if surah == chapter) for chapter, _ in pairs}
            distribution = row['distribution_proof']
            if (len(grouped) < 3 or any(len(ayahs) < 5 or distribution.get(str(chapter), {}).get('fixed_distributed_ayahs') != ayahs
                    for chapter, ayahs in grouped.items())
                    or len({distribution.get(str(chapter), {}).get('observed_ayah_count') for chapter in grouped}) < 3):
                raise ValueError('LOCKED_DISTRIBUTION_INSUFFICIENT')
    return manifest


class Checkpoints:
    """Append-only, fsynced, self-hashed snapshots. Corruption stops, never falls back."""
    def __init__(self, directory, bindings):
        self.directory = private_path(directory)
        self.lock = threading.RLock()
        self.directory.mkdir(parents=True, exist_ok=True)
        entries = sorted(self.directory.glob('*.json'))
        self.sequence = len(entries)
        if entries:
            if [item.name for item in entries] != [f'{number:08d}.json' for number in range(1, len(entries) + 1)]:
                raise ValueError('CHECKPOINT_SEQUENCE_CORRUPT')
            value = json.loads(entries[-1].read_bytes())
            signature = value.pop('checkpoint_sha256', None)
            if digest(canonical(value)) != signature or value['bindings'] != bindings:
                raise ValueError('CHECKPOINT_CORRUPTION_OR_BINDING_MISMATCH_PRESERVE_ALL_FILES')
            self.state = value['state']
        else:
            self.state = {'started_at': utc(), 'results': {}, 'resources': {}, 'http_events': [],
                          'hf_index_windows': [], 'hf_blocked_until': 0, 'database_writes': 0,
                          'publication_changed': False, 'real_measurements_complete': False}
        self.bindings = bindings

    def save(self):
        with self.lock:
            value = {'bindings': self.bindings, 'state': self.state, 'sequence': self.sequence + 1}
            value['checkpoint_sha256'] = digest(canonical(value))
            self.sequence += 1
            target = self.directory / f'{self.sequence:08d}.json'
            with target.open('xb') as output:
                output.write(canonical(value) + b'\n')
                output.flush()
                os.fsync(output.fileno())
            return target

    def event(self, event):
        with self.lock:
            self.state['http_events'].append(event)
            self.state['hf_blocked_until'] = max(self.state['hf_blocked_until'], event.get('next_window_epoch', 0))
            self.save()


def start_hf_window(windows, now, blocked_until):
    if now < blocked_until or windows and now - windows[-1] < 1800:
        raise AuditRequestUnavailable('HF_RETRY_WINDOW_PENDING', 'hf', max(blocked_until, windows[-1] + 1800 if windows else 0))
    if len(windows) >= 3:
        raise AuditRequestUnavailable('HF_THREE_WINDOWS_EXHAUSTED', 'hf')
    windows.append(now)


def immutable_bytes(path, payload):
    if path.exists():
        if path.read_bytes() != payload:
            raise ValueError('RETAINED_FILE_DIFFERS_NO_OVERWRITE')
    else:
        with path.open('xb') as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())


def cached_resource(checkpoints, key, path):
    row = checkpoints.state['resources'].get(key)
    if row is None:
        return None
    if row['status'] != 'complete':
        raise AuditRequestUnavailable('RETAINED_SOURCE_ATTEMPT_NOT_COMPLETE_NO_AUTOMATIC_RETRY', row['phase'])
    payload = path.read_bytes()
    if digest(payload) != row['sha256'] or len(payload) != row['bytes']:
        raise ValueError('RETAINED_AUDIO_CACHE_CORRUPT')
    return payload


def source_resource(checkpoints, transport, url, scratch):
    transport.validate_url(url)  # Cached data never bypasses the current exact provider allowlist.
    key = 'public-source-' + digest(url.encode())
    target = scratch / (key + '.audio')
    cached = cached_resource(checkpoints, key, target)
    if cached is not None:
        return cached
    checkpoints.state['resources'][key] = {'status': 'attempt_started', 'phase': transport.phase, 'attempt_count': 1,
                                          'started_at': utc(), 'original_public_url_sha256': digest(url.encode())}
    checkpoints.save()  # Crash after this point consumes a Drive public-file attempt.
    result = download_once(transport, url, target)
    checkpoints.state['resources'][key].update(result, status='complete', completed_at=utc())
    checkpoints.save()
    return target.read_bytes()


def load_hf_index(args, checkpoints, transport, scratch):
    if args.hf_manifest:
        return checked_json(args.hf_manifest, args.hf_manifest_sha)
    key = 'hf-index'
    target = scratch / 'hf-parquet-index.json'
    row = checkpoints.state['resources'].get(key)
    if row and row['status'] == 'complete':
        return json.loads(cached_resource(checkpoints, key, target))
    start_hf_window(checkpoints.state['hf_index_windows'], time.time(), checkpoints.state['hf_blocked_until'])
    checkpoints.save()
    with transport.open(HF_INDEX) as response:
        payload = response.read(16 * 1024 * 1024 + 1)
    if len(payload) > 16 * 1024 * 1024:
        raise ValueError('HF_INDEX_SIZE_LIMIT')
    data = json.loads(payload)
    immutable_bytes(target, payload)
    checkpoints.state['resources'][key] = {'status': 'complete', 'phase': 'hf', 'sha256': digest(payload), 'bytes': len(payload)}
    checkpoints.save()
    return data


def fetch_locked_hf(slug, selection, index, checkpoints, transport, scratch, diagnosis):
    result = checkpoints.state['results'][slug]
    if 'hf_rows' in result:
        rows = {}
        for item in result['hf_rows']:
            path = scratch / item['clip_file']
            payload = path.read_bytes()
            if digest(payload) != item['clip_sha256']:
                raise ValueError('RETAINED_HF_CLIP_CORRUPT')
            rows[(item['surah'], item['ayah'])] = (payload, item['duration_ms'], item['source_offset_ms'], item['segments'])
        return rows
    start_hf_window(result.setdefault('hf_windows', []), time.time(), checkpoints.state['hf_blocked_until'])
    checkpoints.save()
    files = sorted(item['url'] for item in index['parquet_files'] if item['config'] == slug and item['split'] == 'train')
    if not files:
        raise AuditRequestUnavailable('HF_CONFIG_PARQUET_UNAVAILABLE', 'hf')
    pairs = [(row['surah'], row['ayah']) for row in selection['samples']]
    rows = diagnosis.hf_rows(files, pairs, transport)
    if transport.blocked_until > time.time():
        raise AuditRequestUnavailable('HF_RETRY_WINDOW_PENDING', 'hf', transport.blocked_until)
    if set(rows) != set(pairs):
        raise AuditRequestUnavailable('LOCKED_HF_SAMPLE_ROWS_UNAVAILABLE_NO_RESELECTION', 'hf')
    saved = []
    for (surah, ayah), row in sorted(rows.items()):
        payload, duration, offset, segments = row[:4]
        if not isinstance(payload, bytes) or not payload:
            raise AuditRequestUnavailable('HF_CLIP_UNAVAILABLE', 'hf')
        name = f'hf-{slug}-{surah}-{ayah}-{digest(payload)}.audio'
        immutable_bytes(scratch / name, payload)
        saved.append({'surah': surah, 'ayah': ayah, 'clip_file': name, 'clip_sha256': digest(payload),
                      'duration_ms': duration, 'source_offset_ms': offset, 'segments': segments})
    result['hf_rows'] = saved
    checkpoints.save()
    return {pair: row[:4] for pair, row in rows.items()}


def run_recitation(slug, selection, rows, checkpoints, source, scratch, diagnosis, v1, ffmpeg):
    result = checkpoints.state['results'][slug]
    complete = {(row['surah'], row['ayah']): row for row in result.setdefault('samples', [])}
    decoded, matches = {}, result.setdefault('source_matches_retained', {})
    if selection['channel'] == 'drive':
        if result.get('drive_attempt_started') and not result.get('drive_attempt_complete'):
            keys = {'public-source-' + digest(row['original_public_url'].encode()) for row in selection['samples']}
            if any(checkpoints.state['resources'].get(key, {}).get('status') != 'complete' for key in keys):
                raise AuditRequestUnavailable('DRIVE_RECITATION_ONCE_ATTEMPT_ALREADY_CONSUMED', 'drive')
        result['drive_attempt_started'] = True
        checkpoints.save()
    for sample in selection['samples']:
        pair = (sample['surah'], sample['ayah'])
        if pair in complete:
            continue
        url = sample['original_public_url']
        if url not in decoded:
            payload = source_resource(checkpoints, source, url, scratch)
            path = scratch / ('public-source-' + digest(url.encode()) + '.audio')
            signal = v1.decode(str(ffmpeg), path)
            decoded[url] = (payload, signal, {'envelope': rms_envelope(signal), 'log_mel': log_mel(signal)})
        payload, signal, features = decoded[url]
        source_hash = digest(payload)
        previous = selection['retained_catalog_source_sha256'].get(str(sample['surah']))
        matches[str(sample['surah'])] = source_hash == previous if previous else None
        clip_bytes, duration, offset, segments = rows[pair]
        name = f'hf-{slug}-{pair[0]}-{pair[1]}-{digest(clip_bytes)}.audio'
        clip = v1.decode(str(ffmpeg), scratch / name)
        measured = measured_sample(signal, clip, offset, duration, segments, payload, clip_bytes, v1, features)
        measured.update(surah=pair[0], ayah=pair[1], catalog_source_sha256=source_hash, hf_clip_sha256=digest(clip_bytes))
        result['samples'].append(measured)
        checkpoints.save()
    result.update(evaluate_recitation(result['samples'], selection, diagnosis, matches), completed_at=utc(),
                  reason='FIXED_MANIFEST_REAL_AUDIO_METRICS_REVIEW_REQUIRED', phase='complete')
    if selection['channel'] == 'drive':
        result['drive_attempt_complete'] = True
    checkpoints.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha', required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--approved-t0-t6', action='store_true')
    parser.add_argument('--source-hosts', type=Path)
    parser.add_argument('--source-hosts-sha')
    parser.add_argument('--hf-manifest', type=Path)
    parser.add_argument('--hf-manifest-sha')
    parser.add_argument('--scratch', type=Path)
    parser.add_argument('--checkpoints', type=Path)
    parser.add_argument('--ffmpeg', type=Path)
    parser.add_argument('--config', action='append', help='Execution partition only; never changes locked selections.')
    args = parser.parse_args()
    manifest = locked_manifest(args.manifest, args.manifest_sha)
    chosen = sorted(set(args.config or manifest['results']))
    if not set(chosen).issubset(manifest['results']):
        raise ValueError('CONFIG_OUTSIDE_LOCKED_COHORT')
    if not args.execute:
        print(json.dumps({'inventory_only': True, 'manifest_sha256': args.manifest_sha,
            'selection_sha256': manifest['selection_sha256'], 'recitations': len(chosen),
            'samples': sum(len(manifest['results'][slug]['samples']) for slug in chosen),
            'network_requests': 0, 'audio_measurements': 0, 'database_writes': 0}))
        return 0
    if not args.approved_t0_t6 or not all((args.source_hosts, args.source_hosts_sha, args.scratch, args.checkpoints, args.ffmpeg)):
        raise ValueError('ROOT_T0_T6_APPROVAL_AND_EXPLICIT_PRIVATE_INPUTS_REQUIRED')
    if not args.ffmpeg.is_file():
        raise ValueError('EXISTING_FFMPEG_REQUIRED')
    hosts = checked_json(args.source_hosts, args.source_hosts_sha)
    if (set(hosts) != set(manifest['results']) or any(not isinstance(value, list) or not value or
            any(not isinstance(host, str) or not re.fullmatch(r'[a-z0-9.-]+', host) for host in value) for value in hosts.values())):
        raise ValueError('EXACT_AUDIO_PROVIDERS_HOST_SNAPSHOT_REQUIRED_FOR_ALL_LOCKED_CONFIGS')
    if bool(args.hf_manifest) != bool(args.hf_manifest_sha):
        raise ValueError('HF_MANIFEST_SHA_REQUIRED')
    scripts = Path(__file__).resolve().parent
    bindings = {'manifest_file_sha256': args.manifest_sha, 'selection_sha256': manifest['selection_sha256'],
        'provider_hosts_sha256': args.source_hosts_sha, 'hf_index_file_sha256': args.hf_manifest_sha,
        'scratch': str(private_path(args.scratch)), 'ffmpeg_sha256': digest(args.ffmpeg.read_bytes()),
        'calculator_sha256': {name: digest((scripts / name).read_bytes()) for name in
            ('execute_qud_t7.py', 'lib/t7_offset_execution.py', 'diagnose-qud-audio.py', 'verify-qud-offsets.py',
             'lib/acoustic_diagnostics.py', 'lib/hf_serial_ranges.py')}}
    checkpoints = Checkpoints(args.checkpoints, bindings)
    scratch = private_path(args.scratch)
    scratch.mkdir(parents=True, exist_ok=True)
    diagnosis, v1 = load_diagnostic_modules()
    hf = SingleWindowTransport('hf', persist_event=checkpoints.event)
    hf.blocked_until = checkpoints.state['hf_blocked_until']
    index = load_hf_index(args, checkpoints, hf, scratch)
    # One shared Drive transport preserves spacing across recitations and redirects.
    drive = SingleWindowTransport('drive', persist_event=checkpoints.event)
    public = SingleWindowTransport('source', persist_event=checkpoints.event)
    for slug in chosen:
        selected = manifest['results'][slug]
        result = checkpoints.state['results'].setdefault(slug, {'verification_status': 'pending', 'history': []})
        if result['verification_status'] in ('passed', 'failed', 'source_unavailable', 'blocked'):
            continue
        if selected['state'] != 'prepared':
            result.update(verification_status='blocked', reason=selected['reason'])
            checkpoints.save()
            continue
        result['history'].append({'at': utc(), 'invocation_started_from_status': result['verification_status']})
        checkpoints.save()
        phase = 'hf'
        try:
            rows = fetch_locked_hf(slug, selected, index, checkpoints, hf, scratch, diagnosis)
            transport = drive if selected['channel'] == 'drive' else public
            transport.hosts = set(hosts[slug])
            phase = 'audio'
            run_recitation(slug, selected, rows, checkpoints, transport, scratch, diagnosis, v1, args.ffmpeg)
        except (urllib.error.URLError, diagnosis.duckdb.HTTPException, subprocess.TimeoutExpired) as error:
            pending = phase == 'hf' and (hf.blocked_until > time.time() or getattr(error, 'retry_at', None))
            code = getattr(error, 'audit_code', type(error).__name__)
            result.update(verification_status='pending_hf_window' if pending else 'source_unavailable',
                          reason=code, phase=phase, checked_at=utc())
            result['history'].append({'at': utc(), 'code': code, 'phase': phase, 'retry_at': getattr(error, 'retry_at', None)})
            checkpoints.save()
            print(json.dumps({'config': slug, 'status': result['verification_status'], 'code': code}), flush=True)
            if pending:
                break
        except ValueError as error:
            if str(error) != 'AUDIO_DECODE_FAILED':
                result.update(verification_status='diagnostic_error', phase=phase,
                              error_type=type(error).__name__, original_error_redacted=safe_response_text(str(error).encode()))
                checkpoints.save()
                raise
            result.update(verification_status='source_unavailable', reason='AUDIO_DECODE_FAILED', phase=phase)
            checkpoints.save()
        except Exception as error:
            result.update(verification_status='diagnostic_error', phase=phase, error_type=type(error).__name__,
                          original_error_redacted=safe_response_text(str(error).encode()))
            checkpoints.save()
            raise ValueError('UNEXPECTED_EXECUTOR_ERROR_REDACTED_IN_CHECKPOINT') from None
    all_results = checkpoints.state['results']
    checkpoints.state['real_measurements_complete'] = (set(all_results) == set(manifest['results']) and
        all(row['verification_status'] in ('passed', 'failed') for row in all_results.values()))
    checkpoints.state['last_invocation_at'] = utc()
    checkpoints.state['transport_statistics'] = {row.phase: row.stats for row in (hf, drive, public)}
    latest = checkpoints.save()
    counts = {status: sum(row['verification_status'] == status for row in all_results.values())
              for status in sorted({row['verification_status'] for row in all_results.values()})}
    print(json.dumps({'private_checkpoint': str(latest), 'counts': counts, 'database_writes': 0,
                      'publication_changed': False, 'acceptance_requires_root_review': True}), flush=True)
    return 0 if counts.get('passed') == len(manifest['results']) else 3 if any('pending' in value for value in counts) else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, urllib.error.URLError) as failure:
        # Raw exception strings can contain signed provider URLs. Emit only fixed codes.
        print(json.dumps({'stopped': True, 'error_type': type(failure).__name__,
            'code': str(failure) if isinstance(failure, ValueError) and re.fullmatch('[A-Z0-9_]+', str(failure))
                    else getattr(failure, 'audit_code', 'UNEXPECTED_EXECUTOR_ERROR'),
            'database_writes': 0}), flush=True)
        raise SystemExit(1)
