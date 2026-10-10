"""Controls for exact native position, coverage, and unchanged acceptance."""
import unittest
import numpy as np

from prove_qud_native_pcm import (MINIMUM_INTERIOR, RATE, TRIM, compare_fixed,
                                  exact_native_start, fixed_interval, require_supported_native_rates,
                                  position_diagnostics)


class NativePcmTest(unittest.TestCase):
    def test_unlisted_matching_native_rate_is_explicitly_unsupported(self):
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_NATIVE_MP3_RATE'):
            require_supported_native_rates(96000, 96000)

    def test_matching_supported_rate_is_preserved(self):
        self.assertEqual(require_supported_native_rates(48000, '48000'), 48000)
        proof = {'source_decoded_pcm_coordinate_of_clip_decoded_zero_ms':
                 {'numerator': -1105, 'denominator': 48}}
        self.assertEqual(exact_native_start(proof, 48000), -1105)
        self.assertEqual(fixed_interval(0, 48000 * 2, 48000), (9600, 86400))

    def test_mismatched_native_rates_are_never_resampled_to_pass(self):
        with self.assertRaisesRegex(ValueError, 'UNSUPPORTED_MISMATCHED'):
            require_supported_native_rates(44100, 22050)

    def test_packet_identity_does_not_approve_wrong_declared_offset(self):
        flags = position_diagnostics(0, RATE, RATE * 2, RATE, 1000, 0)
        self.assertFalse(flags['decoded_packet_lag_within_30ms'])
        self.assertEqual(flags['decoded_packet_lag_ms']['value'], -1000)

    def test_native_interior_does_not_claim_missing_full_window(self):
        flags = position_diagnostics(-1105, RATE * 2, RATE * 3, RATE, 0, 0)
        self.assertFalse(flags['full_native_source_window_available'])
        self.assertFalse(flags['retained_envelope_start_matches_native_within_half_8khz_sample'])
        flags = position_diagnostics(RATE, RATE * 2, RATE * 2, RATE, 1000, 0)
        self.assertFalse(flags['full_native_source_window_available'])

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
