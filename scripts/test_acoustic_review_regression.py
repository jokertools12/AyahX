"""Independent synthetic regressions for the B acoustic review.

No audio files, network requests, database calls or acceptance data are used.
"""
import unittest

import numpy as np
from scipy.ndimage import uniform_filter1d

from lib.acoustic_diagnostics import RATE, additional_metrics, aligned_source_envelope, drift_diagnostics, rms_envelope
from review_acoustic_checkpoint import boundary_support


class SourceEnvelopeAlignmentRegression(unittest.TestCase):
    def test_identical_pcm_has_no_source_grid_or_feature_boundary_penalty(self):
        source = np.random.default_rng(177).normal(0, .1, RATE * 5)
        for start in (8000, 8024, 8040, 8056):
            with self.subTest(start_sample=start):
                clip = source[start:start + RATE]
                result = additional_metrics(source, clip, start * 1000 / RATE,
                                            1000, [[1, 1, 0, 1000]])
                self.assertGreaterEqual(result['envelope']['score'], .90)
                self.assertEqual(result['envelope']['best_lag_ms'], 0)
                self.assertGreaterEqual(result['log_mel']['score'], .90)
                self.assertEqual(result['vad']['agreement'], 1)
                self.assertTrue(result['v2_numeric_candidate'])

    def test_exact_grid_preserves_original_neighbour_audio_context(self):
        source = np.zeros(16000)
        start, count = 8005, 5000
        source[start - 40:start] = .3
        source[start + 40:start + 2000] = .05
        source[start + count:start + count + 40] = .9
        expected = np.sqrt(np.maximum(uniform_filter1d(source ** 2, size=160,
                                                     mode='constant'), 0))[
            start:start + count:8]
        measured = aligned_source_envelope(source, start, count)
        np.testing.assert_allclose(measured, expected, atol=1e-12, rtol=1e-12)
        self.assertEqual(len(measured), len(np.arange(0, count, 8)))
        # Cropping before RMS would erase real context at both clip boundaries.
        self.assertFalse(np.allclose(measured, rms_envelope(source[start:start + count])))

    def test_exact_submillisecond_clip_at_source_end_keeps_equal_vad_masks(self):
        source = np.random.default_rng(717).normal(0, .1, 16000)
        for start in (8000, 8004, 8005, 8006, 8007):
            with self.subTest(start_sample=start):
                clip = source[start:]
                duration_ms = len(clip) * 1000 / RATE
                result = additional_metrics(source, clip, start * 1000 / RATE,
                                            duration_ms, [[1, 1, 0, duration_ms]])
                self.assertEqual(result['envelope']['source_sample_start'], start)
                self.assertEqual(result['envelope']['best_lag_ms'], 0)
                self.assertEqual(result['duration_difference_ms'], 0)
                self.assertEqual(result['vad']['agreement'], 1)

    def test_missing_source_coverage_is_not_padded_or_trimmed_into_acceptance(self):
        source = np.random.default_rng(717).normal(0, .1, 16000)
        clip = source[8000:]
        result = additional_metrics(source, clip, 2200, 1000,
                                    [[1, 1, 0, 1000]])
        self.assertFalse(result['envelope']['measured'])
        self.assertEqual(result['envelope']['reason'], 'source_window_too_short')
        self.assertFalse(result['v2_numeric_candidate'])
        self.assertEqual(result['vad']['reason'], 'envelope_match_unavailable')

    def test_trailing_padding_can_constrain_peak_and_mimic_drift(self):
        # Same spoken PCM throughout; only the final decoder output has 40ms
        # tail padding. This is a diagnostic limitation, not genuine drift.
        time = np.arange(RATE * 30) / RATE
        source = (.12 + .04 * np.sin(.53 * time) + .02 * np.sin(2.13 * time)) * np.sin(
            2 * np.pi * (173 * time + 1.71 * time * time))
        source[-2000:] = 0
        rows = []
        for offset in (0, 12500, 25000):
            start = round(offset * RATE / 1000)
            clip = source[start:start + RATE * 5]
            if offset == 25000:
                clip = np.concatenate([clip, np.zeros(320)])
            duration = len(clip) * 1000 / RATE
            row = additional_metrics(source, clip, offset, duration, [[1, 1, 0, duration]])
            row.update(surah=1, source_offset_ms=offset)
            rows.append(row)
        self.assertGreaterEqual(rows[-1]['envelope']['score'], .90)
        self.assertEqual(rows[-1]['envelope']['best_lag_ms'], -40)
        self.assertEqual(rows[-1]['duration_difference_ms'], 0)
        trend = drift_diagnostics(rows)[0]
        self.assertTrue(trend['increasing_drift_evidence'])
        self.assertAlmostEqual(trend['fitted_lag_change_ms'], 40)
        self.assertLessEqual(trend['residual_std_ms'], 10)
        support = boundary_support(len(source), len(clip), 25000, rows[-1]['envelope']['source_sample_start'])
        self.assertEqual(support['nominal_source_end_overrun_ms'], 40)
        self.assertTrue(support['selected_at_latest_complete_start'])
        self.assertTrue(support['causal_drift_requires_packet_clock_review'])


if __name__ == '__main__':
    unittest.main()
