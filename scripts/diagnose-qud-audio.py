"""Opt-in local QUD acoustic diagnosis, preserving all previous measurements.

Without --execute this prints a preparation inventory and makes no requests.
Audio/Parquet are never written into the repository. Plots remain local only.
The retained v1 evidence is read-only; v2_numeric_candidate is not publication.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error

import duckdb
import numpy as np

from lib.acoustic_diagnostics import (additional_metrics, drift_diagnostics,
                                      encoded_interior_identity, interior_pcm_match, log_mel, rms_envelope)
from lib.hf_serial_ranges import SerialTransport, download, range_proxy, safe_response_text


spec = importlib.util.spec_from_file_location('retained_offset_auditor', Path(__file__).with_name('verify-qud-offsets.py'))
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)
PROHIBITED_HOSTS = {'youtube.com', 'www.youtube.com', 'youtu.be', 'music.youtube.com'}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def validate_resume(report, catalog_sha, original_sha, calculator):
    if report.get('catalog_sha256') != catalog_sha or report.get('original_evidence_sha256') != original_sha:
        raise ValueError('RESUME_INPUT_SHA_MISMATCH')
    if report.get('calculator') != calculator:
        raise ValueError('RESUME_CALCULATOR_SHA_MISMATCH; preserve_history_then_use_new_report_for_full_audit')


def error_status(error, phase):
    network_failure = isinstance(error, urllib.error.URLError) or isinstance(error, duckdb.HTTPException)
    decode_failure = (phase in ('decode_catalog_source', 'decode_hf_clip') and
                      (isinstance(error, subprocess.TimeoutExpired) or
                       isinstance(error, ValueError) and str(error) == 'AUDIO_DECODE_FAILED'))
    return 'source_unavailable' if network_failure or decode_failure else 'diagnostic_error'


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def v2_numeric_acceptance(row):
    envelope, vad = row.get('envelope', {}), row.get('vad', {})
    score, lag = envelope.get('score'), envelope.get('best_lag_ms')
    agreement, duration = vad.get('agreement'), row.get('duration_difference_ms')
    return (envelope.get('measured') is True and all(finite_number(value) for value in (score, lag, agreement, duration))
            and score >= .90 and agreement >= .90 and abs(lag) <= 30 and 0 <= duration <= 30)


def direct_source_allowed(record, url):
    from urllib.parse import urlparse
    parsed = urlparse(url)
    host = parsed.hostname or ''
    return (record['channel'] != 'youtube' and parsed.scheme == 'https'
            and host not in PROHIBITED_HOSTS and not host.endswith('.youtube.com')
            and not host.endswith('.googlevideo.com') and not parsed.username and not parsed.password)


def hf_rows(files, pairs, transport):
    """Explicit HF audit source, including the supplied segment intervals."""
    condition = ' OR '.join(f'(surah={surah} AND ayah={ayah})' for surah, ayah in pairs)
    chapters = sorted({surah for surah, _ in pairs})
    connection = duckdb.connect()
    try:
        connection.execute('SET threads=1; SET http_retries=0; SET http_timeout=120;')
        with range_proxy(files, transport) as urls:
            metadata = connection.execute("SELECT file_name,stats_min,stats_max FROM parquet_metadata(?) WHERE path_in_schema='surah'", [urls]).fetchall()
            candidates = {url for url, low, high in metadata if low is None or high is None or any(int(low) <= chapter <= int(high) for chapter in chapters)}
            selected = [url for url in urls if url in candidates]
            if not selected:
                return {}
            predicate = ','.join(map(str, chapters))
            rows = connection.execute(f'SELECT surah,ayah,audio.bytes,duration_ms,source_offset_ms,segments,word_timestamps FROM read_parquet(?) WHERE surah IN ({predicate}) AND ({condition})', [selected]).fetchall()
            return {(row[0], row[1]): row[2:] for row in rows}
    finally:
        connection.close()


def sample_distribution(samples, proof=None):
    """Enforce inherited D2 policy: 3 surahs, five fixed distributed ayahs each."""
    pairs = [(row.get('surah'), row.get('ayah')) for row in samples]
    if any(not isinstance(surah, int) or not isinstance(ayah, int) or surah <= 0 or ayah <= 0 for surah, ayah in pairs):
        return {'verified': False, 'reason': 'positive_surah_ayah_ids_required'}
    if len(set(pairs)) != len(pairs):
        return {'verified': False, 'reason': 'duplicate_sample_pairs'}
    if len(pairs) < 5:
        return {'verified': False, 'reason': 'fewer_than_five_unique_samples'}
    grouped = defaultdict(list)
    for surah, ayah in pairs:
        grouped[surah].append(ayah)
    if len(grouped) < 3 or any(len(ayahs) < 5 for ayahs in grouped.values()):
        return {'verified': False, 'reason': 'three_chapters_with_five_samples_each_required'}
    if proof is None:
        return {'verified': False, 'reason': 'observed_verse_distribution_proof_required'}
    if len({proof.get(str(surah), {}).get('observed_ayah_count') for surah in grouped}) < 3:
        return {'verified': False, 'reason': 'three_distinct_observed_chapter_lengths_required'}
    for surah, ayahs in grouped.items():
        expected = proof.get(str(surah), {}).get('fixed_distributed_ayahs')
        if not expected or sorted(ayahs) != expected:
            return {'verified': False, 'reason': 'sample_pairs_differ_from_observed_fixed_quintiles'}
    return {'verified': True, 'unique_sample_count': len(pairs), 'chapter_count': len(grouped),
            'policy': '3_chapters_with_5_fixed_distributed_ayahs; beginning_quartiles_middle_end', 'chapters': proof}


def distribution_proof(cache, slug, samples):
    target_chapters = {row['surah'] for row in samples}
    available = defaultdict(set)
    payload = (cache / f'{slug}.recited.jsonl').read_bytes()
    for line in payload.decode('utf-8').splitlines():
        row = json.loads(line)
        if row['surah'] in target_chapters and row['ayah'] > 0:
            available[row['surah']].add(row['ayah'])
    proof = {}
    for surah, values in available.items():
        ayahs = sorted(values)
        if len(ayahs) >= 5:
            proof[str(surah)] = {'observed_ayah_count': len(ayahs), 'first_observed_ayah': ayahs[0],
                                 'last_observed_ayah': ayahs[-1],
                                 'fixed_distributed_ayahs': [ayahs[round(index * (len(ayahs) - 1) / 4)] for index in range(5)],
                                 'annotation_cache_sha256': sha(payload)}
    return proof


def classify(samples, distribution=None, source_matches_retained=None):
    if not samples:
        return {'pattern': 'unresolved', 'reason': 'no_real_audio_measurements', 'v2_eligible': False}
    distribution = sample_distribution(samples, distribution)
    trends = drift_diagnostics(samples)
    if any(row['increasing_drift_evidence'] for row in trends):
        return {'pattern': 'increasing_drift', 'reason': 'within_chapter_reliable_lag_trend',
                'lag_trends': trends, 'v2_eligible': False, 'next_path': 'D5'}
    reliable = [row['envelope']['best_lag_ms'] for row in samples if row['envelope'].get('measured') and row['envelope']['score'] >= .9]
    if len(reliable) == len(samples) and np.ptp(reliable) <= 20 and all(abs(lag) > 30 for lag in reliable):
        return {'pattern': 'constant_lag', 'reason': 'reliable_envelope_lags_all_outside_acceptance',
                'lag_median_ms': float(np.median(reliable)), 'lag_range_ms': float(np.ptp(reliable)),
                'lag_trends': trends, 'v2_eligible': False, 'next_path': 'D5'}
    identity_proven = all(row['encoded_identity']['proven'] for row in samples)
    position_proven = all(row.get('interior_pcm', {}).get('measured') is True
                          and finite_number(row['interior_pcm'].get('score')) and row['interior_pcm']['score'] >= .95
                          and finite_number(row['interior_pcm'].get('interior_duration_ms'))
                          and row['interior_pcm']['interior_duration_ms'] >= 800 for row in samples)
    old_source_proven = (source_matches_retained is not None and
                         all(source_matches_retained.get(str(row['surah'])) is True for row in samples))
    envelope_aligned = all(row['envelope'].get('measured') is True and finite_number(row['envelope'].get('score'))
                           and finite_number(row['envelope'].get('best_lag_ms')) and row['envelope']['score'] >= .9
                           and abs(row['envelope']['best_lag_ms']) <= 30 for row in samples)
    spectral_agreement = all(row['log_mel'].get('measured') is True and finite_number(row['log_mel'].get('score'))
                             and row['log_mel']['score'] >= .9 for row in samples)
    if identity_proven and position_proven and old_source_proven and envelope_aligned:
        eligible = all(v2_numeric_acceptance(row) for row in samples) and spectral_agreement and distribution['verified']
        return {'pattern': 'codec_processing_only', 'reason': 'all_encoded_interiors_are_exact_contiguous_source_copies_with_aligned_envelope',
                'lag_trends': trends, 'v2_eligible': eligible,
                'v2_extra_identity_evidence': 'contiguous_encoded_interior_copy_each_sample',
                'v2_source_position_evidence': 'fixed_200ms_trim_interior_PCM_NCC_ge_0.95; min_800ms; no_lag_search',
                'sample_distribution': distribution, 'retained_source_hashes_match': old_source_proven,
                'v2_extra_log_mel_gate_passed': spectral_agreement,
                'v2_blockers': sorted({reason for row in samples for reason, condition in (
                    ('envelope_below_0.90', not row['envelope'].get('measured') or row['envelope'].get('score', 0) < .9),
                    ('vad_agreement_below_0.90_or_unavailable', row['vad'].get('agreement') is None or row['vad']['agreement'] < .9),
                    ('duration_difference_above_30ms', row['duration_difference_ms'] > 30),
                    ('log_mel_below_0.90_or_unavailable', not row['log_mel'].get('measured') or row['log_mel'].get('score', 0) < .9)) if condition})}
    # A poor feature score is not, by itself, proof of another recording.
    source_reason = ('unproven_old_source' if source_matches_retained is None or
                     any(source_matches_retained.get(str(row['surah'])) is None for row in samples)
                     else 'source_changed_since_v1' if not old_source_proven else 'insufficient_position_or_identity_evidence')
    return {'pattern': 'unresolved', 'reason': source_reason,
            'sample_distribution': distribution, 'retained_source_hashes_match': old_source_proven,
            'lag_trends': trends, 'v2_eligible': False, 'next_path': 'D5_or_further_read_only_diagnosis'}


def overlay_plot(folder, slug, sample, source, clip):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    center = round(sample['source_offset_ms'] * v1.RATE / 1000)
    lag = sample['envelope'].get('best_lag_ms', 0)
    actual = center + round(lag * v1.RATE / 1000)
    matched = source[max(0, actual):max(0, actual) + len(clip)]
    length = min(len(matched), len(clip))
    times = np.arange(length) * 1000 / v1.RATE
    figure, axes = plt.subplots(3, 1, figsize=(12, 8))
    for signal, label in ((matched[:length], 'catalog source at best envelope lag'), (clip[:length], 'HF audit clip')):
        peak = max(float(np.max(np.abs(signal))), 1e-12)
        axes[0].plot(times[::8], signal[::8] / peak, alpha=.55, label=label)
        axes[1].plot(np.arange(len(rms_envelope(signal))), rms_envelope(signal), alpha=.75, label=label)
    axes[0].set_xlim(0, min(1500, times[-1]))
    axes[0].set_ylabel('Normalized PCM')
    axes[1].set_ylabel('20ms RMS envelope')
    source_feature = rms_envelope(matched[:length])
    clip_feature = rms_envelope(clip[:length])
    axes[2].plot(np.arange(len(source_feature)), source_feature - clip_feature, color='darkred')
    axes[2].set_ylabel('Envelope difference')
    for axis in axes:
        axis.set_xlabel('Time in audit clip (ms)')
        axis.grid(alpha=.2)
    axes[0].legend(fontsize=8)
    figure.suptitle(f"{slug} / {sample['surah']}:{sample['ayah']} / envelope lag {lag:.3f}ms")
    figure.tight_layout()
    path = folder / f'{slug}.png'
    figure.savefig(path, dpi=150)
    plt.close(figure)
    return {'path': str(path), 'sha256': sha(path.read_bytes()), 'local_only': True}


def audit_record(record, previous, manifest, args, transport):
    slug = record['slug']
    evidence = {'config': slug, 'channel': record['channel'], 'provider': record['channel'],
                'audio_category': record['audio_category'], 'style': record['style'], 'riwayah': record['riwayah'],
                'original_v1_status': previous['verification_status'], 'samples': [], 'source_sha256': {},
                'retained_catalog_source_sha256': previous.get('catalog_source_sha256', {}),
                'catalog_source_matches_retained': {},
                'started_at': datetime.now(timezone.utc).isoformat()}
    pairs = [(row['surah'], row['ayah']) for row in previous['samples']]
    if not pairs:
        evidence.update(status='source_unavailable', reason='original_source_unavailable; alternative_source_check_required')
        return evidence
    proof = distribution_proof(Path(args.cache), slug, previous['samples'])
    verified_distribution = sample_distribution(previous['samples'], proof)
    evidence['sample_distribution'] = verified_distribution
    if not verified_distribution['verified']:
        evidence.update(status='diagnostic_error', reason='RETAINED_SAMPLE_DISTRIBUTION_NOT_VERIFIED', needs_review=True)
        return evidence
    folder = Path(tempfile.mkdtemp(prefix='ayahx-d3-acoustic-'))
    evidence.update(scratch_dir=str(folder), manual_cleanup_required=True, audio_scratch_deleted=False,
                    retention_reason='automatic_cleanup_disabled_after_command_policy_rejection; no_alternative_deletion')
    phase = 'fetch_hf'
    try:
        files = [row['url'] for row in manifest['parquet_files'] if row['config'] == slug and row['split'] == 'train']
        rows = hf_rows(files, pairs, transport)
        if any(pair not in rows or not rows[pair][0] for pair in pairs):
            evidence.update(status='source_unavailable', reason='hf_parquet_missing_retained_sample')
            return evidence
        grouped = defaultdict(list)
        for row in previous['samples']:
            grouped[row['surah']].append(row)
        plot_sample = min(previous['samples'], key=lambda row: row['source_offset_hypothesis'].get('score', 1))
        for surah, old_samples in sorted(grouped.items()):
            url = record['audio']['chapter_urls'][str(surah)]
            if not direct_source_allowed(record, url):
                evidence.update(status='source_unavailable', reason='prohibited_or_non_direct_source; no_extraction_attempt')
                return evidence
            source_path = folder / f'{surah}.audio'
            phase = 'download_catalog_source'
            download(transport, url, source_path)
            source_bytes = source_path.read_bytes()
            phase = 'decode_catalog_source'
            source = v1.decode(args.ffmpeg, source_path)
            evidence['source_sha256'][str(surah)] = sha(source_bytes)
            retained_source_sha = previous.get('catalog_source_sha256', {}).get(str(surah))
            evidence['catalog_source_matches_retained'][str(surah)] = (sha(source_bytes) == retained_source_sha) if retained_source_sha else None
            phase = 'calculate_source_features'
            source_features = {'envelope': rms_envelope(source), 'log_mel': log_mel(source)}
            for old in old_samples:
                surah, ayah = old['surah'], old['ayah']
                payload, duration, offset, segments, words = rows[(surah, ayah)]
                clip_path = folder / f'clip-{surah}-{ayah}.mp3'
                clip_path.write_bytes(payload)
                phase = 'decode_hf_clip'
                clip = v1.decode(args.ffmpeg, clip_path)
                phase = 'calculate_sample_metrics'
                sample = additional_metrics(source, clip, offset, duration, segments, source_features)
                sample.update(surah=surah, ayah=ayah, source_offset_ms=offset, hf_duration_ms=duration,
                              hf_audio_sha256=sha(payload), original_hf_audio_sha256=old['hf_audio_sha256'],
                              same_hf_payload_as_original=sha(payload) == old['hf_audio_sha256'],
                              same_hf_metadata_as_original=offset == old['source_offset_ms'] and duration == old['duration_ms'],
                              v1_original=old['source_offset_hypothesis'], v1_remeasured=v1.compare(source, clip, offset, duration),
                              encoded_identity=encoded_interior_identity(source_bytes, payload),
                              supplied_segments_sha256=sha(json.dumps(segments, separators=(',', ':')).encode()),
                              word_timestamp_count=len(words), segment_count=len(segments))
                if sample['envelope'].get('measured'):
                    sample['interior_pcm'] = interior_pcm_match(source, clip, sample['envelope']['source_sample_start'])
                else:
                    sample['interior_pcm'] = {'measured': False, 'passed': False, 'reason': 'source_position_unmeasured'}
                evidence['samples'].append(sample)
                if slug in args.plot_config and (surah, ayah) == (plot_sample['surah'], plot_sample['ayah']):
                    evidence['overlay_plot'] = overlay_plot(args.plot_dir, slug, sample, source, clip)
            del source_features, source, source_bytes
        evidence.update(status='measured', classification=classify(evidence['samples'], proof,
                                                                  evidence['catalog_source_matches_retained']))
        evidence['all_hf_payloads_match_retained'] = all(row['same_hf_payload_as_original'] and row['same_hf_metadata_as_original'] for row in evidence['samples'])
        if not evidence['all_hf_payloads_match_retained']:
            evidence['classification']['v2_eligible'] = False
            evidence['classification']['v2_blocked_reason'] = 'HF_rolling_snapshot_changed_from_retained_v1'
        return evidence
    except (urllib.error.URLError, OSError, ValueError, TypeError, KeyError, ArithmeticError,
            subprocess.TimeoutExpired, duckdb.Error) as error:
        evidence.update(status=error_status(error, phase),
                        reason=type(error).__name__, error_phase=phase, needs_review=True,
                        error_detail=safe_response_text(str(error).encode())[:2000],
                        http_status=getattr(error, 'code', None))
        return evidence
    finally:
        resolved = folder.resolve()
        if not resolved.is_relative_to(Path(tempfile.gettempdir()).resolve()) or not resolved.name.startswith('ayahx-d3-acoustic-'):
            raise ValueError('OWNED_SCRATCH_PATH_VALIDATION_FAILED')
        evidence.update(audio_scratch_deleted=False, manual_cleanup_required=True,
                        finished_at=datetime.now(timezone.utc).isoformat())


def main():
    parser = argparse.ArgumentParser()
    for option in ('catalog', 'manifest', 'original-evidence', 'cache', 'ffmpeg', 'report'):
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--config', action='append', default=[])
    parser.add_argument('--plot-config', action='append', default=[])
    parser.add_argument('--plot-dir', type=Path)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    catalog_bytes, original_bytes = Path(args.catalog).read_bytes(), Path(args.original_evidence).read_bytes()
    catalog, original = json.loads(catalog_bytes), json.loads(original_bytes)
    manifest = json.loads(Path(args.manifest).read_bytes())
    records = [row for row in catalog['recitations'] if original['results'][row['slug']]['verification_status'] == 'failed'
               and (not args.config or row['slug'] in args.config)]
    if not args.execute:
        print(json.dumps({'preparation_only': True, 'network_requests': 0, 'configs': [row['slug'] for row in records]}))
        return
    if args.plot_config:
        if not args.plot_dir or not args.plot_dir.is_absolute() or args.plot_dir.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
            raise ValueError('LOCAL_PLOT_DIRECTORY_OUTSIDE_REPOSITORY_REQUIRED')
        args.plot_dir.mkdir(parents=True, exist_ok=True)
    target = Path(args.report)
    calculator = {'method_version': 'B-v2-diagnostics-gridfix-1', 'script_sha256': sha(Path(__file__).read_bytes()),
                  'kernel_sha256': sha(Path(__file__).with_name('lib').joinpath('acoustic_diagnostics.py').read_bytes()),
                  'retained_v1_calculator_sha256': sha(Path(__file__).with_name('verify-qud-offsets.py').read_bytes())}
    report = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {
        'read_only': True, 'original_results_replaced': False, 'catalog_sha256': sha(catalog_bytes),
        'original_evidence_sha256': sha(original_bytes), 'results': {}, 'v2_automatically_published': False,
        'calculator': calculator}
    validate_resume(report, sha(catalog_bytes), sha(original_bytes), calculator)
    transport = SerialTransport()
    for record in records:
        previous = report['results'].get(record['slug'])
        if previous and previous['status'] == 'measured':
            continue
        if previous:
            # The next retry window is an explicit new invocation >=30min later.
            attempts = previous.get('attempts', [])
            if len(attempts) >= 3 or time.time() - attempts[-1]['finished_epoch'] < 1800:
                continue
        result = audit_record(record, original['results'][record['slug']], manifest, args, transport)
        result['attempts'] = (previous.get('attempts', []) if previous else []) + [
            {'finished_epoch': time.time(), 'status': result['status'], 'reason': result.get('reason')}]
        report['results'][record['slug']] = result
        report.update(checked_at=datetime.now(timezone.utc).isoformat(), transport_stats=transport.stats,
                      status_counts=dict(Counter(row['status'] for row in report['results'].values())))
        checkpoint = target.with_suffix(target.suffix + '.tmp')
        checkpoint.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        checkpoint.replace(target)
        print(json.dumps({'config': record['slug'], 'status': result['status'],
                          'pattern': result.get('classification', {}).get('pattern'),
                          'sample_count': len(result['samples'])}), flush=True)
        if result['status'] == 'diagnostic_error':
            raise SystemExit('DIAGNOSTIC_ERROR_REQUIRES_LOCAL_REVIEW; network_audit_stopped')


if __name__ == '__main__':
    main()
