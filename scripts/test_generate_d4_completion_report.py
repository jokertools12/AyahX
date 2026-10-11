import tempfile
import unittest
from pathlib import Path
from generate_d4_completion_report import REQUIRED_GATES, render, t7_attempts_terminal


class CompletionReportTests(unittest.TestCase):
    def artifacts(self):
        return {
            'availability': {'recitations': [{'slug': 'reader_yt', 'reciter': 'القارئ',
                'source': 'youtube', 'riwayah': 'hafs', 'complete': 1, 'near_complete': 0,
                'partial': 0, 'unavailable': 0}]},
            'voice': {'results': {'reader_yt': {'voice_identity_status': 'unverified',
                **{key: {'passed': False, 'status': 'unverified'} for key in ('V1', 'V2', 'V3', 'V4')}}}},
            't7': {'results': {}, 'counts': {}, 'measured_samples': 0, 'real_measurements_complete': False},
            'links': {'last_checks': [{'recitation': 'reader_yt', 'status': 'youtube_metadata_ok',
                'original_url': 'https://signed.invalid?secret=must-not-leak'}]},
            'k1': {'diagnosis': 'explicit boolean AST'},
        }

    def test_pending_does_not_become_eligible_or_render_ready(self):
        with tempfile.TemporaryDirectory() as scratch:
            value = render(Path(scratch), self.artifacts())
        self.assertIn('قرارات rule-v1 غير المتوفرة: **1**', value)
        self.assertIn('pending', value)
        self.assertNotIn('must-not-leak', value)
        self.assertNotIn('جاهزة للريندر', value)
        self.assertIn('العدد الفعلي من الكتالوج: **1**', value)

    def test_partial_inventory_and_untyped_decisions_are_rejected(self):
        artifacts = self.artifacts()
        with tempfile.TemporaryDirectory() as scratch:
            inventory = {'read_only': True, 'checked_at': 'now', 'recitations': []}
            with self.assertRaisesRegex(ValueError, 'SLUGS_DIFFER'):
                render(Path(scratch), artifacts, inventory)
            inventory['recitations'] = [{'slug': 'reader_yt', 'rule_v1_eligible': 'yes'}]
            with self.assertRaisesRegex(ValueError, 'BOOLEAN'):
                render(Path(scratch), artifacts, inventory)

    def test_final_eligible_count_and_billing_delta_are_not_invented(self):
        inventory = {'read_only': True, 'checked_at': 'now', 'recitations': [
            {'slug': 'reader_yt', 'reciter_id': 'reader', 'rule_v1_eligible': False,
             'rule_v1_reasons': ['YOUTUBE_RENDER_REQUIRES_LICENSED_FILE'], 'voice_identity_status': 'unverified',
             'youtube_audio_state': 'بحاجة ملف', 'valid_complete_chapters': 0}], 'review_counts_by_type': {'voice_confirmation': 1}}
        operations = {'billing': {'railway': {'before_dollars': 20.5, 'after_dollars': 20.6}},
                      'gates': {'deployment_success': {'status': 'SUCCESS'}}, 'secret': 'must-not-leak'}
        with tempfile.TemporaryDirectory() as scratch:
            value = render(Path(scratch), self.artifacts(), inventory, operations)
        self.assertIn('قرارات rule-v1 غير المتوفرة: **0**', value)
        self.assertIn('YOUTUBE_RENDER_REQUIRES_LICENSED_FILE', value)
        self.assertIn('| railway | 20.5 | 20.6 |', value)
        self.assertNotIn('must-not-leak', value)
        self.assertIn('| deployment_success | pending', value)  # No linked deployment evidence.
        self.assertNotIn('| deployment_success | SUCCESS', value)

    def test_evidence_reference_cannot_escape_repository(self):
        with tempfile.TemporaryDirectory() as scratch:
            with self.assertRaisesRegex(ValueError, 'OUTSIDE_REPOSITORY'):
                render(Path(scratch), self.artifacts(), extra_proofs=['../private.json'])

    def test_gate_requires_existing_local_proof_and_rejects_signed_url(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            operations = {'gates': {'ci': {'status': 'passed', 'evidence_ref': 'missing.json'}}}
            self.assertIn('| ci | pending', render(root, self.artifacts(), operations=operations))
            (root / 'ci.json').write_text('{}', encoding='utf-8')
            operations['gates']['ci']['evidence_ref'] = 'ci.json'
            self.assertIn('| ci | passed;', render(root, self.artifacts(), operations=operations))
            operations['gates']['ci']['evidence_ref'] = 'https://github.com/owner/repo/actions/runs/1?token=private'
            with self.assertRaisesRegex(ValueError, 'UNSAFE_PUBLIC_PROOF_URL'):
                render(root, self.artifacts(), operations=operations)

    def test_completion_requires_all_terminal_gates_and_final_inventory(self):
        artifacts = self.artifacts()
        # Final negative evidence is accepted without inventing measurements or identity.
        artifacts['t7'] = {'real_measurements_complete': False, 'measured_samples': 0,
                          'counts': {'source_unavailable': 1}, 'results': {'reader_yt': {
                              'verification_status': 'source_unavailable', 'reason': 'SOURCE_UNAVAILABLE',
                              'expected_sample_ids': [[1, 1]], 'samples': [], 'measured_samples': 0}}}
        inventory = {'read_only': True, 'checked_at': 'now', 'flag_enabled': False,
                     'protected_verification_summary': 'D1/D3/admin verified unchanged',
                     'recitations': [{'slug': 'reader_yt', 'rule_v1_eligible': False,
                                      'rule_v1_reasons': ['YOUTUBE_RENDER_REQUIRES_LICENSED_FILE']}]}
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / 'proof.json').write_text('{}', encoding='utf-8')
            operations = {'gates': {key: {'status': 'passed', 'evidence_ref': 'proof.json'} for key in REQUIRED_GATES}}
            operations['gates']['deployment_success']['status'] = 'SUCCESS'
            operations['gates']['merge']['status'] = 'merged'
            operations['gates']['rollback']['status'] = 'not_needed'
            value = render(root, artifacts, inventory, operations)
            self.assertIn('**D4 مكتمل وفق أدلة هذه الدفعة', value)
            self.assertIn('توقف تام الآن بعد هذا التقرير. لا تبدأ D5 أو A1', value)
            self.assertIn('المراجعات البشرية التالية لا تُعتبر مقبولة', value)
            # Removing any gate, including the read-only acceptance checks, reopens the report.
            for key in REQUIRED_GATES:
                saved = operations['gates'].pop(key)
                self.assertIn('**حالة D4: pending', render(root, artifacts, inventory, operations), key)
                operations['gates'][key] = saved
            for status in ('building', 'failed', 'passed', 'rolled_back'):
                operations['gates']['deployment_success']['status'] = status
                self.assertIn('**حالة D4: pending', render(root, artifacts, inventory, operations), status)
            operations['gates']['deployment_success']['status'] = 'SUCCESS'
            operations['gates']['npm_test']['tests'] = {'failed': 1}
            self.assertIn('**حالة D4: pending', render(root, artifacts, inventory, operations))
            operations['gates']['npm_test']['tests'] = {'failed': 0, 'passed': 893, 'skipped': 11}
            self.assertIn('**حالة D4: pending', render(root, artifacts, operations=operations))
            inventory['flag_enabled'] = True
            self.assertIn('**حالة D4: pending', render(root, artifacts, inventory, operations))
            inventory['flag_enabled'] = False
            artifacts['t7']['results']['reader_yt']['verification_status'] = 'pending'
            self.assertIn('**حالة D4: pending', render(root, artifacts, inventory, operations))

    def test_terminal_t7_counts_missing_samples_without_granting_success(self):
        report = {'real_measurements_complete': False, 'measured_samples': 1,
                  'counts': {'failed': 1, 'source_unavailable': 1}, 'results': {
                      'measured': {'verification_status': 'failed', 'expected_sample_ids': [[1, 1]],
                                   'samples': [{'surah': 1, 'ayah': 1}], 'measured_samples': 1},
                      'missing': {'verification_status': 'source_unavailable', 'reason': 'SOURCE_UNAVAILABLE',
                                  'expected_sample_ids': [[2, 1]], 'samples': [], 'measured_samples': 0}}}
        self.assertTrue(t7_attempts_terminal(report))
        for key, value in [('verification_method_candidate', 'v1'), ('v1_all_samples_passed', True),
                           ('v2_all_gates_and_cause_proven', True), ('verification_status', 'pending')]:
            report['results']['missing'][key] = value
            self.assertFalse(t7_attempts_terminal(report), key)
            report['results']['missing'].pop(key)
            report['results']['missing']['verification_status'] = 'source_unavailable'
        report['results']['measured']['samples'] = []
        report['results']['measured']['measured_samples'] = 0
        report['measured_samples'] = 0
        self.assertFalse(t7_attempts_terminal(report))  # A failed source does not explain missing measurements.
        report['results']['measured']['samples'] = [{'surah': 1, 'ayah': 1}]
        report['results']['measured']['measured_samples'] = report['measured_samples'] = 1
        report['real_measurements_complete'] = True
        self.assertFalse(t7_attempts_terminal(report))  # Missing source evidence must remain visibly incomplete.


if __name__ == '__main__':
    unittest.main()
