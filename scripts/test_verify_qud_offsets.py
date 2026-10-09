"""Unit tests for the acoustic gate; real network evidence is separate."""
import importlib.util
import pathlib
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('offset_audit', pathlib.Path(__file__).with_name('verify-qud-offsets.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class OffsetGateTests(unittest.TestCase):
    def setUp(self):
        self.source = np.random.default_rng(17).normal(size=32000)
        self.clip = self.source[8000:12000].copy()

    def test_exact_match_passes(self):
        result = audit.compare(self.source, self.clip, 1000, 500)
        self.assertTrue(result['passed'])
        self.assertEqual(result['best_lag_ms'], 0)

    def test_constant_lag_outside_acceptance_remains_failed(self):
        result = audit.compare(self.source, self.clip, 1100, 500)
        self.assertAlmostEqual(result['score'], 1)
        self.assertEqual(result['best_lag_ms'], -100)
        self.assertFalse(result['passed'])

    def test_duration_delta_over_30ms_is_rejected(self):
        self.assertFalse(audit.compare(self.source, self.clip, 1000, 531)['passed'])

    def test_wrong_slice_is_rejected(self):
        self.assertFalse(audit.compare(self.source, self.clip, 2000, 500)['passed'])

    def test_silence_cannot_pass_as_a_match(self):
        result = audit.compare(np.zeros(32000), np.zeros(4000), 1000, 500)
        self.assertFalse(result['passed'])


if __name__ == '__main__':
    unittest.main()
