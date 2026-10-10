import copy
import unittest
from report_qud_audio_diagnosis import build, markdown


def fixture():
    meta = {'slug': 'actual_slug', 'riwayah': 'hafs_an_asim', 'channel': 'provider', 'audio_category': 'by_surah', 'style': 'murattal', 'audio': {}}
    old = {'verification_status': 'failed', 'samples': [{'source_offset_hypothesis': {'score': .8, 'duration_difference_ms': 31, 'best_lag_ms': 0}}]}
    raw = {'status': 'measured', 'classification': {'pattern': 'unresolved'}}
    checked = {'reviewed_pattern': 'unresolved', 'v2_adoption_candidate': False, 'blockers': ['CAUSE_UNPROVEN']}
    audit = {'config': meta['slug'], 'unique_ayahs': 7, 'chapters': [{'complete_against_hafs': True}]}
    return ({'recitations': [meta]}, {'results': {meta['slug']: old}}, {'results': {meta['slug']: raw}},
            {'validation_errors': [], 'results': {meta['slug']: checked}}, {'configs': [audit]})


class ReportTest(unittest.TestCase):
    def test_non_hafs_is_never_published_even_with_numeric_candidate(self):
        args = fixture()
        args[0]['recitations'][0]['riwayah'] = 'warsh_an_nafi'
        args[3]['results']['actual_slug']['v2_adoption_candidate'] = True
        row = build(*args)['recitations'][0]
        self.assertFalse(row['published'])
        self.assertIn('non_hafs_canonical_text_unavailable', row['publication_reasons'])

    def test_unknown_cause_is_not_different_audio_and_counts_overlap(self):
        result = build(*fixture())
        self.assertEqual(result['reviewed_cause_counts'], {'unresolved': 1})
        row = result['recitations'][0]
        self.assertEqual(row['v1_failed_sample_causes'], {'low_correlation': 1, 'duration_difference': 1})
        self.assertFalse(row['published'])

    def test_partial_main_is_rejected(self):
        args = fixture()
        args[2]['results'].clear()
        with self.assertRaisesRegex(ValueError, 'COMPLETE_MATCHING'):
            build(*args)

    def test_local_error_is_not_an_audio_failure(self):
        args = fixture()
        args[2]['results']['actual_slug']['status'] = 'diagnostic_error'
        with self.assertRaisesRegex(ValueError, 'NOT_AN_AUDIO_RESULT'):
            build(*args)

    def test_proof_error_blocks_completion(self):
        args = fixture()
        args[3]['results']['actual_slug']['proof_errors'] = ['STALE_SOURCE']
        with self.assertRaisesRegex(ValueError, 'INDEPENDENT_REVIEW_ERRORS'):
            build(*args)

    def test_candidate_does_not_publish_or_replace_v1(self):
        args = fixture()
        args[3]['results']['actual_slug']['v2_adoption_candidate'] = True
        before = copy.deepcopy(args)
        result = build(*args)
        self.assertEqual(result['v2_adoption_candidates'], ['actual_slug'])
        self.assertFalse(result['recitations'][0]['published'])
        self.assertEqual(args, before)
        self.assertIn('تغطية HF التاريخية', markdown(result))


if __name__ == '__main__':
    unittest.main()
