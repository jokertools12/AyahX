"""Controls for exact native position, coverage, and unchanged acceptance."""
import unittest
import numpy as np

from prove_qud_native_pcm import (MINIMUM_INTERIOR, RATE, TRIM, compare_fixed,
                                  exact_native_start, fixed_interval, require_supported_native_rates)


class NativePcmTest(unittest.TestCase):
    def test_non_44100_matching_native_rates_are_explicitly_unsupported(self):
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_NATIVE_RATE_NON_44100'):
            require_supported_native_rates(48000, 48000)

    def test_mismatched_native_rates_are_never_resampled_to_pass(self):
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_MISMATCHED'):
            require_supported_native_rates(44100, 22050)

    def test_packet_fraction_yields_integer_without_rounding(self):
        proof = {'source_decoded_pcm_coordinate_of_clip_decoded_zero_ms':
                 {'numerator': -11050, 'denominator': 441}}
        self.assertEqual(exact_native_start(proof), -1105)

    def test_non_integer_position_is_rejected(self):
        proof = {'source_decoded_pcm_coordinate_of_clip_decoded_zero_ms':
                 {'numerator': 1, 'denominator': 1}}
        with self.assertRaisesRegex(ValueError, 'NOT_AN_EXACT_INTEGER'):
            exact_native_start(proof)

    def test_first_clip_negative_origin_only_allowed_with_complete_interior(self):
        self.assertEqual(fixed_interval(-1105, RATE * 2), (TRIM - 1105, RATE * 2 - TRIM - 1105))
        with self.assertRaisesRegex(ValueError, 'PRECEDES'):
            fixed_interval(-TRIM - 1, RATE * 2)

    def test_short_or_truncated_interior_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'SHORTER'):
            fixed_interval(0, MINIMUM_INTERIOR + 2 * TRIM - 1)
        signal = np.ones(RATE, dtype=np.float32)
        with self.assertRaisesRegex(ValueError, 'COMPLETE_FINITE'):
            compare_fixed(signal, signal[:-1])

    def test_identity_is_exact_and_has_no_acceptance_side_effect(self):
        signal = np.random.default_rng(14).normal(size=RATE).astype(np.float32)
        metric = compare_fixed(signal, signal.copy())
        self.assertTrue(metric['native_pcm_identity_proven'])
        self.assertEqual(metric['maximum_absolute_sample_difference'], 0)
        self.assertFalse(metric['changes_v1_acceptance'])
        self.assertFalse(metric['accepts_v2'])
        shifted = np.roll(signal, 1)
        self.assertFalse(compare_fixed(signal, shifted)['native_pcm_identity_proven'])


if __name__ == '__main__':
    unittest.main()
