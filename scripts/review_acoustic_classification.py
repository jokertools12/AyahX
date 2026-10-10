"""Read-only B classification review; raw metrics/classifications stay history.

Identity/packet clocks establish a cause and position. They never replace the
four numeric v2 gates. Supplied-segment VAD must be independently replayed,
including exact PCM bounds, before a reviewed adoption candidate is reported.
"""

import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path

from review_acoustic_checkpoint import (check_checkpoint, finite, input_fingerprints,
                                       lag_trends, numeric_gate)


REVIEWED_PACKET_ANALYZERS = frozenset(('c7fc61b2ae85c2cf5c87820ca05e5ec7598a9f9288a967e5eef837f59df366f4',))
REVIEWED_NATIVE_ANALYZERS = frozenset(('3c12cf34a27b52918ab078a8a38aa4c2010e3cb78b28cffeb5888b87ea6602bf',
                                     '8121d46ef5ca5e65118907b8b432db5297b0bb0601a6a0447164cd8c1e4272e0'))
SUPPORTED_NATIVE_RATES = frozenset((8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def fraction(value):
    numerator, denominator = value.get('numerator'), value.get('denominator')
    if (not isinstance(numerator, int) or isinstance(numerator, bool)
            or not isinstance(denominator, int) or isinstance(denominator, bool) or denominator == 0):
        raise ValueError('EXACT_FRACTION_REQUIRED')
    return Fraction(numerator, denominator)


def pair(row):
    return row['surah'], row['ayah']


def expand_runs(runs, count):
    mask, previous_end = bytearray(count), 0
    for start, end in runs:
        if (type(start) is not int or type(end) is not int or start < previous_end
                or start < 0 or end <= start or end > count):
            raise ValueError('INVALID_REPLAY_VAD_RUNS')
        mask[start:end] = b'\1' * (end - start)
        previous_end = end
    return mask


def iou(left, right):
    if len(left) != len(right):
        raise ValueError('VAD_MASK_SIZE_MISMATCH')
    union = sum(bool(a or b) for a, b in zip(left, right))
    return sum(bool(a and b) for a, b in zip(left, right)) / union if union else None


def replay_segments(sample, pcm, segments):
    encoded = json.dumps(segments, separators=(',', ':')).encode()
    if sha(encoded) != sample['supplied_segments_sha256']:
        return {'verified': False, 'reason': 'SEGMENTS_ROLLING_SHA_MISMATCH'}
    masks = pcm.get('vad_mask_runs')
    if not masks:
        return {'verified': False, 'reason': 'INDEPENDENT_VAD_MASKS_UNAVAILABLE'}
    count = masks['frame_count']
    actual_duration = Fraction(pcm['boundary_support']['clip_decoded_sample_count'], 8)
    if masks['hop_ms'] != 1 or count != math.ceil(actual_duration):
        raise ValueError('VAD_GRID_DIFFERS_FROM_DECODED_PCM')
    source = expand_runs(masks['source_speech'], count)
    clip = expand_runs(masks['clip_speech'], count)
    reference = bytearray(count)
    bounds, grid_valid = [], True
    if not segments:
        return {'verified': False, 'reason': 'EMPTY_SUPPLIED_SEGMENTS'}
    for segment in segments:
        if (not isinstance(segment, list) or len(segment) < 4
                or not finite(segment[2]) or not finite(segment[3])):
            return {'verified': False, 'reason': 'INVALID_SUPPLIED_SEGMENT'}
        start, end = Fraction(str(segment[2])), Fraction(str(segment[3]))
        if start < 0 or end <= start:
            return {'verified': False, 'reason': 'INVALID_SUPPLIED_SEGMENT_RANGE'}
        # Record both grids. No invented PCM and no tolerance for exact bounds.
        if end > actual_duration:
            bounds.append({'segment_end_ms': float(end), 'overrun_ms': float(end - actual_duration)})
        if end > count:
            grid_valid = False
        else:
            begin, finish = math.ceil(start), math.ceil(end)
            reference[begin:finish] = b'\1' * (finish - begin)
    result = {'verified': False, 'sha_matched': True, 'actual_clip_duration_ms': float(actual_duration),
              'exact_pcm_bounds_valid': not bounds, 'segment_overruns': bounds,
              'grid_valid': grid_valid, 'grid_quantization_ms_less_than': 1}
    if not grid_valid:
        return {**result, 'reason': 'SEGMENT_OUTSIDE_DECODED_VAD_GRID'}
    values = {'source_clip_speech_iou': iou(source, clip),
              'source_segments_speech_iou': iou(source, reference),
              'clip_segments_speech_iou': iou(clip, reference)}
    agreement = min(values.values()) if all(value is not None for value in values.values()) else None
    reported = sample.get('vad', {})
    matched = all(reported.get(key) is not None and math.isclose(value, reported[key], abs_tol=1e-7, rel_tol=1e-7)
                  for key, value in values.items() if value is not None)
    result.update(values, agreement=agreement, raw_grid_metric_matched=matched)
    result['verified'] = not bounds and matched and finite(agreement)
    result['reason'] = ('EXACT_PCM_SEGMENT_BOUND_VIOLATION' if bounds else
                        'RAW_VAD_METRIC_MISMATCH' if not matched else
                        'EMPTY_VAD_UNION' if agreement is None else None)
    return result


def packet_position(sample, packet):
    proof = packet['packet_proof']
    checked = proof.get('complete_interior_packets_checked')
    if proof.get('proven') is not True or type(checked) is not int or checked <= 0:
        raise ValueError('COMPLETE_PACKET_IDENTITY_PROOF_REQUIRED')
    landmarks = proof.get('fixed_landmarks', [])
    if len(landmarks) != 5:
        raise ValueError('FIVE_FIXED_PACKET_LANDMARKS_REQUIRED')
    source_base, clip_base = Fraction(proof['source_time_base']), Fraction(proof['clip_time_base'])
    shifts = {Fraction(point['source_packet']['pts']) * source_base - Fraction(point['clip_packet']['pts']) * clip_base
              for point in landmarks}
    if len(shifts) != 1:
        raise ValueError('PACKET_CLOCK_DISCONTINUITY')
    shift = next(iter(shifts))
    decoded = (shift - Fraction(proof['source_start_pts']) * source_base
               + Fraction(proof['clip_start_pts']) * clip_base) * 1000
    lag = decoded - Fraction(str(sample['source_offset_ms']))
    if (decoded != fraction(proof['source_decoded_pcm_coordinate_of_clip_decoded_zero_ms'])
            or lag != fraction(proof['decoded_coordinate_minus_declared_offset_ms'])):
        raise ValueError('PACKET_DERIVED_COORDINATE_MISMATCH')
    envelope_ms = Fraction(sample['envelope']['source_sample_start'], 8)
    rate = int(packet['clip_stream']['sample_rate'])
    if rate not in SUPPORTED_NATIVE_RATES:
        raise ValueError('UNSUPPORTED_NATIVE_RATE')
    discrepancy = envelope_ms - decoded
    # Interior proof at a negative priming origin is explicitly distinguished.
    ordinary_link = abs(discrepancy) <= Fraction(1, 16)
    start_limited = decoded < 0 and envelope_ms == 0 and abs(lag) <= 30
    return {'decoded_start_ms': float(decoded), 'decoded_lag_ms': float(lag),
            'decoded_lag_fraction': {'numerator': lag.numerator, 'denominator': lag.denominator},
            'lag_within_30ms': abs(lag) <= 30, 'envelope_position_discrepancy_ms': float(discrepancy),
            'envelope_position_linked': ordinary_link or start_limited,
            'position_link_kind': 'native_grid_half_8k_sample' if ordinary_link else
                                  'start_boundary_limited_interior_only' if start_limited else 'unlinked',
            'native_sample_rate_hz': rate, 'native_start_sample': decoded * Fraction(rate, 1000)}


def native_identity(pcm, packet_position_data, source_count):
    start = packet_position_data['native_start_sample']
    rate = packet_position_data['native_sample_rate_hz']
    count = pcm['clip_decoded_native_sample_count']
    if start.denominator != 1 or pcm['exact_native_source_sample_start'] != start.numerator:
        raise ValueError('NATIVE_POSITION_MISMATCH')
    if pcm.get('native_sample_rate_hz', rate) != rate:
        raise ValueError('NATIVE_RATE_MISMATCH')
    trim, minimum = rate // 5, rate * 4 // 5
    begin, end = start.numerator + trim, start.numerator + count - trim
    if (pcm['source_interior_begin_sample'] != begin or pcm['source_interior_end_sample_exclusive'] != end
            or pcm['clip_interior_begin_sample'] != trim or pcm['clip_interior_end_sample_exclusive'] != count - trim
            or begin < 0 or end > source_count or count - 2 * trim < minimum):
        raise ValueError('NATIVE_FIXED_INTERIOR_BOUNDS_INVALID')
    exact = (pcm.get('native_pcm_identity_proven') is True
             and finite(pcm.get('rmse')) and pcm['rmse'] == 0
             and finite(pcm.get('maximum_absolute_sample_difference')) and pcm['maximum_absolute_sample_difference'] == 0
             and pcm.get('native_interior_sample_count') == count - 2 * trim)
    return {'exact_fixed_interior_identity': exact,
            'full_native_window_available': start >= 0 and start + count <= source_count,
            'native_origin_precedes_source': start < 0,
            'native_end_overrun_ms': float(max(Fraction(0), start + count - source_count) * Fraction(1000, rate))}


def review_record(record, pcm_replay, distribution_ok, old, packet_bundle=None, native_bundle=None, supplied=None):
    raw = record.get('classification', {})
    blockers, evidence, errors = [], [], []
    if record.get('status') != 'measured':
        return {'raw_classification': raw, 'reviewed_pattern': 'unresolved', 'v2_adoption_candidate': False,
                'blockers': [record.get('status', 'not_measured')], 'samples': []}
    rows = record['samples']
    old_samples = {pair(row): row for row in old['samples']}
    stable = (old.get('verification_status') == 'failed'
              and set(old_samples) == {pair(row) for row in rows}
              and all(record['source_sha256'].get(str(row['surah'])) == old.get('catalog_source_sha256', {}).get(str(row['surah']))
                      and old.get('catalog_source_sha256', {}).get(str(row['surah'])) is not None for row in rows)
              and all(row['hf_audio_sha256'] == old_samples[pair(row)]['hf_audio_sha256']
                      and row['source_offset_ms'] == old_samples[pair(row)]['source_offset_ms']
                      and row['hf_duration_ms'] == old_samples[pair(row)]['duration_ms'] for row in rows))
    if not stable:
        blockers.append('OLD_SOURCE_OR_HF_INPUT_NOT_PROVEN_STABLE')
    if not distribution_ok:
        blockers.append('FIXED_3_BY_5_DISTRIBUTION_NOT_REPLAYED')
    replay_valid = (pcm_replay is not None and not pcm_replay.get('errors')
                    and pcm_replay.get('input_fingerprints') == input_fingerprints(record))
    if not replay_valid:
        blockers.append('MATCHING_LOCAL_PCM_REPLAY_UNAVAILABLE')
    replay_rows = {pair(row): row for row in pcm_replay.get('samples', [])} if replay_valid else {}
    packet_rows = {pair(row): row for row in packet_bundle.get('samples', [])} if packet_bundle else {}
    native_rows = {pair(row): row for row in native_bundle.get('samples', [])} if native_bundle else {}
    packet_valid = bool(packet_bundle
                        and packet_bundle.get('config') == record['config']
                        and packet_bundle.get('all_input_hashes_unchanged') is True
                        and all(packet_bundle.get('sources', {}).get(ch, {}).get('sha256') == value
                                for ch, value in record['source_sha256'].items())
                        and set(packet_rows).issubset({pair(row) for row in rows}))
    native_valid = bool(native_bundle and native_bundle.get('config') == record['config']
                        and native_bundle.get('all_input_hashes_unchanged') is True
                        and native_bundle.get('decode_settings', {}).get('lag_search') is False
                        and native_bundle.get('decode_settings', {}).get('resampling_rate_change') is False)
    wave_clock_rows = []
    for row in rows:
        key = pair(row)
        pcm = replay_rows.get(key)
        item = {'surah': key[0], 'ayah': key[1], 'four_numeric_v2_gates_pass': numeric_gate(row),
                'raw_vad_segments_sha256': row['supplied_segments_sha256']}
        item['segments_replay'] = replay_segments(row, pcm, supplied.get(f'{key[0]}:{key[1]}', {}).get('segments')) if (
            pcm and supplied and f'{key[0]}:{key[1]}' in supplied) else {'verified': False, 'reason': 'SEGMENTS_EVIDENCE_UNAVAILABLE'}
        item['boundary_support'] = pcm.get('boundary_support') if pcm else None
        if packet_valid and key in packet_rows and packet_rows[key].get('packet_proof', {}).get('proven') is True:
            packet = packet_rows[key]
            try:
                if packet['hf_audio_sha256'] != row['hf_audio_sha256']:
                    raise ValueError('PACKET_HF_SHA_MISMATCH')
                if packet['source_offset_ms'] != row['source_offset_ms'] or packet['hf_duration_ms'] != row['hf_duration_ms']:
                    raise ValueError('PACKET_HF_METADATA_MISMATCH')
                if str(packet['clip_stream']['sample_rate']) != str(packet_bundle['sources'][str(key[0])]['stream']['sample_rate']):
                    raise ValueError('SOURCE_CLIP_NATIVE_RATE_MISMATCH')
                position = packet_position(row, packet)
                native_support = None
                if native_valid and key in native_rows:
                    native = native_rows[key]
                    if native['hf_audio_sha256'] != row['hf_audio_sha256']:
                        raise ValueError('NATIVE_HF_SHA_MISMATCH')
                    settings = native_bundle['decode_settings']
                    measured_rate = settings.get('native_sample_rates_hz', {}).get(str(key[0]), settings.get('sample_rate_hz'))
                    if measured_rate != position['native_sample_rate_hz']:
                        raise ValueError('NATIVE_DECODE_RATE_MISMATCH')
                    native_support = native_identity(native, position, native_bundle['source_decoded_native_sample_counts'][str(key[0])])
                position.pop('native_start_sample')
                item['packet_position'] = position
                if native_support:
                    item['native_identity'] = native_support
                boundary_free = pcm and not pcm['boundary_support']['nominal_interval_extends_source_EOF']
                if (boundary_free and native_support and native_support['full_native_window_available']
                        and native_support['exact_fixed_interior_identity'] and position['envelope_position_linked']):
                    wave_clock_rows.append({'surah': key[0], 'source_offset_ms': row['source_offset_ms'],
                                            'envelope': {'measured': True, 'score': 1, 'best_lag_ms': position['decoded_lag_ms']}})
            except (ValueError, KeyError, TypeError, ZeroDivisionError) as error:
                errors.append(f'{key}:{type(error).__name__}:{error}')
        evidence.append(item)
    identity_position_proven = stable and distribution_ok and all(
        item.get('native_identity', {}).get('exact_fixed_interior_identity') is True
        and item.get('packet_position', {}).get('envelope_position_linked') is True for item in evidence)
    independent_trends = lag_trends(wave_clock_rows)
    genuine_drift = bool(stable and distribution_ok and replay_valid
                         and any(trend['increasing_drift_evidence'] for trend in independent_trends))
    raw_drift = any(t.get('increasing_drift_evidence') is True for t in raw.get('lag_trends', []))
    duration_unexplained = any(not finite(row.get('duration_difference_ms')) or row['duration_difference_ms'] > 30 for row in rows)
    eof_boundary = any(item.get('boundary_support', {}).get('nominal_interval_extends_source_EOF') is True
                       for item in evidence if item.get('boundary_support'))
    eof_native_unexplained = any(item.get('native_identity', {}).get('native_end_overrun_ms', 0) > 0 for item in evidence)
    codec_proven = identity_position_proven and not duration_unexplained and not eof_native_unexplained
    pattern = ('increasing_drift' if genuine_drift else 'codec_processing_only' if codec_proven else
               'boundary_confounded' if eof_boundary else 'unresolved')
    if raw_drift and not genuine_drift:
        blockers.append('RAW_TREND_HAS_NO_INDEPENDENT_BOUNDARY_FREE_WAVE_CLOCK_PROOF')
    if not codec_proven:
        blockers.append('CODEC_CAUSE_AND_POSITION_NOT_PROVEN_FOR_ALL_SAMPLES')
    if duration_unexplained:
        blockers.append('UNEXPLAINED_DURATION_GATE_FAILURE')
    if eof_native_unexplained:
        blockers.append('NATIVE_END_COVERAGE_UNEXPLAINED')
    if not all(item['four_numeric_v2_gates_pass'] for item in evidence):
        blockers.append('ONE_OR_MORE_CORE_NUMERIC_V2_GATES_FAIL')
    if not all(item['segments_replay']['verified'] and item['segments_replay'].get('agreement', 0) >= .9 for item in evidence):
        blockers.append('EXACT_BOUND_SEGMENTS_VAD_REPLAY_NOT_ACCEPTABLE')
    if not all(item.get('packet_position', {}).get('lag_within_30ms') is True for item in evidence):
        blockers.append('PACKET_DERIVED_LAG_NOT_PROVEN_WITHIN_30MS')
    if not all(finite(row.get('log_mel', {}).get('score')) and row['log_mel']['score'] >= .9 for row in rows):
        blockers.append('RETAINED_EXTRA_LOG_MEL_GATE_FAILS')
    return {'raw_classification': raw, 'reviewed_pattern': pattern,
            'genuine_drift_proven': genuine_drift, 'independent_packet_lag_trends': independent_trends,
            'codec_identity_position_component_proven': identity_position_proven,
            'codec_cause_proven': codec_proven, 'v2_adoption_candidate': not blockers and not errors and pattern == 'codec_processing_only',
            'offset_verified_changed': False, 'publication_changed': False,
            'blockers': sorted(set(blockers)), 'proof_errors': errors, 'samples': evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('report', 'original', 'cache', 'replay-directory', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--segments', type=Path)
    parser.add_argument('--packet', type=Path, action='append', default=[])
    parser.add_argument('--native', type=Path, action='append', default=[])
    parser.add_argument('--packet-analyzer', type=Path)
    parser.add_argument('--native-analyzer', type=Path)
    args = parser.parse_args()
    raw, original_raw = args.report.read_bytes(), args.original.read_bytes()
    report, original = json.loads(raw), json.loads(original_raw)
    common = check_checkpoint(report, original, args.cache)
    distributions = {row['config']: row['distribution_replayed'] for row in common['reviewed']}
    replays = {}
    for path in sorted(args.replay_directory.glob('b-independent-validated-*.json')):
        replay = json.loads(path.read_bytes()).get('pcm_replay')
        if replay:
            replays[replay['config']] = replay
    packets, natives, packet_hashes = {}, {}, {}
    for path in args.packet:
        value = path.read_bytes()
        packet = json.loads(value)
        accepted_packet_hashes = REVIEWED_PACKET_ANALYZERS | ({sha(args.packet_analyzer.read_bytes())} if args.packet_analyzer else set())
        if packet.get('analyzer_sha256') not in accepted_packet_hashes:
            raise ValueError('PACKET_ANALYZER_SHA_NOT_REVIEWED')
        packets[packet['config']], packet_hashes[packet['config']] = packet, sha(value)
    for path in args.native:
        native = json.loads(path.read_bytes())
        accepted_native_hashes = REVIEWED_NATIVE_ANALYZERS | ({sha(args.native_analyzer.read_bytes())} if args.native_analyzer else set())
        if native.get('analyzer_sha256') not in accepted_native_hashes:
            raise ValueError('NATIVE_ANALYZER_SHA_NOT_REVIEWED')
        if native.get('packet_report_sha256') != packet_hashes.get(native['config']):
            raise ValueError('NATIVE_PACKET_REPORT_SHA_MISMATCH')
        natives[native['config']] = native
    supplied = json.loads(args.segments.read_bytes()) if args.segments else {}
    output = {'read_only': True, 'raw_report_sha256': sha(raw), 'raw_metrics_replaced': False,
              'original_semantic_sha256': sha(json.dumps(original, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()),
              'review_script_sha256': sha(Path(__file__).read_bytes()), 'validation_errors': common['errors'], 'results': {},
              'offset_verified_changed': False, 'publication_changed': False}
    for slug, record in report['results'].items():
        output['results'][slug] = review_record(record, replays.get(slug), distributions.get(slug, False), original['results'][slug],
                                               packets.get(slug), natives.get(slug), supplied.get('samples', {}).get(slug))
        if common['errors']:
            output['results'][slug]['v2_adoption_candidate'] = False
            output['results'][slug]['blockers'].append('GLOBAL_CHECKPOINT_VALIDATION_FAILED')
    gate_counts, cause_counts = {}, {}
    for slug, record in report['results'].items():
        cause = output['results'][slug]['reviewed_pattern']
        cause_counts[cause] = cause_counts.get(cause, 0) + 1
        for row in record.get('samples', []):
            gates = {'envelope_below_0.90_or_unavailable': not row.get('envelope', {}).get('measured') or not finite(row['envelope'].get('score')) or row['envelope']['score'] < .9,
                     'VAD_below_0.90_or_unavailable': not finite(row.get('vad', {}).get('agreement')) or row['vad']['agreement'] < .9,
                     'lag_above_30ms_or_unavailable': not finite(row.get('envelope', {}).get('best_lag_ms')) or abs(row['envelope']['best_lag_ms']) > 30,
                     'duration_above_30ms_or_invalid': not finite(row.get('duration_difference_ms')) or not 0 <= row['duration_difference_ms'] <= 30}
            for name, failed in gates.items():
                gate_counts[name] = gate_counts.get(name, 0) + int(failed)
    output['failure_gate_sample_counts'] = gate_counts
    output['cause_recitation_counts'] = cause_counts
    original_failed = {slug for slug, row in original['results'].items() if row.get('verification_status') == 'failed'}
    output['all_original_failed_configs_present'] = original_failed.issubset(report['results'])
    output['original_failed_config_count'] = len(original_failed)
    target = args.output.resolve()
    if not target.is_relative_to(Path(__file__).resolve().parent.parent):
        parser.error('--output must stay in the calling review worktree')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'reviewed': len(output['results']), 'candidates': sum(r['v2_adoption_candidate'] for r in output['results'].values()),
                      'validation_errors': output['validation_errors'], 'output': str(target)}))
    return int(bool(output['validation_errors']) or any(r.get('proof_errors') for r in output['results'].values()))


if __name__ == '__main__':
    raise SystemExit(main())
