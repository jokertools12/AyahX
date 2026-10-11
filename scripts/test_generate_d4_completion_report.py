import tempfile
import unittest
from pathlib import Path
from generate_d4_completion_report import render


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


if __name__ == '__main__':
    unittest.main()
