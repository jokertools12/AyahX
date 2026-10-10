import unittest
from report_qud_t7_execution import canonical, digest, report


class PublicEvidenceTests(unittest.TestCase):
    def fixture(self):
        manifest = {'results': {'one': {'cohort': 'boundary_confounded', 'channel': 'mp3quran',
                    'riwayah': 'hafs', 'retained_v1_status': 'failed', 'samples': [{'surah': 112, 'ayah': 1}]}}}
        checkpoint = {'bindings': {'scratch': 'private-path', 'calculator_sha256': {'kernel': 'a' * 64}}, 'sequence': 1,
                      'state': {'results': {'one': {'verification_status': 'failed', 'samples': [{'surah': 112, 'ayah': 1,
                          't7_v1_passed': False, 'interior_v1': {'score': .949999997, 'best_lag_ms': 0},
                          'full_v1_diagnostic': {'best_lag_ms': 0}, 'duration_difference_ms': 0,
                          'full_source_window_complete': True}]}}, 'resources': {'signed-url': 'private'},
                          'real_measurements_complete': True}}
        checkpoint['checkpoint_sha256'] = digest(canonical(checkpoint))
        return manifest, checkpoint

    def test_preserves_raw_failure_and_excludes_private_sources(self):
        manifest, checkpoint = self.fixture()
        result = report(manifest, checkpoint, 'b' * 64)
        self.assertEqual(result['results']['one']['samples'][0]['interior_v1']['score'], .949999997)
        self.assertEqual(result['counts'], {'failed': 1})
        self.assertEqual(result['results']['one']['measurement_summary']['minimum_interior_NCC_raw'], .949999997)
        self.assertEqual(result['results']['one']['measurement_summary']['surah_count'], 1)
        self.assertEqual(result['results']['one']['measurement_summary']['maximum_full_duration_difference_ms'], 0)
        self.assertEqual(result['results']['one']['overlapping_v1_failure_counts'], {'interior_raw_NCC_below_0.95': 1})
        self.assertNotIn('scratch', result['bindings'])
        self.assertNotIn('resources', result)
        self.assertEqual(result['database_writes'], 0)
        self.assertFalse(result['publication_changed'])

    def test_corrupt_checkpoint_cannot_be_reported_as_evidence(self):
        manifest, checkpoint = self.fixture()
        checkpoint['state']['results']['one']['verification_status'] = 'passed'
        with self.assertRaisesRegex(ValueError, 'SELF_SHA'):
            report(manifest, checkpoint, 'b' * 64)


if __name__ == '__main__':
    unittest.main()
