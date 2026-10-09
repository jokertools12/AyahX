"""Local acoustic evidence only: no DB writes, publication or rehosting.

Three HF retry windows, >=30 min apart, are persisted per config. All audio is
deleted at the end of each attempt, including failures. /rows is secondary.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.error
from urllib.parse import urlencode
import duckdb
import numpy as np
from scipy.signal import correlate
from lib.hf_serial_ranges import SerialTransport, download, range_proxy

RATE = 8000


def decode(ffmpeg, path):
    process = subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(RATE), 'pipe:1'], capture_output=True, timeout=300)
    if process.returncode:
        raise ValueError('AUDIO_DECODE_FAILED')
    return np.frombuffer(process.stdout, dtype='<f4').astype(np.float64)


def compare(source, clip, offset_ms, duration_ms):
    center = round(offset_ms * RATE / 1000)
    margin = round(.300 * RATE)
    start = max(0, center - margin)
    end = min(len(source), center + len(clip) + margin)
    window = source[start:end]
    if len(window) < len(clip) or len(clip) == 0:
        return {'passed': False, 'reason': 'source_window_too_short'}
    clip = clip - clip.mean()
    scores = correlate(window, clip, mode='valid', method='fft')
    sums = np.concatenate(([0], np.cumsum(window)))
    squares = np.concatenate(([0], np.cumsum(window * window)))
    n = len(clip)
    energy = squares[n:] - squares[:-n] - (sums[n:] - sums[:-n]) ** 2 / n
    scores /= np.sqrt(np.maximum(energy * np.dot(clip, clip), 1e-20))
    lags = (np.arange(len(scores)) + start - center) * 1000 / RATE
    scores[np.abs(lags) > 300] = -1
    best = int(np.argmax(scores))
    delta = abs(n * 1000 / RATE - duration_ms)
    score, lag = float(scores[best]), float(lags[best])
    return {'score': round(score, 8), 'best_lag_ms': lag, 'duration_difference_ms': delta,
            'passed': score >= .95 and delta <= 30 and abs(lag) <= 30}


def measure_sample(source, clip, surah, ayah, duration, offset, payload, chapter_offset=None):
    # QUD v3.2.0 qua_jobs/publish_hf.py:_iter_hf_records adds the chapter
    # base to clip_start before emitting HF source_offset_ms. Catalog URLs
    # reference that original source. Adding the base again is incorrect.
    sample = {'surah': surah, 'ayah': ayah, 'duration_ms': duration, 'source_offset_ms': offset,
              'hf_audio_sha256': hashlib.sha256(payload).hexdigest(),
              'source_offset_hypothesis': compare(source, clip, offset, duration)}
    if chapter_offset is not None:
        sample['catalog_chapter_offset_ms'] = chapter_offset
        sample['hf_offset_coordinate'] = 'absolute_in_catalog_source; chapter_base_already_included'
    return sample


def selected_rows(cache, slug, chapters):
    available = {}
    with (cache / f'{slug}.recited.jsonl').open(encoding='utf-8') as source:
        for line in source:
            row = json.loads(line)
            if row['surah'] in chapters and row['ayah'] > 0:
                available.setdefault(row['surah'], []).append(row['ayah'])
    selected = []
    for surah in chapters:
        verses = sorted(set(available.get(surah, [])))
        if len(verses) < 5:
            raise ValueError('INSUFFICIENT_DISTRIBUTED_SAMPLE')
        selected.extend((surah, verses[round(i * (len(verses) - 1) / 4)]) for i in range(5))
    return selected


def sample_chapters(cache, record):
    counts = {}
    with (cache / f"{record['slug']}.recited.jsonl").open(encoding='utf-8') as source:
        for line in source:
            row = json.loads(line)
            if row['ayah'] > 0 and str(row['surah']) in record['audio']['chapter_urls']:
                counts.setdefault(row['surah'], set()).add(row['ayah'])
    # Fix sampling BEFORE fetching audio or measuring correlation. The final
    # third of eligible chapters keeps Parquet audio reads close together and
    # avoids downloading the longest original recordings unnecessarily. Select
    # short, median and long OBSERVED lengths in that pool, not audio scores.
    # Completed earlier evidence is never replaced to improve a failed result.
    eligible = sorted(surah for surah in counts if len(counts[surah]) >= 5)
    pool = eligible[len(eligible) * 2 // 3:]
    by_length = {}
    for surah in pool:
        by_length.setdefault(len(counts[surah]), surah)
    if len(by_length) < 3:
        for surah in eligible:
            by_length.setdefault(len(counts[surah]), surah)
    lengths = sorted(by_length)
    if len(lengths) < 3:
        raise ValueError('INSUFFICIENT_THREE_DIFFERENT_LENGTH_CHAPTERS')
    return sorted(by_length[lengths[index]] for index in (0, len(lengths) // 2, len(lengths) - 1))


def hf_rows(files, pairs, transport):
    condition = ' OR '.join(f'(surah={surah} AND ayah={ayah})' for surah, ayah in pairs)
    chapters = sorted({surah for surah, _ in pairs})
    connection = duckdb.connect()
    try:
        connection.execute('SET threads=1; SET http_retries=0; SET http_timeout=120;')
        with range_proxy(files, transport) as urls:
            metadata = connection.execute("SELECT file_name,stats_min,stats_max FROM parquet_metadata(?) WHERE path_in_schema='surah'", [urls]).fetchall()
            candidates = {url for url, low, high in metadata if low is None or high is None or any(int(low) <= chapter <= int(high) for chapter in chapters)}
            if not candidates:
                return {}
            # Explicit conjunctive chapter predicate permits row-group pruning;
            # the OR for verse pairs alone can force full audio-column scans.
            selected = [url for url in urls if url in candidates]
            predicate = ','.join(str(chapter) for chapter in chapters)
            rows = connection.execute(f'SELECT surah,ayah,audio.bytes,duration_ms,source_offset_ms,word_timestamps FROM read_parquet(?) WHERE surah IN ({predicate}) AND ({condition})', [selected]).fetchall()
            return {(row[0], row[1]): row[2:] for row in rows}
    finally:
        connection.close()


def rows_secondary(slug, pairs, transport):
    rows = {}
    for surah, ayah in pairs:
        query = urlencode({'dataset': 'QUD-Technologies/quranic-universal-ayahs', 'config': slug, 'split': 'train',
                           'where': f'"surah"={surah} AND "ayah"={ayah}', 'length': 1})
        with transport.open('https://datasets-server.huggingface.co/filter?' + query) as response:
            data = json.load(response)
        if not data.get('rows'):
            continue
        row = data['rows'][0]['row']
        audio = row.get('audio') or []
        if not isinstance(audio, list) or not audio:
            continue
        with transport.open(audio[0]['src']) as response:
            payload = response.read()
        rows[(surah, ayah)] = (payload, row['duration_ms'], row['source_offset_ms'], row['word_timestamps'])
    return rows


def audit(record, args, manifest, transport):
    slug = record['slug']
    evidence = {'config': slug, 'verification_status': 'source_unavailable', 'offset_verified': False,
                'offset_check_score': None, 'offset_correction_ms': None,
                'surah_start_basmala_audio_status': 'unverified', 'samples': [], 'prefixes': []}
    # Different lengths; exactly five distinct, distributed ayahs per surah.
    folder = pathlib.Path(tempfile.mkdtemp(prefix='ayahx-d2-audio-'))
    resume = pathlib.Path(args.resume_audio_dir).resolve() if args.resume_audio_dir else None
    if resume and (not args.config or not resume.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve()) or not resume.name.startswith('ayahx-d2-audio-')):
        raise ValueError('EXPLICIT_TEMP_AUDIO_RESUME_REQUIRED')
    try:
        chapters = sample_chapters(pathlib.Path(args.cache), record)
        evidence['sample_chapters'] = chapters
        pairs = selected_rows(pathlib.Path(args.cache), slug, chapters)
        sources = {}
        for surah in chapters:
            url = record['audio']['chapter_urls'].get(str(surah))
            if not url:
                evidence['reason'] = f'catalog_audio_missing_surah_{surah}'
                return evidence
            path = (resume or folder) / f'{surah}.audio'
            try:
                if not resume:
                    download(transport, url, path)
                sources[surah] = decode(args.ffmpeg, path)
                evidence.setdefault('catalog_source_sha256', {})[str(surah)] = hashlib.sha256(path.read_bytes()).hexdigest()
                evidence.setdefault('decoded_source_duration_ms', {})[str(surah)] = len(sources[surah]) * 1000 / RATE
            except (urllib.error.URLError, OSError, ValueError, subprocess.TimeoutExpired) as error:
                evidence['reason'] = 'catalog_audio_unavailable'
                evidence['source_error'] = {'surah': surah, 'type': type(error).__name__, 'http_status': getattr(error, 'code', None)}
                return evidence
        files = [item['url'] for item in manifest['parquet_files'] if item['config'] == slug and item['split'] == 'train']
        evidence['hf_parquet_attempted'] = True
        try:
            rows = hf_rows(files, pairs, transport)
            evidence['hf_transport'] = 'Parquet audio-column range reads'
        except duckdb.Error as error:
            evidence['parquet_error'] = type(error).__name__
            try:
                rows = rows_secondary(slug, pairs, transport)
                evidence['hf_transport'] = 'HF filter/rows secondary after Parquet failure'
            except (urllib.error.URLError, OSError):
                evidence['reason'] = 'hf_audio_unavailable'
                return evidence
        if any(pair not in rows or not rows[pair][0] for pair in pairs):
            evidence['reason'] = 'hf_audio_missing_sample'
            return evidence
        for surah, ayah in pairs:
            payload, duration, offset, timings = rows[(surah, ayah)]
            if offset is None or duration is None:
                evidence['reason'] = 'hf_offset_or_duration_missing'
                return evidence
            clip_path = folder / 'clip.mp3'
            clip_path.write_bytes(payload)
            clip = decode(args.ffmpeg, clip_path)
            chapter_offset = record['audio'].get('chapter_offsets_ms', {}).get(str(surah))
            sample = measure_sample(sources[surah], clip, surah, ayah, duration, offset, payload, chapter_offset)
            evidence['samples'].append(sample)
            if ayah == 1 and surah != 9:
                first = timings[0][1] if timings else None
                boundary = offset + first if first is not None else offset
                prefix = sources[surah][:max(0, round(boundary * RATE / 1000))]
                frames = prefix[:len(prefix) // 80 * 80].reshape(-1, 80)
                rms = np.sqrt(np.mean(frames ** 2, axis=1)) if len(frames) else np.array([])
                evidence['prefixes'].append({'surah': surah, 'duration_ms': len(prefix) * 1000 / RATE,
                    'first_start_ms': first, 'source_offset_ms': offset,
                    'rms': float(np.sqrt(np.mean(prefix ** 2))) if len(prefix) else 0,
                    'silent_fraction_at_minus_45db': float(np.mean(rms < 10 ** (-45 / 20))) if len(rms) else None,
                    'interpretation': 'energy/silence evidence only; basmala content requires human review'})
        results = [row['source_offset_hypothesis'] for row in evidence['samples']]
        scores = [row.get('score', 0) for row in results]
        lags = [row['best_lag_ms'] for row in results if 'best_lag_ms' in row]
        evidence['offset_check_score'] = min(scores)
        evidence['lag_standard_deviation_ms'] = float(np.std(lags)) if len(lags) == len(results) else None
        if len(lags) == len(results) and np.std(lags) <= 10:
            evidence['offset_correction_ms'] = round(float(np.mean(lags)))
        passed = all(row['passed'] for row in results)
        evidence['offset_verified'] = passed
        evidence['verification_status'] = 'passed' if passed else 'failed'
        evidence['reason'] = 'all_15_samples_pass' if passed else 'acoustic_acceptance_failed; D5 real-audio realignment option'
        # Real negative control, from the same fetched audio, not a mock.
        first_pair = pairs[0]
        payload, duration, offset, _ = rows[first_pair]
        clip_path.write_bytes(payload)
        evidence['negative_control_plus_1000ms'] = compare(sources[first_pair[0]], decode(args.ffmpeg, clip_path), offset + 1000, duration)
        return evidence
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        evidence['reason'] = str(error) if isinstance(error, ValueError) else type(error).__name__
        return evidence
    finally:
        shutil.rmtree(folder)
        if resume:
            shutil.rmtree(resume)
        evidence['audio_scratch_deleted'] = True


def main():
    parser = argparse.ArgumentParser()
    for option in ['catalog', 'manifest', 'cache', 'ffmpeg', 'report']:
        parser.add_argument('--' + option, required=True)
    parser.add_argument('--config')
    parser.add_argument('--resume-audio-dir', help='Resume an interrupted attempt using its original catalog downloads in TEMP; requires --config')
    args = parser.parse_args()
    catalog = json.loads(pathlib.Path(args.catalog).read_text(encoding='utf-8'))
    manifest = json.loads(pathlib.Path(args.manifest).read_text())
    target = pathlib.Path(args.report)
    report = json.loads(target.read_text()) if target.exists() else {'results': {}, 'policy': {'hf_windows': 3, 'window_spacing_seconds': 1800, 'sample': '5 ayahs x 3 surahs', 'ncc_lag_limit_ms': 300}}
    records = [row for row in catalog['recitations'] if not args.config or row['slug'] == args.config]
    transport = SerialTransport()
    while True:
        pending = False
        for record in records:
            previous = report['results'].get(record['slug'], {})
            attempts = previous.get('attempts', [])
            if previous.get('verification_status') in ('passed', 'failed'):
                continue
            # Three windows specifically for an unavailable HF source. Catalog
            # source errors are reported separately and never become a pass.
            if attempts and (not previous.get('reason', '').startswith('hf_') or len(attempts) >= 3):
                continue
            if attempts and time.time() - attempts[-1]['finished_epoch'] < 1800:
                pending = True
                continue
            started = time.time()
            evidence = audit(record, args, manifest, transport)
            attempts.append({'started_epoch': started, 'finished_epoch': time.time(), 'status': evidence['verification_status'], 'reason': evidence['reason']})
            evidence['attempts'] = attempts
            report['results'][record['slug']] = evidence
            report['transport_stats'] = transport.stats
            checkpoint = target.with_suffix(target.suffix + '.tmp')
            checkpoint.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            checkpoint.replace(target)
            print(json.dumps({'config': record['slug'], 'status': evidence['verification_status'], 'reason': evidence['reason'], 'sample_count': len(evidence['samples'])}), flush=True)
            if evidence['reason'].startswith('hf_') and len(attempts) < 3:
                pending = True
        if not pending:
            break
        time.sleep(5)


if __name__ == '__main__':
    main()
