"""Synthetic numerical tests only. These are not real-source acceptance evidence."""
import unittest

import numpy as np

from lib.acoustic_diagnostics import (RATE, additional_metrics, drift_diagnostics, encoded_interior_identity, energy_vad,
                                      feature_match, log_mel, rms_envelope, segments_mask, speech_iou)


class DiagnosticTests(unittest.TestCase):
    def test_envelope_match_lag_sign_and_fixed_search(self):
        source = np.random.default_rng(31).random(2500)
        clip = source[1000:1500]
        for offset, expected in [(1000, 0), (1100, -100), (900, 100)]:
            result = feature_match(source, clip, offset, 1)
            self.assertAlmostEqual(result['score'], 1)
            self.assertEqual(result['best_lag_ms'], expected)
        self.assertLess(feature_match(source, clip, 1400, 1)['score'], .9)

    def test_centered_multiband_ncc_resists_gain_and_dc_shift(self):
        source = np.random.default_rng(7).normal(size=(2000, 3))
        clip = source[900:1100] * .2 + 13
        result = feature_match(source, clip, 9000, 10)
        self.assertAlmostEqual(result['score'], 1)
        self.assertEqual(result['best_lag_ms'], 0)

    def test_silence_cannot_pass_envelope_or_vad(self):
        result = feature_match(np.zeros(1000), np.zeros(200), 500, 1)
        self.assertFalse(result['measured'])
        self.assertIsNone(speech_iou(np.zeros(100, dtype=bool), np.zeros(100, dtype=bool)))

    def test_short_source_is_not_padded_to_match(self):
        result = feature_match(np.ones(30), np.ones(31), 0, 1)
        self.assertEqual(result['reason'], 'source_window_too_short')

    def test_feature_sizes_and_invalid_input(self):
        signal = np.random.default_rng(19).normal(size=RATE)
        self.assertEqual(len(rms_envelope(signal)), 1000)
        self.assertEqual(log_mel(signal).shape[1], 32)
        with self.assertRaises(ValueError):
            rms_envelope(np.array([np.nan]))

    def test_segments_are_unrepaired_and_silence_does_not_dominate_agreement(self):
        mask = segments_mask([[1, 2, 20, 30], [3, 3, 80, 100]], 100)
        self.assertEqual(np.sum(mask), 30)
        other = np.zeros(100, dtype=bool)
        other[20:25] = True
        self.assertAlmostEqual(speech_iou(mask, other), 5 / 30)
        with self.assertRaisesRegex(ValueError, 'OUTSIDE'):
            segments_mask([[1, 2, -1, 10]], 100)
        with self.assertRaisesRegex(ValueError, 'REQUIRED'):
            segments_mask([], 100)

    def test_vad_is_explicit_energy_proxy(self):
        mask, threshold = energy_vad(np.array([0, .0001, .1, .2]))
        self.assertFalse(mask[0])
        self.assertFalse(mask[1])
        self.assertTrue(mask[-1])
        self.assertGreaterEqual(threshold, 10 ** (-50 / 20))

    def test_duration_limit_and_large_lag_are_not_softened_by_features(self):
        rng = np.random.default_rng(17)
        source = rng.normal(0, .1, RATE * 4)
        clip = source[RATE:RATE * 2].copy()
        result = additional_metrics(source, clip, 1000, 1100, [[1, 1, 0, 1000]])
        self.assertFalse(result['v2_numeric_candidate'])
        self.assertEqual(result['duration_difference_ms'], 100)
        result = additional_metrics(source, clip, 1100, 1000, [[1, 1, 0, 1000]])
        self.assertAlmostEqual(result['envelope']['best_lag_ms'], -100, delta=1)
        self.assertFalse(result['v2_numeric_candidate'])

    def test_submillisecond_feature_grid_preserves_30ms_boundary(self):
        source = np.random.default_rng(71).normal(size=24000)
        clip = source[8000:16000]
        for offset, expected in [(970, 30), (969.875, 30.125), (1030, -30), (1030.125, -30.125)]:
            result = feature_match(source, clip, offset, 1000 / RATE)
            self.assertEqual(result['best_lag_ms'], expected)
            self.assertEqual(abs(result['best_lag_ms']) <= 30, abs(expected) <= 30)

    def test_drift_is_measured_within_each_chapter_not_across_chapters(self):
        samples = []
        for surah, lags in [(1, [0, 40, 80]), (2, [100, 100, 100])]:
            samples.extend({'surah': surah, 'source_offset_ms': index * 20000,
                            'envelope': {'measured': True, 'score': .99, 'best_lag_ms': lag}}
                           for index, lag in enumerate(lags))
        result = drift_diagnostics(samples)
        self.assertTrue(result[0]['increasing_drift_evidence'])
        self.assertFalse(result[1]['increasing_drift_evidence'])
        self.assertAlmostEqual(result[0]['slope_ms_per_second'], 2)

    def test_low_correlation_lags_cannot_establish_drift(self):
        samples = [{'surah': 1, 'source_offset_ms': index * 10000,
                    'envelope': {'measured': True, 'score': .89, 'best_lag_ms': index * 100}}
                   for index in range(4)]
        self.assertEqual(drift_diagnostics(samples), [])

    def test_contiguous_encoded_copy_is_identity_evidence_not_an_acceptance_waiver(self):
        payload = np.random.default_rng(91).bytes(12000)
        clip = b'X' * 1024 + payload + b'Y' * 1024
        result = encoded_interior_identity(b'prefix' + payload + b'suffix', clip)
        self.assertTrue(result['proven'])
        self.assertGreaterEqual(result['matched_interior_fraction'], .75)
        self.assertFalse(encoded_interior_identity(b'other' * 12000, clip)['proven'])
        edited = clip[:5000] + b'edit' + clip[5000:]
        self.assertFalse(encoded_interior_identity(b'prefix' + payload + b'suffix', edited)['proven'])
        self.assertFalse(encoded_interior_identity(payload, b'short')['proven'])


if __name__ == '__main__':
    unittest.main()
