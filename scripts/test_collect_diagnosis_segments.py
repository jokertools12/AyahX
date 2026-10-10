import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('segment_collector', Path(__file__).with_name('collect-diagnosis-segments.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class SegmentEvidenceTests(unittest.TestCase):
    def test_explicit_subset_does_not_claim_whole_replay(self):
        self.assertEqual(collector.select_targets(['a', 'b', 'c'], ['b']), ['b'])
        self.assertEqual(collector.select_targets(['a', 'b', 'c'], []), ['a', 'b', 'c'])

    def test_unknown_or_duplicate_scope_is_rejected(self):
        for requested in (['unknown'], ['a', 'a']):
            with self.assertRaisesRegex(ValueError, 'SCOPE_INVALID'):
                collector.select_targets(['a', 'b'], requested)

    def test_intervals_and_number_types_are_preserved(self):
        segments = [[1, 2, 0.0, 123.625], [3, 3, 124, 250]]
        original = copy.deepcopy(segments)
        retained = {'supplied_segments_sha256': collector.segment_sha(segments), 'hf_duration_ms': 300, 'source_offset_ms': 1000.125}
        evidence = collector.sample_evidence(segments, 300, 1000.125, retained)
        self.assertEqual(evidence['segments'], original)
        self.assertIs(type(evidence['segments'][0][2]), float)
        self.assertIs(type(evidence['segments'][1][2]), int)
        self.assertTrue(evidence['replay_input_verified'])
        self.assertEqual(collector.segment_sha(segments), collector.sha(json.dumps(segments, separators=(',', ':')).encode()))

    def test_changed_interval_or_metadata_cannot_be_healed(self):
        original = [[1, 1, 0, 100]]
        retained = {'supplied_segments_sha256': collector.segment_sha(original), 'hf_duration_ms': 100, 'source_offset_ms': 300}
        changed = [[1, 1, 0.0, 100]]
        evidence = collector.sample_evidence(changed, 100, 300, retained)
        self.assertFalse(evidence['replay_input_verified'])
        self.assertEqual(evidence['segments'], changed)
        self.assertFalse(collector.sample_evidence(original, 101, 300, retained)['replay_input_verified'])

    def test_source_unavailable_complete_record_allowed_but_partial_or_error_blocks(self):
        original = {'results': {'x': {'verification_status': 'failed'}, 'y': {'verification_status': 'passed'}}}
        report = {'original_evidence_sha256': 'sha', 'results': {'x': {'status': 'source_unavailable'}}}
        self.assertEqual(collector.validate_complete(report, original, 'sha'), ['x'])
        for incomplete in ({}, {'x': {'status': 'diagnostic_error'}}):
            with self.assertRaises(ValueError):
                collector.validate_complete({**report, 'results': incomplete}, original, 'sha')
        with self.assertRaises(ValueError):
            collector.validate_complete(report, original, 'changed')

    def test_query_whitelist_excludes_audio_and_urls(self):
        sql = collector.select_sql([(1, 1), (2, 286)])
        columns = sql.split(' FROM ')[0].removeprefix('SELECT ').split(',')
        self.assertEqual(set(columns), {'surah', 'ayah', 'segments', 'duration_ms', 'source_offset_ms'})
        for invalid in ([], [(1, 1), (1, 1)], [('1', 1)], [(True, 1)], [(0, 1)]):
            with self.assertRaises(ValueError):
                collector.select_sql(invalid)

    def test_duplicate_hf_rows_are_not_silently_overwritten(self):
        row = (1, 1, [[1, 1, 0, 100]], 100, 200)
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_HF'):
            collector.index_rows([row, row])

    def test_nonfinite_intervals_are_not_replaced_with_fake_values(self):
        with self.assertRaises(ValueError):
            collector.sample_evidence([[1, 1, 0, float('nan')]], 100, 200, {})

    def test_resume_requires_exact_input_and_script_identity(self):
        identity = {'method_version': '1', 'diagnosis_snapshot_sha256': 'snapshot', 'script_sha256': 'script'}
        collector.validate_resume({'identity': identity}, identity)
        with self.assertRaises(ValueError):
            collector.validate_resume({'identity': {**identity, 'script_sha256': 'changed'}}, identity)


if __name__ == '__main__':
    unittest.main()
