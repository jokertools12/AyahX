"""Independent, local-only checkpoint review. Never imports the live calculator.

Decode mode reads retained files, streams whole sources into selected PCM windows,
and emits only numeric/hash evidence. It neither creates nor removes audio files.
Supplied segment intervals are not retained by the current calculator, so their
VAD IoU cannot be independently replayed by this reviewer.
"""

import argparse
import hashlib
import json
import math
import subprocess
import threading
from collections import defaultdict
from pathlib import Path


RATE = 8000


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def numeric_gate(row):
    envelope, vad = row.get('envelope', {}), row.get('vad', {})
    score, lag = envelope.get('score'), envelope.get('best_lag_ms')
    agreement, duration = vad.get('agreement'), row.get('duration_difference_ms')
    return (envelope.get('measured') is True and all(finite(v) for v in (score, lag, agreement, duration))
            and score >= .9 and abs(lag) <= 30 and agreement >= .9 and 0 <= duration <= 30)


def boundary_support(source_count, clip_count, offset_ms, selected_start):
    """Expose EOF support on the 8k decoded clock, before packet-clock proof."""
    nominal_start = round(offset_ms * RATE / 1000)
    overrun = max(0, nominal_start + clip_count - source_count)
    latest = source_count - clip_count
    return {'source_decoded_sample_count': source_count, 'clip_decoded_sample_count': clip_count,
            'nominal_source_start_sample': nominal_start,
            'nominal_source_end_overrun_ms': overrun * 1000 / RATE,
            'selected_source_end_margin_ms': (source_count - selected_start - clip_count) * 1000 / RATE,
            'latest_complete_source_start_sample': latest,
            'selected_at_latest_complete_start': selected_start == latest,
            'nominal_interval_extends_source_EOF': overrun > 0,
            'causal_drift_requires_packet_clock_review': overrun > 0}


def mask_runs(mask):
    """Lossless half-open runs of speech frame indices; no PCM retained."""
    runs, start = [], None
    for index, value in enumerate(mask):
        if bool(value) and start is None:
            start = index
        if not bool(value) and start is not None:
            runs.append([start, index])
            start = None
    if start is not None:
        runs.append([start, len(mask)])
    return runs


def input_fingerprints(record):
    return {'config': record['config'], 'source_sha256': record['source_sha256'],
            'samples': [{'surah': row['surah'], 'ayah': row['ayah'],
                         'hf_audio_sha256': row['hf_audio_sha256'],
                         'source_offset_ms': row['source_offset_ms'], 'hf_duration_ms': row['hf_duration_ms'],
                         'supplied_segments_sha256': row['supplied_segments_sha256'],
                         'source_sample_start': row['envelope'].get('source_sample_start')}
                        for row in record['samples']]}


def lag_trends(rows):
    """Closed-form least squares per chapter, separate from calculator/polyfit."""
    grouped, trends = defaultdict(list), []
    for row in rows:
        metric = row.get('envelope', {})
        if metric.get('measured') is True and finite(metric.get('score')) and metric['score'] >= .9:
            if finite(row.get('source_offset_ms')) and finite(metric.get('best_lag_ms')):
                grouped[row['surah']].append((row['source_offset_ms'] / 1000, metric['best_lag_ms']))
    for surah, points in sorted(grouped.items()):
        if len(points) < 3:
            continue
        tx = sum(p[0] for p in points) / len(points)
        ly = sum(p[1] for p in points) / len(points)
        variance = sum((p[0] - tx) ** 2 for p in points)
        if variance == 0:
            continue
        slope = sum((x - tx) * (y - ly) for x, y in points) / variance
        change = abs(slope * (max(p[0] for p in points) - min(p[0] for p in points)))
        residuals = [y - (ly + slope * (x - tx)) for x, y in points]
        residual_mean = sum(residuals) / len(residuals)
        residual_std = math.sqrt(sum((r - residual_mean) ** 2 for r in residuals) / len(residuals))
        trends.append({'surah': surah, 'reliable_sample_count': len(points), 'slope_ms_per_second': slope,
                       'fitted_lag_change_ms': change, 'residual_std_ms': residual_std,
                       'observed_lag_range_ms': max(p[1] for p in points) - min(p[1] for p in points),
                       'increasing_drift_evidence': change > 30 and residual_std <= 10})
    return trends


def check_checkpoint(report, original, cache):
    errors, reviewed = [], []
    if report.get('read_only') is not True or report.get('original_results_replaced') is not False or report.get('v2_automatically_published') is not False:
        errors.append('report: read-only/original preservation/publication flags invalid')
    for slug, record in report['results'].items():
        if record['status'] != 'measured':
            continue
        prior = original['results'][slug]
        if prior.get('verification_status') != 'failed':
            errors.append(f'{slug}: baseline is not failed')
        rows = record['samples']
        old = {(r['surah'], r['ayah']): r for r in prior['samples']}
        pairs = [(r['surah'], r['ayah']) for r in rows]
        if set(pairs) != set(old) or len(pairs) != len(set(pairs)):
            errors.append(f'{slug}: retained pairs differ or duplicate')
        payload = (cache / f'{slug}.recited.jsonl').read_bytes()
        observed, cached_rows = defaultdict(set), {}
        for line in payload.decode('utf-8').splitlines():
            item = json.loads(line)
            observed[item['surah']].add(item['ayah'])
            cached_rows[(item['surah'], item['ayah'])] = item
        proof = record['classification'].get('sample_distribution', {}).get('chapters', {})
        distribution = len({len(observed[s]) for s, _ in pairs}) >= 3
        chapters = {s for s, _ in pairs}
        distribution &= len(chapters) >= 3 and len(pairs) >= 5
        for surah in chapters:
            available = sorted(observed[surah])
            expected = [available[round(k * (len(available) - 1) / 4)] for k in range(5)]
            actual = sorted(a for s, a in pairs if s == surah)
            distribution &= len(available) >= 5 and actual == expected
            supplied = proof.get(str(surah))
            if supplied and (supplied['fixed_distributed_ayahs'] != expected
                             or supplied['annotation_cache_sha256'] != hashlib.sha256(payload).hexdigest()):
                errors.append(f'{slug}/{surah}: cache distribution proof mismatch')
        if not distribution:
            errors.append(f'{slug}: actual cache distribution invalid')
        for row in rows:
            pair = row['surah'], row['ayah']
            before = old[pair]
            hf_match = row['hf_audio_sha256'] == before['hf_audio_sha256']
            metadata_match = (row['source_offset_ms'] == before['source_offset_ms']
                              and row['hf_duration_ms'] == before['duration_ms'])
            if not hf_match or not metadata_match or row['v1_original'] != before['source_offset_hypothesis']:
                errors.append(f'{slug}/{pair}: retained HF/v1 input mismatch')
            if row['same_hf_payload_as_original'] is not hf_match or row['same_hf_metadata_as_original'] is not metadata_match:
                errors.append(f'{slug}/{pair}: retained match booleans incorrect')
            if row['word_timestamp_count'] != len(cached_rows[pair]['word_timestamps']):
                errors.append(f'{slug}/{pair}: cached word count mismatch')
            if row['v2_numeric_candidate'] is not numeric_gate(row):
                errors.append(f'{slug}/{pair}: numeric gate mismatch')
        old_sources = prior.get('catalog_source_sha256', {})
        for chapter, current_hash in record['source_sha256'].items():
            expected = current_hash == old_sources[chapter] if old_sources.get(chapter) else None
            if record['catalog_source_matches_retained'].get(chapter) is not expected:
                errors.append(f'{slug}/{chapter}: source match boolean invalid')
        source_matches = all(old_sources.get(s) and value == old_sources[s]
                             for s, value in record['source_sha256'].items())
        numeric = all(numeric_gate(row) for row in rows)
        fixed_position = all(row.get('interior_pcm', {}).get('measured') is True
                             and finite(row['interior_pcm'].get('score')) and row['interior_pcm']['score'] >= .95
                             and finite(row['interior_pcm'].get('interior_duration_ms'))
                             and row['interior_pcm']['interior_duration_ms'] >= 800 for row in rows)
        spectral = all(row.get('log_mel', {}).get('measured') is True
                       and finite(row['log_mel'].get('score')) and row['log_mel']['score'] >= .9 for row in rows)
        identity = all(row.get('encoded_identity', {}).get('proven') is True for row in rows)
        if record['classification']['v2_eligible'] and not all((numeric, fixed_position, spectral, identity, source_matches, distribution)):
            errors.append(f'{slug}: declared eligible without all numeric/provenance gates')
        trends = lag_trends(rows)
        reported_trends = record['classification'].get('lag_trends', [])
        if len(trends) != len(reported_trends):
            errors.append(f'{slug}: chapter trend count mismatch')
        for trend, reported in zip(trends, reported_trends):
            for name, actual in trend.items():
                value = reported.get(name)
                equal = actual == value if isinstance(actual, (int, bool)) else finite(value) and math.isclose(actual, value, rel_tol=1e-7, abs_tol=1e-7)
                if not equal:
                    errors.append(f'{slug}/{trend["surah"]}: trend {name} mismatch')
        if any(t['increasing_drift_evidence'] for t in trends) and record['classification']['pattern'] != 'increasing_drift':
            errors.append(f'{slug}: demonstrated drift not classified')
        reviewed.append({'config': slug, 'sample_count': len(rows), 'distribution_replayed': bool(distribution),
                         'numeric_all_pass': numeric, 'fixed_position_all_pass': fixed_position,
                         'spectral_all_pass': spectral, 'encoded_all_proven': identity,
                         'source_hashes_match_retained': bool(source_matches),
                         'within_chapter_drift_replayed': True,
                         'pattern': record['classification']['pattern'],
                         'declared_v2_eligible': record['classification']['v2_eligible']})
    return {'errors': errors, 'reviewed': reviewed,
            'segments_IoU_replayed': False, 'segments_limitation': 'intervals unavailable; SHA/count alone do not permit replay'}


def decode_selected_sources(ffmpeg, path, bounds):
    """Decode complete file once, retain only complete requested windows + context."""
    import numpy as np
    command = [str(ffmpeg), '-nostdin', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ar', str(RATE), '-ac', '1', 'pipe:1']
    pieces = {key: [] for key in bounds}
    count = 0
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        stderr_size = [0]

        def drain_stderr():
            while True:
                error_chunk = process.stderr.read(4096)
                if not error_chunk:
                    return
                stderr_size[0] += len(error_chunk)

        stderr_reader = threading.Thread(target=drain_stderr)
        stderr_reader.start()
        while True:
            chunk = process.stdout.read(1024 * 1024)
            if not chunk:
                break
            pcm = np.frombuffer(chunk, dtype='<f4')
            for key, (start, end) in bounds.items():
                lo, hi = max(start, count), min(end, count + len(pcm))
                if hi > lo:
                    pieces[key].append(pcm[lo - count:hi - count].copy())
            count += len(pcm)
        exit_code = process.wait()
        stderr_reader.join()
    if exit_code or stderr_size[0]:
        raise RuntimeError(f'local_decode_failed: exit={exit_code}; stderr_present={bool(stderr_size[0])}')
    return {key: np.concatenate(value).astype(np.float64) for key, value in pieces.items()}, count


def replay_pcm(record, ffmpeg):
    import numpy as np
    from scipy.ndimage import uniform_filter1d

    def ncc(left, right):
        return float(np.corrcoef(left, right)[0, 1])

    def envelope(pcm, positions):
        return np.sqrt(np.maximum(uniform_filter1d(pcm * pcm, size=160, mode='constant')[positions], 0))

    def vad(env):
        threshold = max(10 ** (-50 / 20), float(np.max(env)) * 10 ** (-35 / 20))
        return env >= threshold

    scratch = Path(record['scratch_dir'])
    evidence, errors = [], []
    for surah in sorted({row['surah'] for row in record['samples']}):
        source_path = scratch / f'{surah}.audio'
        if digest(source_path) != record['source_sha256'][str(surah)]:
            raise RuntimeError('retained_source_hash_mismatch')
        samples = [row for row in record['samples'] if row['surah'] == surah]
        clips, bounds = {}, {}
        for row in samples:
            key = row['surah'], row['ayah']
            clip_path = scratch / f'clip-{key[0]}-{key[1]}.mp3'
            if digest(clip_path) != row['hf_audio_sha256']:
                raise RuntimeError('retained_clip_hash_mismatch')
            clips[key], _ = decode_selected_sources(ffmpeg, clip_path, {key: (0, 2 ** 40)})
            clips[key] = clips[key][key]
            start = row['envelope']['source_sample_start']
            bounds[key] = max(0, start - 160), start + len(clips[key]) + 160
        windows, source_count = decode_selected_sources(ffmpeg, source_path, bounds)
        for row in samples:
            key = row['surah'], row['ayah']
            clip = clips[key]
            start = row['envelope']['source_sample_start']
            begin, _ = bounds[key]
            contextual = windows[key]
            source = contextual[start - begin:start - begin + len(clip)]
            if len(source) != len(clip) or start + len(clip) > source_count:
                raise RuntimeError('incomplete_source_window; never pad or trim')
            difference = abs(len(clip) * 1000 / RATE - row['hf_duration_ms'])
            lag = start * 1000 / RATE - row['source_offset_ms']
            env_score = ncc(envelope(source, slice(None)), envelope(clip, slice(None)))
            interior_score = ncc(source[1600:-1600], clip[1600:-1600]) if len(clip) >= 9600 else None
            clip_speech = vad(envelope(clip, slice(None, None, 8)))
            source_speech = vad(envelope(contextual, start - begin + np.arange(0, len(clip), 8)))
            union = int(np.logical_or(source_speech, clip_speech).sum())
            speech_iou = float(np.logical_and(source_speech, clip_speech).sum() / union) if union else None
            comparisons = [('duration', difference, row['duration_difference_ms']),
                           ('lag', lag, row['envelope']['best_lag_ms']),
                           ('envelope', env_score, row['envelope']['score'])]
            if row['vad'].get('source_clip_speech_iou') is not None:
                comparisons.append(('source_clip_vad', speech_iou, row['vad']['source_clip_speech_iou']))
            if interior_score is not None and row['interior_pcm'].get('measured'):
                comparisons.append(('interior_pcm', interior_score, row['interior_pcm']['score']))
            for name, actual, reported in comparisons:
                if actual is None or reported is None or not math.isclose(actual, reported, rel_tol=1e-7, abs_tol=1e-7):
                    errors.append(f'{key}/{name}: replay={actual}, report={reported}')
            evidence.append({'surah': key[0], 'ayah': key[1], 'clip_decoded_duration_ms': len(clip) * 1000 / RATE,
                             'hf_duration_ms': row['hf_duration_ms'], 'duration_difference_ms': difference,
                             'lag_ms': lag, 'envelope_score': env_score, 'interior_pcm_score': interior_score,
                             'source_clip_speech_iou': speech_iou, 'complete_source_window': True,
                             'reported_source_clip_vad_available': row['vad'].get('source_clip_speech_iou') is not None,
                             'reported_segments_vad_unavailable_reason': row['vad'].get('reason'),
                             'vad_mask_runs': {'hop_ms': 1, 'frame_count': len(clip_speech),
                                               'source_speech': mask_runs(source_speech), 'clip_speech': mask_runs(clip_speech)},
                             'boundary_support': boundary_support(source_count, len(clip), row['source_offset_ms'], start)})
            if digest(scratch / f'clip-{key[0]}-{key[1]}.mp3') != row['hf_audio_sha256']:
                raise RuntimeError('retained_clip_changed_during_replay')
        if digest(source_path) != record['source_sha256'][str(surah)]:
            raise RuntimeError('retained_source_changed_during_replay')
    return {'config': record['config'], 'errors': errors, 'samples': evidence,
            'input_fingerprints': input_fingerprints(record),
            'duration_definition': 'abs(decoded_HF_clip_duration_ms - HF_duration_ms); not independently measured source duration',
            'supplied_segments_IoU_replayed': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--original', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--decode-config')
    parser.add_argument('--ffmpeg', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    raw = args.report.read_bytes()
    report = json.loads(raw)
    original = json.loads(args.original.read_bytes())
    review = check_checkpoint(report, original, args.cache)
    review['report_sha256'] = hashlib.sha256(raw).hexdigest()
    review['original_sha256'] = digest(args.original)
    review['original_semantic_sha256'] = hashlib.sha256(json.dumps(original, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    review['review_script_sha256'] = digest(Path(__file__))
    if args.decode_config:
        if args.ffmpeg is None:
            parser.error('--ffmpeg required in local decode mode')
        review['pcm_replay'] = replay_pcm(report['results'][args.decode_config], args.ffmpeg)
    rendered = json.dumps(review, ensure_ascii=False, indent=2)
    if args.output:
        workspace = Path(__file__).resolve().parent.parent
        target = args.output.resolve()
        if not target.is_relative_to(workspace):
            parser.error('--output must stay in the calling review worktree')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered + '\n', encoding='utf-8')
        print(json.dumps({'output': str(target), 'reviewed_configs': len(review['reviewed']),
                          'errors': review['errors'], 'pcm_errors': review.get('pcm_replay', {}).get('errors', [])}))
    else:
        print(rendered)
    return int(bool(review['errors']) or bool(review.get('pcm_replay', {}).get('errors')))


if __name__ == '__main__':
    raise SystemExit(main())
