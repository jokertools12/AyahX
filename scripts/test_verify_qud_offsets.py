"""Unit tests for the acoustic gate; real network evidence is separate."""
import importlib.util
import pathlib
import json
import tempfile
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

    def test_fixed_sampling_preserves_distinct_lengths_and_distributed_verses(self):
        with tempfile.TemporaryDirectory() as scratch:
            cache = pathlib.Path(scratch)
            rows = [{'surah': s, 'ayah': a} for s, count in enumerate([7, 30, 50, 10, 12, 20, 5, 14, 40], 1) for a in range(1, count + 1)]
            (cache / 'fixture.recited.jsonl').write_text('\n'.join(json.dumps(row) for row in rows), encoding='utf-8')
            record = {'slug': 'fixture', 'audio': {'chapter_urls': {str(s): 'fixture' for s in range(1, 10)}}}
            chapters = audit.sample_chapters(cache, record)
            self.assertEqual(chapters, audit.sample_chapters(cache, record))
            self.assertEqual(len(chapters), 3)
            lengths = [sum(row['surah'] == s for row in rows) for s in chapters]
            self.assertEqual(len(set(lengths)), 3)
            selected = audit.selected_rows(cache, 'fixture', chapters)
            self.assertEqual(len(set(selected)), 15)
            for surah, length in zip(chapters, lengths):
                verses = [a for s, a in selected if s == surah]
                self.assertEqual(verses[0], 1)
                self.assertEqual(verses[-1], length)
                self.assertTrue(any(length / 3 <= a <= length * 2 / 3 for a in verses))


if __name__ == '__main__':
    unittest.main()
