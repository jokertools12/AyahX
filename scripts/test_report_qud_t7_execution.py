import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from report_qud_t7_execution import canonical, digest, main, report


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

    def test_resource_proof_retains_hash_without_private_url_or_path(self):
        manifest, checkpoint = self.fixture()
        checkpoint.pop('checkpoint_sha256')
        checkpoint['state']['started_at'] = '2026-10-10T14:41:00+00:00'
        checkpoint['state']['resources']['hf-index'] = {
            'status': 'complete', 'sha256': 'c' * 64, 'bytes': 123,
            'url': 'https://private.invalid/signed', 'path': 'private-file'}
        checkpoint['checkpoint_sha256'] = digest(canonical(checkpoint))
        result = report(manifest, checkpoint, 'b' * 64)
        self.assertEqual(result['hf_index_resource'], {
            'status': 'complete', 'sha256': 'c' * 64, 'bytes': 123})
        self.assertEqual(result['run_started_at'], '2026-10-10T14:41:00+00:00')

    def test_cli_hash_matches_written_bytes_and_prior_evidence_is_bound(self):
        manifest, checkpoint = self.fixture()
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            raw_manifest = canonical(manifest)
            (root / 'manifest.json').write_bytes(raw_manifest)
            (root / 'checkpoint.json').write_bytes(canonical(checkpoint))
            args = ['report', '--manifest', str(root / 'manifest.json'), '--manifest-sha', digest(raw_manifest),
                    '--checkpoint', str(root / 'checkpoint.json'), '--prior-checkpoint', str(root / 'checkpoint.json'),
                    '--out', str(root / 'out.json')]
            output = io.StringIO()
            with patch('sys.argv', args), redirect_stdout(output):
                main()
            raw_result = (root / 'out.json').read_bytes()
            self.assertEqual(json.loads(output.getvalue())['report_sha256'], digest(raw_result))
            self.assertNotIn(b'\r\n', raw_result)
            self.assertEqual(json.loads(raw_result)['previous_invocations'][0]['counts'], {'failed': 1})

            changed = json.loads(canonical(checkpoint))
            changed.pop('checkpoint_sha256')
            changed['bindings']['calculator_sha256']['kernel'] = 'c' * 64
            changed['checkpoint_sha256'] = digest(canonical(changed))
            (root / 'other.json').write_bytes(canonical(changed))
            args[args.index('--prior-checkpoint') + 1] = str(root / 'other.json')
            with patch('sys.argv', args), self.assertRaisesRegex(ValueError, 'PRIOR_CHECKPOINT_BINDINGS_MISMATCH'):
                main()


if __name__ == '__main__':
    unittest.main()
