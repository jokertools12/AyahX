"""Independent synthetic regressions for the B acoustic review.

No audio files, network requests, database calls or acceptance data are used.
"""
import unittest

import numpy as np
from scipy.ndimage import uniform_filter1d

from lib.acoustic_diagnostics import RATE, additional_metrics, aligned_source_envelope, rms_envelope


class SourceEnvelopeAlignmentRegression(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
