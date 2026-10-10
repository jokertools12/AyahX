"""Partial, cached, local packet proofs of frozen B checkpoints.

Unknown identity/clock remains unproven. Packet metadata is a cause component,
not a classification, decoded-PCM observation, offset acceptance, or v2 gate.
Whole packet lists remain private. No network or PCM decoder is invoked.
"""
import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import subprocess

from inventory_qud_local_proof_candidates import core_candidate, local_files, provenance_guards
from prove_qud_packet_positions import prove_pair, validate_packet_clock


def file_sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def rational_ms(value):
    value *= 1000
    return {'numerator': value.numerator, 'denominator': value.denominator, 'value': float(value)}


def packet_capacity(probe):
    """Expected capacity from the clock; never call this decoded PCM count."""
    stream, packets = probe['streams'][0], probe['packets']
    validate_packet_clock(packets, stream)
    rate, tb = int(stream['sample_rate']), Fraction(stream['time_base'])
    span = Fraction(packets[-1]['pts'] + packets[-1]['duration'] - packets[0]['pts']) * tb * rate
    skip = sum(s.get('skip_samples', 0) for s in packets[0].get('side_data_list', [])
               if s.get('side_data_type') == 'Skip Samples')
    discard = sum(s.get('discard_padding', 0) for s in packets[-1].get('side_data_list', [])
                  if s.get('side_data_type') == 'Skip Samples')
    if span.denominator != 1:
        raise ValueError('NONINTEGER_PACKET_NATIVE_CAPACITY')
    return {'packet_native_sample_capacity': span.numerator - skip - discard,
            'native_sample_rate_hz': rate, 'first_skip_samples': skip,
            'last_discard_padding': discard, 'actual_pcm_decoding_performed': False}


def cached_probe(ffprobe, audio, audio_sha, executable_sha, cache):
    key = f'{audio_sha}.{executable_sha}'
    output, receipt = cache / f'{key}.packets.json', cache / f'{key}.receipt.json'
    if output.exists() or receipt.exists():
        if not output.is_file() or not receipt.is_file():
            raise ValueError('INCOMPLETE_PRIVATE_PACKET_CACHE')
        proof = json.loads(receipt.read_text(encoding='utf-8'))
        if (proof.get('audio_sha256') != audio_sha or proof.get('ffprobe_sha256') != executable_sha
                or proof.get('method') != 'full_file_no_seek_packet_clock_v1'
                or file_sha(output) != proof.get('probe_sha256')):
            raise ValueError('PRIVATE_PACKET_CACHE_RECEIPT_MISMATCH')
        return json.loads(output.read_text(encoding='utf-8')), True
    command = [str(ffprobe), '-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_streams',
               '-show_entries', 'packet=pts,dts,duration,pos,size,side_data_list:stream=index,codec_name,sample_rate,channels,time_base,start_pts,start_time,duration_ts,duration',
               '-of', 'json=compact=1', str(audio)]
    with output.open('wb') as packets, (cache / f'{key}.stderr.txt').open('wb') as errors:
        process = subprocess.run(command, stdout=packets, stderr=errors, timeout=300)
    if process.returncode:
        raise ValueError('LOCAL_FFPROBE_FAILED; private stderr retained')
    probe = json.loads(output.read_text(encoding='utf-8'))
    if len(probe.get('streams', [])) != 1:
        raise ValueError('ONE_LOCAL_AUDIO_STREAM_REQUIRED')
    receipt.write_text(json.dumps({'method': 'full_file_no_seek_packet_clock_v1',
                                   'audio_sha256': audio_sha, 'ffprobe_sha256': executable_sha,
                                   'probe_sha256': file_sha(output)}, indent=2) + '\n', encoding='utf-8')
    return probe, False


def error_code(error):
    if isinstance(error, subprocess.TimeoutExpired):
        return 'LOCAL_FFPROBE_TIMEOUT'
    if isinstance(error, OSError):
        return 'LOCAL_FILE_OR_PROCESS_UNAVAILABLE'
    match = re.match(r'[A-Z][A-Z0-9_]+', str(error))
    return match.group() if match else type(error).__name__.upper()


def partial_sample(source_bytes, clip_bytes, source_probe, clip_probe, sample):
    encoded = sample.get('encoded_identity', {})
    if encoded.get('proven') is not True:
        return {'packet_mapping_proven': False, 'reason': 'NO_RETAINED_CONTIGUOUS_INTERIOR_MATCH'}
    proof = prove_pair(source_bytes, clip_bytes, source_probe, clip_probe,
                       sample['source_offset_ms'], encoded.get('source_byte_position'))
    source, clip = packet_capacity(source_probe), packet_capacity(clip_probe)
    if source['native_sample_rate_hz'] != clip['native_sample_rate_hz']:
        raise ValueError('UNSUPPORTED_MISMATCHED_PACKET_NATIVE_RATES')
    rate = source['native_sample_rate_hz']
    position = proof['source_decoded_pcm_coordinate_of_clip_decoded_zero_ms']
    start = Fraction(position['numerator'], position['denominator']) * Fraction(rate, 1000)
    if start.denominator != 1:
        raise ValueError('NONINTEGER_PACKET_SOURCE_SAMPLE_START')
    clip_count = clip['packet_native_sample_capacity']
    complete = start >= 0 and start + clip_count <= source['packet_native_sample_capacity']
    lag = proof['decoded_coordinate_minus_declared_offset_ms']
    lag = Fraction(lag['numerator'], lag['denominator'])
    frame_delta = proof['encoded_frame_start_minus_declared_offset_ms']
    frame_delta = Fraction(frame_delta['numerator'], frame_delta['denominator'])
    discrepancy = Fraction(str(sample['envelope']['best_lag_ms'])) - lag
    return {'packet_mapping_proven': True, 'proof_scope': 'packet_metadata_only',
            'complete_interior_packets_checked': proof['complete_interior_packets_checked'],
            'fixed_byte_landmarks': proof['fixed_landmarks'],
            'source_byte_origin_for_clip_byte_zero': proof['source_byte_origin_for_clip_byte_zero'],
            'native_packet_source_sample_start': start.numerator,
            'source_capacity': source, 'clip_capacity': clip,
            'encoded_frame_start_minus_declared_offset_ms': rational_ms(frame_delta / 1000),
            'decoded_packet_lag_ms': rational_ms(lag / 1000),
            'decoded_packet_lag_within_30ms': abs(lag) <= 30,
            'retained_envelope_start_minus_packet_start_ms': rational_ms(discrepancy / 1000),
            'full_window_fits_packet_sample_capacity': complete,
            'window_precedes_source_pcm_origin': start < 0,
            'window_exceeds_packet_sample_capacity': start + clip_count > source['packet_native_sample_capacity'],
            'skip_sample_convention_differs': source['first_skip_samples'] != clip['first_skip_samples'],
            'packet_precision_bound_ms': proof['packet_precision_bound_ms'],
            'native_pcm_identity_measured_here': False, 'v2_accepted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['diagnosis', 'retained-v1', 'ffprobe', 'private-cache', 'report']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--config', action='append')
    args = parser.parse_args()
    diagnosis_bytes, old_bytes = Path(args.diagnosis).read_bytes(), Path(args.retained_v1).read_bytes()
    diagnosis, old = json.loads(diagnosis_bytes), json.loads(old_bytes)
    ffprobe = Path(args.ffprobe)
    executable_sha = file_sha(ffprobe)
    cache = Path(args.private_cache)
    cache.mkdir(parents=True, exist_ok=True)
    output = Path(args.report)
    if output.exists():
        raise ValueError('NEW_REPORT_FILENAME_REQUIRED')
    results, cache_hits, cache_misses = [], 0, 0
    for config, record in diagnosis['results'].items():
        if args.config and config not in args.config:
            continue
        guards = provenance_guards(record, old.get('results', {}).get(config, {}))
        scratch, files = local_files(record)
        rows = []
        metadata = {'config': config, 'raw_classification_pattern': record.get('classification', {}).get('pattern'),
                    'raw_classification_reason': record.get('classification', {}).get('reason'),
                    'provenance_guards': guards, 'samples': rows, 'classification_replaced': False}
        results.append(metadata)
        if not all(guards.values()) or scratch is None:
            metadata['unproven_reason'] = 'PROVENANCE_OR_LOCAL_SCRATCH_GUARD_FAILED'
            continue
        for chapter in sorted({s['surah'] for s in record['samples']}):
            samples = [s for s in record['samples'] if s['surah'] == chapter]
            source_path = scratch / f'{chapter}.audio'
            expected_source = record['source_sha256'][str(chapter)]
            source_bytes, source_probe, chapter_error = None, None, None
            try:
                source_bytes = source_path.read_bytes()
                if hashlib.sha256(source_bytes).hexdigest() != expected_source:
                    raise ValueError('LOCAL_SOURCE_SHA_MISMATCH')
                if any(s.get('encoded_identity', {}).get('proven') is True for s in samples):
                    source_probe, hit = cached_probe(ffprobe, source_path, expected_source, executable_sha, cache)
                    cache_hits += hit
                    cache_misses += not hit
                    validate_packet_clock(source_probe['packets'], source_probe['streams'][0])
            except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
                chapter_error = error_code(error)
            for sample in samples:
                row = {'surah': chapter, 'ayah': sample['ayah'], 'source_offset_ms': sample['source_offset_ms'],
                       'source_sha256': expected_source, 'hf_audio_sha256': sample['hf_audio_sha256'],
                       'reported_core_candidate': core_candidate(sample),
                       'retained_interior_pcm_score': sample.get('interior_pcm', {}).get('score')}
                rows.append(row)
                if chapter_error:
                    row.update(packet_mapping_proven=False, reason=chapter_error)
                    continue
                clip_path = scratch / f"clip-{chapter}-{sample['ayah']}.mp3"
                try:
                    clip_bytes = clip_path.read_bytes()
                    if hashlib.sha256(clip_bytes).hexdigest() != sample['hf_audio_sha256']:
                        raise ValueError('LOCAL_HF_CLIP_SHA_MISMATCH')
                    if sample.get('encoded_identity', {}).get('proven') is not True:
                        row.update(packet_mapping_proven=False, reason='NO_RETAINED_CONTIGUOUS_INTERIOR_MATCH')
                    else:
                        clip_probe, hit = cached_probe(ffprobe, clip_path, sample['hf_audio_sha256'], executable_sha, cache)
                        cache_hits += hit
                        cache_misses += not hit
                        row.update(partial_sample(source_bytes, clip_bytes, source_probe, clip_probe, sample))
                    if file_sha(clip_path) != sample['hf_audio_sha256']:
                        raise ValueError('LOCAL_HF_CLIP_CHANGED_DURING_ANALYSIS')
                except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
                    row.update(packet_mapping_proven=False, reason=error_code(error))
            if source_bytes is not None and file_sha(source_path) != expected_source:
                for row in rows:
                    if row['surah'] == chapter:
                        row.update(packet_mapping_proven=False, reason='LOCAL_SOURCE_CHANGED_DURING_ANALYSIS')
        metadata['packet_mapping_proven_samples'] = sum(r['packet_mapping_proven'] for r in rows)
        print(json.dumps({'config': config, 'samples': len(rows),
                          'packet_proven': metadata['packet_mapping_proven_samples'], 'native_decodes': 0}), flush=True)
    if Path(args.diagnosis).read_bytes() != diagnosis_bytes or Path(args.retained_v1).read_bytes() != old_bytes:
        raise ValueError('FROZEN_INPUT_CHANGED_DURING_ANALYSIS')
    report = {'schema_version': 1, 'checked_at': datetime.now(timezone.utc).isoformat(), 'read_only': True,
              'diagnosis_snapshot_sha256': hashlib.sha256(diagnosis_bytes).hexdigest(),
              'retained_v1_checkout_sha256': hashlib.sha256(old_bytes).hexdigest(),
              'analyzer_sha256': file_sha(Path(__file__)), 'ffprobe_sha256': executable_sha,
              'cache_hits': cache_hits, 'cache_misses': cache_misses, 'configs': results,
              'native_decodes': 0, 'network_requests': 0, 'classification_replaced': False,
              'v1_replaced': False, 'v2_accepted': False, 'publication_changed': False,
              'manual_cleanup_required': True, 'private_outputs': '%TEMP%\\ayahx-b-packet-cache',
              'limitations': ['Only retained exact contiguous interior candidates can receive packet mapping proofs.',
                              'Expected native sample capacity is inferred from packets/skip/discard metadata, not an observed PCM decode.',
                              'Identity, offset bounds, capacity/EOF, VAD, duration, and classification remain separate.',
                              'Unproven samples keep an explicit reason; no silent acceptance or causal classification is applied.']}
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
