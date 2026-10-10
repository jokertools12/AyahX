"""No-network controls for independent B cause/acceptance separation."""
import copy
from fractions import Fraction
import hashlib
import json
import unittest

from review_acoustic_checkpoint import input_fingerprints
from review_acoustic_classification import (expand_runs, fraction, native_identity,
                                            packet_position, replay_segments, review_record)


def vad_fixture(sample_count=80, endpoint=10):
    segments = [[1, 1, 0, endpoint]]
    sample = {'supplied_segments_sha256': hashlib.sha256(json.dumps(segments, separators=(',', ':')).encode()).hexdigest(),
              'vad': {'source_clip_speech_iou': 1, 'source_segments_speech_iou': 1, 'clip_segments_speech_iou': 1}}
    frames = (sample_count + 7) // 8
    pcm = {'boundary_support': {'clip_decoded_sample_count': sample_count},
           'vad_mask_runs': {'hop_ms': 1, 'frame_count': frames,
                             'source_speech': [[0, frames]], 'clip_speech': [[0, frames]]}}
    return sample, pcm, segments


def packet_fixture(offset=1000, rate=44100):
    source_start, native_start = 1105, rate
    sample = {'source_offset_ms': offset, 'envelope': {'source_sample_start': 8000}}
    proof = {'proven': True, 'complete_interior_packets_checked': 10,
             'source_time_base': f'1/{rate}', 'clip_time_base': f'1/{rate}',
             'source_start_pts': source_start, 'clip_start_pts': 0,
             'fixed_landmarks': [{'source_packet': {'pts': native_start + source_start + k * 1152},
                                  'clip_packet': {'pts': k * 1152}} for k in range(5)],
             'source_decoded_pcm_coordinate_of_clip_decoded_zero_ms': {'numerator': 1000, 'denominator': 1},
             'decoded_coordinate_minus_declared_offset_ms': {'numerator': 1000 - offset, 'denominator': 1}}
    return sample, {'packet_proof': proof, 'clip_stream': {'sample_rate': str(rate)}}


def native_fixture(rate=44100):
    sample, packet = packet_fixture(rate=rate)
    position = packet_position(sample, packet)
    trim = rate // 5
    row = {'clip_decoded_native_sample_count': rate * 2, 'exact_native_source_sample_start': rate,
           'source_interior_begin_sample': rate + trim, 'source_interior_end_sample_exclusive': rate * 3 - trim,
           'clip_interior_begin_sample': trim, 'clip_interior_end_sample_exclusive': rate * 2 - trim,
           'native_pcm_identity_proven': True, 'rmse': 0, 'maximum_absolute_sample_difference': 0,
           'native_interior_sample_count': rate * 2 - 2 * trim}
    return row, position


def reviewed_fixture():
    rows, originals, pcm_rows, packet_rows, native_rows, supplied = [], [], [], [], [], {}
    source_hashes = {str(s): f'synthetic-source-{s}' for s in (1, 2, 3)}
    segments = [[1, 1, 0, 10000]]
    segment_sha = hashlib.sha256(json.dumps(segments, separators=(',', ':')).encode()).hexdigest()
    for surah in (1, 2, 3):
        for ayah in (1, 3, 5, 7, 9):
            sample, packet = packet_fixture()
            sample.update(surah=surah, ayah=ayah, hf_audio_sha256=f'synthetic-{surah}-{ayah}', hf_duration_ms=10000,
                          supplied_segments_sha256=segment_sha, duration_difference_ms=0,
                          vad={'agreement': 1, 'source_clip_speech_iou': 1, 'source_segments_speech_iou': 1, 'clip_segments_speech_iou': 1},
                          log_mel={'score': 1})
            sample['envelope'].update(measured=True, score=1, best_lag_ms=0)
            rows.append(sample)
            originals.append({'surah': surah, 'ayah': ayah, 'hf_audio_sha256': sample['hf_audio_sha256'],
                              'source_offset_ms': 1000, 'duration_ms': 10000})
            packet.update(surah=surah, ayah=ayah, hf_audio_sha256=sample['hf_audio_sha256'], source_offset_ms=1000, hf_duration_ms=10000)
            packet_rows.append(packet)
            native = {'surah': surah, 'ayah': ayah, 'hf_audio_sha256': sample['hf_audio_sha256'],
                      'clip_decoded_native_sample_count': 441000, 'exact_native_source_sample_start': 44100,
                      'source_interior_begin_sample': 52920, 'source_interior_end_sample_exclusive': 476280,
                      'clip_interior_begin_sample': 8820, 'clip_interior_end_sample_exclusive': 432180,
                      'native_pcm_identity_proven': True, 'rmse': 0, 'maximum_absolute_sample_difference': 0,
                      'native_interior_sample_count': 423360}
            native_rows.append(native)
            pcm_rows.append({'surah': surah, 'ayah': ayah,
                             'boundary_support': {'clip_decoded_sample_count': 80000, 'nominal_interval_extends_source_EOF': False},
                             'vad_mask_runs': {'hop_ms': 1, 'frame_count': 10000,
                                               'source_speech': [[0, 10000]], 'clip_speech': [[0, 10000]]}})
            supplied[f'{surah}:{ayah}'] = {'segments': copy.deepcopy(segments)}
    record = {'config': 'synthetic', 'status': 'measured', 'samples': rows, 'source_sha256': source_hashes,
              'classification': {'pattern': 'unresolved', 'v2_eligible': False, 'lag_trends': []}}
    old = {'verification_status': 'failed', 'catalog_source_sha256': source_hashes, 'samples': originals}
    replay = {'errors': [], 'input_fingerprints': input_fingerprints(record), 'samples': pcm_rows}
    packet = {'config': 'synthetic', 'all_input_hashes_unchanged': True, 'samples': packet_rows,
              'sources': {s: {'sha256': value, 'stream': {'sample_rate': '44100'}} for s, value in source_hashes.items()}}
    native = {'config': 'synthetic', 'all_input_hashes_unchanged': True, 'samples': native_rows,
              'decode_settings': {'sample_rate_hz': 44100, 'lag_search': False, 'resampling_rate_change': False},
              'source_decoded_native_sample_counts': {s: 1000000 for s in source_hashes}}
    return record, replay, True, old, packet, native, supplied


class ClassificationReviewTest(unittest.TestCase):
    def test_complete_independent_proof_can_propose_candidate_without_mutating_raw(self):
        inputs = reviewed_fixture()
        result = review_record(*inputs)
        self.assertTrue(result['v2_adoption_candidate'])
        self.assertEqual(result['reviewed_pattern'], 'codec_processing_only')
        self.assertFalse(inputs[0]['classification']['v2_eligible'])
        self.assertFalse(result['publication_changed'])

    def test_one_old_source_missing_blocks_otherwise_complete_candidate(self):
        inputs = list(reviewed_fixture())
        inputs[3]['catalog_source_sha256'] = {**inputs[3]['catalog_source_sha256']}
        del inputs[3]['catalog_source_sha256']['2']
        self.assertFalse(review_record(*inputs)['v2_adoption_candidate'])

    def test_one_hf_payload_changed_blocks_candidate(self):
        inputs = list(reviewed_fixture())
        inputs[3]['samples'][5]['hf_audio_sha256'] = 'changed'
        self.assertFalse(review_record(*inputs)['v2_adoption_candidate'])

    def test_one_numeric_gate_failure_blocks_native_identity_candidate(self):
        inputs = list(reviewed_fixture())
        inputs[0]['samples'][5]['duration_difference_ms'] = 30.125
        result = review_record(*inputs)
        self.assertFalse(result['v2_adoption_candidate'])
        self.assertNotEqual(result['reviewed_pattern'], 'codec_processing_only')
        self.assertTrue(result['codec_identity_position_component_proven'])

    def test_missing_segments_prevents_otherwise_complete_candidate(self):
        inputs = list(reviewed_fixture())
        inputs[-1] = None
        self.assertFalse(review_record(*inputs)['v2_adoption_candidate'])

    def test_changed_pcm_replay_fingerprint_is_not_reused(self):
        inputs = list(reviewed_fixture())
        inputs[1]['input_fingerprints'] = {'config': 'another'}
        self.assertFalse(review_record(*inputs)['v2_adoption_candidate'])

    def test_segment_hash_rolling_change_blocks_replay(self):
        sample, pcm, segments = vad_fixture()
        segments[0][0] = 2
        self.assertEqual(replay_segments(sample, pcm, segments)['reason'], 'SEGMENTS_ROLLING_SHA_MISMATCH')

    def test_exact_pcm_bound_has_no_submillisecond_tolerance(self):
        sample, pcm, segments = vad_fixture(sample_count=81, endpoint=11)
        result = replay_segments(sample, pcm, segments)
        self.assertTrue(result['grid_valid'])
        self.assertTrue(result['raw_grid_metric_matched'])
        self.assertEqual(result['agreement'], 1)
        self.assertEqual(result['segment_overruns'][0]['overrun_ms'], .875)
        self.assertFalse(result['verified'])
        self.assertEqual(result['reason'], 'EXACT_PCM_SEGMENT_BOUND_VIOLATION')

    def test_segment_at_exact_pcm_end_replays(self):
        sample, pcm, segments = vad_fixture()
        result = replay_segments(sample, pcm, segments)
        self.assertTrue(result['verified'])
        self.assertEqual(result['agreement'], 1)

    def test_fractional_start_uses_first_grid_point_inside_interval(self):
        segments = [[1, 1, 0.125, 10]]
        sample, pcm, _ = vad_fixture()
        sample['supplied_segments_sha256'] = hashlib.sha256(json.dumps(segments, separators=(',', ':')).encode()).hexdigest()
        sample['vad'].update(source_segments_speech_iou=.9, clip_segments_speech_iou=.9)
        result = replay_segments(sample, pcm, segments)
        self.assertTrue(result['verified'])
        self.assertEqual(result['agreement'], .9)

    def test_large_overrun_is_explicit_and_not_clamped(self):
        sample, pcm, segments = vad_fixture(endpoint=210)
        result = replay_segments(sample, pcm, segments)
        self.assertFalse(result['grid_valid'])
        self.assertEqual(result['segment_overruns'][0]['overrun_ms'], 200)

    def test_invalid_rle_is_not_repaired(self):
        with self.assertRaisesRegex(ValueError, 'INVALID_REPLAY_VAD_RUNS'):
            expand_runs([[0, 11]], 10)

    def test_zero_or_boolean_fraction_denominator_rejected(self):
        for denominator in (0, True):
            with self.assertRaisesRegex(ValueError, 'EXACT_FRACTION_REQUIRED'):
                fraction({'numerator': 1, 'denominator': denominator})

    def test_reported_float_does_not_override_exact_fraction(self):
        self.assertEqual(fraction({'numerator': 241, 'denominator': 8, 'value': 0}), Fraction(241, 8))

    def test_packet_shift_order_and_priming_are_exact(self):
        sample, packet = packet_fixture()
        result = packet_position(sample, packet)
        self.assertEqual(result['decoded_start_ms'], 1000)
        self.assertEqual(result['decoded_lag_ms'], 0)
        self.assertTrue(result['envelope_position_linked'])

    def test_encoded_proven_does_not_approve_wrong_offset(self):
        sample, packet = packet_fixture(offset=800)
        result = packet_position(sample, packet)
        self.assertEqual(result['decoded_lag_ms'], 200)
        self.assertFalse(result['lag_within_30ms'])

    def test_stale_declared_packet_lag_is_rejected(self):
        sample, packet = packet_fixture(offset=800)
        packet['packet_proof']['decoded_coordinate_minus_declared_offset_ms']['numerator'] = 0
        with self.assertRaisesRegex(ValueError, 'COORDINATE_MISMATCH'):
            packet_position(sample, packet)

    def test_discontinuous_landmark_clock_rejected(self):
        sample, packet = packet_fixture()
        packet['packet_proof']['fixed_landmarks'][3]['source_packet']['pts'] += 1
        with self.assertRaisesRegex(ValueError, 'CLOCK_DISCONTINUITY'):
            packet_position(sample, packet)

    def test_matching_native_48k_rate_preserved(self):
        row, position = native_fixture(48000)
        result = native_identity(row, position, 48000 * 4)
        self.assertTrue(result['exact_fixed_interior_identity'])
        self.assertTrue(result['full_native_window_available'])

    def test_identity_boolean_cannot_override_nonzero_delta(self):
        row, position = native_fixture()
        row['maximum_absolute_sample_difference'] = .001
        self.assertFalse(native_identity(row, position, 44100 * 4)['exact_fixed_interior_identity'])

    def test_native_interior_never_claims_unavailable_full_window(self):
        row, position = native_fixture()
        result = native_identity(row, position, 44100 * 3 - 100)
        self.assertTrue(result['exact_fixed_interior_identity'])
        self.assertFalse(result['full_native_window_available'])
        self.assertGreater(result['native_end_overrun_ms'], 0)

    def test_raw_drift_without_wave_clock_stays_boundary_confounded(self):
        sample = {'surah': 1, 'ayah': 1, 'hf_audio_sha256': 'clipsha', 'source_offset_ms': 0,
                  'hf_duration_ms': 10, 'supplied_segments_sha256': 'segmentsha',
                  'envelope': {'measured': True, 'score': 1, 'best_lag_ms': 0, 'source_sample_start': 0},
                  'vad': {'agreement': 1}, 'duration_difference_ms': 0, 'log_mel': {'score': 1}}
        raw = {'pattern': 'increasing_drift', 'lag_trends': [{'increasing_drift_evidence': True}], 'v2_eligible': False}
        record = {'config': 'fixture', 'status': 'measured', 'samples': [sample], 'source_sha256': {'1': 'source'}, 'classification': raw}
        old = {'verification_status': 'failed', 'catalog_source_sha256': {'1': 'source'},
               'samples': [{'surah': 1, 'ayah': 1, 'hf_audio_sha256': 'clipsha', 'source_offset_ms': 0, 'duration_ms': 10}]}
        pcm = {'config': 'fixture', 'input_fingerprints': input_fingerprints(record), 'errors': [],
               'samples': [{'surah': 1, 'ayah': 1, 'boundary_support': {'nominal_interval_extends_source_EOF': True}}]}
        before = copy.deepcopy(raw)
        result = review_record(record, pcm, True, old)
        self.assertEqual(result['reviewed_pattern'], 'boundary_confounded')
        self.assertFalse(result['genuine_drift_proven'])
        self.assertFalse(result['v2_adoption_candidate'])
        self.assertEqual(record['classification'], before)


if __name__ == '__main__':
    unittest.main()
