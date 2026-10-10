"""Independent fixed-position native PCM diagnosis of retained MP3 samples.

Decode the complete source from byte zero once, streaming to bounded RAM
intervals. Never seek, search lag, round a fractional sample position, write
PCM files, alter an acceptance threshold, or replace retained measurements.
"""
import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np


RATE = 44100
TRIM = RATE // 5
MINIMUM_INTERIOR = RATE * 4 // 5


def require_supported_native_rates(source_rate, clip_rate):
    if str(source_rate) != str(clip_rate):
        raise ValueError('UNSUPPORTED_MISMATCHED_NATIVE_SAMPLE_RATES')
    if str(source_rate) != str(RATE):
        raise ValueError('UNSUPPORTED_NATIVE_RATE_NON_44100; no forced resampling attempted')


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def exact_native_start(proof):
    value = proof['source_decoded_pcm_coordinate_of_clip_decoded_zero_ms']
    samples = Fraction(value['numerator'], value['denominator']) * Fraction(RATE, 1000)
    if samples.denominator != 1:
        raise ValueError('NATIVE_SAMPLE_INDEX_NOT_AN_EXACT_INTEGER')
    return samples.numerator


def fixed_interval(native_start, clip_sample_count):
    interior_count = clip_sample_count - 2 * TRIM
    if interior_count < MINIMUM_INTERIOR:
        raise ValueError('FIXED_INTERIOR_SHORTER_THAN_800MS')
    begin, end = native_start + TRIM, native_start + clip_sample_count - TRIM
    if begin < 0:
        raise ValueError('FIXED_INTERIOR_PRECEDES_SOURCE_PCM_ZERO')
    return begin, end


def compare_fixed(reference, clip):
    """Exact PCM equality is the proof; Pearson/RMSE are diagnostic only."""
    reference, clip = np.asarray(reference), np.asarray(clip)
    if (reference.shape != clip.shape or reference.ndim != 1
            or len(clip) < MINIMUM_INTERIOR or not np.all(np.isfinite(reference))
            or not np.all(np.isfinite(clip))):
        raise ValueError('COMPLETE_FINITE_FIXED_INTERIOR_REQUIRED')
    left, right = reference.astype(np.float64), clip.astype(np.float64)
    left -= left.mean()
    right -= right.mean()
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    correlation = None if denominator <= 1e-30 else float(np.dot(left, right) / denominator)
    difference = reference.astype(np.float64) - clip.astype(np.float64)
    return {'native_pcm_identity_proven': reference.tobytes() == clip.tobytes(),
            'correlation': correlation, 'rmse': float(np.sqrt(np.mean(difference ** 2))),
            'maximum_absolute_sample_difference': float(np.max(np.abs(difference))),
            'native_interior_sample_count': len(clip),
            'native_interior_duration_ms': {'numerator': len(clip) * 1000,
                                            'denominator': RATE},
            'diagnosis_only': True, 'changes_v1_acceptance': False,
            'accepts_v2': False}


def command(ffmpeg, audio):
    return [str(ffmpeg), '-v', 'error', '-i', str(audio), '-map', '0:a:0',
            '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1']


def decode_clip(ffmpeg, path):
    process = subprocess.run(command(ffmpeg, path), capture_output=True, timeout=180)
    if process.returncode or len(process.stdout) % 4:
        raise ValueError('NATIVE_CLIP_DECODE_FAILED')
    return np.frombuffer(process.stdout, dtype='<f4')


def stream_source_interiors(ffmpeg, path, intervals, error_path):
    """Read every source sample, retain only fixed, precomputed intervals."""
    retained = {key: [] for key in intervals}
    sample_cursor = 0
    with error_path.open('wb') as errors:
        process = subprocess.Popen(command(ffmpeg, path), stdout=subprocess.PIPE, stderr=errors)
        if process.stdout is None:
            raise ValueError('NATIVE_SOURCE_PIPE_MISSING')
        while True:
            block = process.stdout.read(1024 * 1024)
            if not block:
                break
            if len(block) % 4:
                raise ValueError('NATIVE_SOURCE_PCM_SAMPLE_TRUNCATED')
            block_end = sample_cursor + len(block) // 4
            for key, (begin, end) in intervals.items():
                overlap_begin, overlap_end = max(begin, sample_cursor), min(end, block_end)
                if overlap_end > overlap_begin:
                    retained[key].append(block[(overlap_begin - sample_cursor) * 4:
                                               (overlap_end - sample_cursor) * 4])
            sample_cursor = block_end
        process.stdout.close()
        if process.wait(timeout=180):
            raise ValueError('NATIVE_SOURCE_DECODE_FAILED')
    output = {}
    for key, (begin, end) in intervals.items():
        if end > sample_cursor:
            raise ValueError('FIXED_INTERIOR_EXCEEDS_SOURCE_PCM_COVERAGE')
        payload = b''.join(retained[key])
        if len(payload) != (end - begin) * 4:
            raise ValueError('FIXED_SOURCE_INTERIOR_INCOMPLETE')
        output[key] = np.frombuffer(payload, dtype='<f4')
    return output, sample_cursor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['packet-report', 'scratch', 'ffmpeg', 'private-directory', 'report']:
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    packet_path, scratch = Path(args.packet_report), Path(args.scratch)
    packet_bytes = packet_path.read_bytes()
    packet = json.loads(packet_bytes)
    private = Path(args.private_directory)
    private.mkdir(parents=True, exist_ok=True)
    results, source_counts = [], {}
    for chapter, source in packet['sources'].items():
        path = scratch / f'{chapter}.audio'
        if file_sha(path) != source['sha256']:
            raise ValueError('NATIVE_SOURCE_SHA_MISMATCH')
        require_supported_native_rates(source['stream']['sample_rate'], source['stream']['sample_rate'])
        clips, intervals, starts, rows = {}, {}, {}, {}
        for sample in [s for s in packet['samples'] if str(s['surah']) == chapter]:
            label = f"{chapter}-{sample['ayah']}"
            clip_path = scratch / f'clip-{label}.mp3'
            if file_sha(clip_path) != sample['hf_audio_sha256']:
                raise ValueError('NATIVE_CLIP_SHA_MISMATCH')
            require_supported_native_rates(source['stream']['sample_rate'], sample['clip_stream']['sample_rate'])
            starts[label] = exact_native_start(sample['packet_proof'])
            clips[label] = decode_clip(args.ffmpeg, clip_path)
            intervals[label] = fixed_interval(starts[label], len(clips[label]))
            rows[label] = sample
        interiors, source_sample_count = stream_source_interiors(args.ffmpeg, path, intervals,
                                                               private / f'native-source-{chapter}.stderr.txt')
        source_counts[chapter] = source_sample_count
        for label, clip in clips.items():
            sample = rows[label]
            metric = compare_fixed(interiors[label], clip[TRIM:-TRIM])
            # A diagnostic 8kHz envelope position is read, never searched or changed.
            grid_start = Fraction(str(sample['source_offset_ms'])) + Fraction(str(sample['retained_envelope_lag_ms']))
            exact_ms = Fraction(starts[label] * 1000, RATE)
            discrepancy = grid_start - exact_ms
            results.append({'surah': sample['surah'], 'ayah': sample['ayah'],
                            'hf_audio_sha256': sample['hf_audio_sha256'],
                            'exact_native_source_sample_start': starts[label],
                            'source_interior_begin_sample': intervals[label][0],
                            'source_interior_end_sample_exclusive': intervals[label][1],
                            'clip_interior_begin_sample': TRIM,
                            'clip_interior_end_sample_exclusive': len(clip) - TRIM,
                            'clip_decoded_native_sample_count': len(clip),
                            'retained_8khz_interior_pcm_score': sample['retained_interior_pcm_score'],
                            'retained_envelope_lag_ms': sample['retained_envelope_lag_ms'],
                            'retained_envelope_start_minus_exact_packet_pcm_start_ms':
                                {'numerator': discrepancy.numerator, 'denominator': discrepancy.denominator,
                                 'value': float(discrepancy)},
                            **metric})
            if file_sha(scratch / f'clip-{label}.mp3') != sample['hf_audio_sha256']:
                raise ValueError('NATIVE_CLIP_CHANGED_DURING_ANALYSIS')
        if file_sha(path) != source['sha256']:
            raise ValueError('NATIVE_SOURCE_CHANGED_DURING_ANALYSIS')
        print(json.dumps({'source': chapter, 'fixed_samples': len(clips),
                          'native_source_samples_streamed': source_sample_count}), flush=True)
    if packet_path.read_bytes() != packet_bytes:
        raise ValueError('PACKET_REPORT_CHANGED_DURING_ANALYSIS')
    report = {'schema_version': 1, 'checked_at': datetime.now(timezone.utc).isoformat(),
              'read_only': True, 'config': packet['config'],
              'packet_report_sha256': hashlib.sha256(packet_bytes).hexdigest(),
              'analyzer_sha256': file_sha(Path(__file__)),
              'ffmpeg_version': subprocess.check_output([args.ffmpeg, '-version']).decode().splitlines()[0],
              'decode_settings': {'stream': '0:a:0', 'channels': 1, 'sample_rate_hz': RATE,
                                  'format': 'f32le', 'seek': False, 'lag_search': False,
                                  'resampling_rate_change': False, 'trim_each_side_ms': 200,
                                  'minimum_interior_duration_ms': 800,
                                  'full_source_pcm_file_written': False,
                                  'source_pcm_retained_in_ram': 'fixed intervals only'},
              'source_decoded_native_sample_counts': source_counts, 'samples': results,
              'exact_native_pcm_identity_count': sum(r['native_pcm_identity_proven'] for r in results),
              'all_input_hashes_unchanged': True, 'v1_results_replaced': False, 'v2_accepted': False,
              'publication_changed': False, 'manual_cleanup_required': True,
              'private_outputs': '%TEMP%\\ayahx-b-packet-proof', 'deletion_or_move_attempted': False,
              'limitations': ['Fixed interior identity does not waive retained full-window correlation/duration/lag or VAD requirements.',
                              'No new 8kHz metric or correction is applied. Native diagnosis only separates payload identity from decoded-clock/sample-grid effects.',
                              'Only matching native 44100Hz source/clip rates are supported; other or mismatched rates stop with an explicit UNSUPPORTED error and no forced resampling.',
                              'Only this recitation and these 15 samples were measured.']}
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'exact_native_pcm_identity_count': report['exact_native_pcm_identity_count'],
                      'sample_count': len(results), 'v2_accepted': False}), flush=True)


if __name__ == '__main__':
    main()
