"""Report diagnostics must preserve unavailable evidence and acceptance gates."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('failure_analysis', Path(__file__).with_name('analyze-qud-offset-failures.py'))
analysis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analysis)


class FailureAnalysisTests(unittest.TestCase):
    def catalog(self, offsets=None):
        return {'recitations': [{'slug': 'fixture', 'name_ar': 'fixture', 'channel': 'fixture', 'audio': {'chapter_offsets_ms': offsets or {}}}]}

    def test_overlapping_causes_are_not_counted_as_separate_failed_samples(self):
        evidence = {'results': {'fixture': {'verification_status': 'failed', 'samples': [{'surah': 2, 'ayah': 1, 'source_offset_ms': 1000, 'duration_ms': 100,
                     'source_offset_hypothesis': {'score': .9, 'duration_difference_ms': 31, 'best_lag_ms': 40, 'passed': False}}]}}}
        report = analysis.analyze(self.catalog(), evidence)
        self.assertEqual(report['sample_counts']['failed'], 1)
        self.assertEqual(sum(report['overlapping_failed_sample_causes'].values()), 3)
        self.assertEqual(report['source_boundary_summary']['unknown_sample_source_durations'], 1)

    def test_unavailable_chapter_sources_have_no_fake_zero_measurements(self):
        report = analysis.analyze(self.catalog({'2': 1000}), {'results': {'fixture': {'verification_status': 'source_unavailable', 'samples': []}}})
        self.assertIsNone(report['recitations'][0]['minimum_correlation'])
        self.assertEqual(report['by_offset_metadata']['chapter_offsets_ms_present']['measured_samples'], 0)
        self.assertEqual(report['status_counts'], {'source_unavailable': 1})

    def test_lag_variance_is_diagnostic_and_does_not_reject_a_pass(self):
        samples = [{'surah': 2, 'ayah': i, 'source_offset_ms': 1000, 'duration_ms': 100,
                    'source_offset_hypothesis': {'score': .99, 'duration_difference_ms': 0, 'best_lag_ms': lag, 'passed': True}}
                   for i, lag in enumerate((-25, 25), 1)]
        report = analysis.analyze(self.catalog(), {'results': {'fixture': {'verification_status': 'passed', 'samples': samples}}})
        self.assertTrue(report['recitations'][0]['lag_std_over_10ms_diagnostic'])
        self.assertEqual(report['status_counts'], {'passed': 1})
        self.assertFalse(report['overlapping_failed_recitation_causes'])


if __name__ == '__main__':
    unittest.main()
