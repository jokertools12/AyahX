"""Unit tests for the acoustic gate; real network evidence is separate."""
import importlib.util
import pathlib
import json
import io
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
import numpy as np

spec = importlib.util.spec_from_file_location('offset_audit', pathlib.Path(__file__).with_name('verify-qud-offsets.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class OffsetGateTests(unittest.TestCase):
    def setUp(self):
        self.source = np.random.default_rng(17).normal(size=32000)
        self.clip = self.source[8000:12000].copy()

    def test_early_sleep_return_still_waits_two_seconds(self):
        clock = [10.0]
        sleeps = []
        def early_sleep(seconds):
            sleeps.append(seconds)
            clock[0] += seconds / 2 if len(sleeps) == 1 else seconds
        transport = audit.SerialTransport()
        transport.last = clock[0]
        with patch('lib.hf_serial_ranges.time.monotonic', side_effect=lambda: clock[0]), patch('lib.hf_serial_ranges.time.sleep', side_effect=early_sleep):
            transport.pace()
        self.assertEqual(len(sleeps), 2)
        self.assertGreaterEqual(transport.stats['minimum_observed_interval_seconds'], 2)

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

    def test_fft_normalization_matches_direct_centered_pearson(self):
        # This reference subtracts BOTH means for EACH candidate, independently
        # of the auditor's FFT and rolling-sum energy implementation.
        source = np.random.default_rng(91).normal(0, .1, 12000) + .25
        cases = [(0, 0), (7000, 7000), (11920, 11920), (7000, 7200), (7000, 6800)]
        for true_start, expected_start in cases:
            with self.subTest(true_start=true_start, expected_start=expected_start):
                clip = source[true_start:true_start + 80] * .7 + .1
                centered_clip = clip - clip.mean()
                candidates = []
                for start in range(max(0, expected_start - 2400), min(len(source) - len(clip), expected_start + 2400) + 1):
                    window = source[start:start + len(clip)]
                    centered_window = window - window.mean()
                    score = np.dot(centered_window, centered_clip) / (np.linalg.norm(centered_window) * np.linalg.norm(centered_clip))
                    candidates.append((score, start))
                best_score, best_start = max(candidates)
                result = audit.compare(source, clip, expected_start * 1000 / audit.RATE, len(clip) * 1000 / audit.RATE)
                self.assertAlmostEqual(result['score'], best_score, places=7)
                self.assertEqual(result['best_lag_ms'], (best_start - expected_start) * 1000 / audit.RATE)

    def test_lag_sign_and_inclusive_30ms_boundary(self):
        for lag in (-30.125, -30, 30, 30.125):
            with self.subTest(lag=lag):
                result = audit.compare(self.source, self.clip, 1000 - lag, 500)
                self.assertEqual(result['best_lag_ms'], lag)
                self.assertEqual(result['passed'], abs(lag) <= 30)

    def test_short_source_is_an_explicit_failure_not_padded_audio(self):
        result = audit.compare(np.ones(100), np.ones(101), 0, 12.625)
        self.assertEqual(result, {'passed': False, 'reason': 'source_window_too_short'})

    def test_duration_boundary_and_polarity_are_not_silently_corrected(self):
        self.assertTrue(audit.compare(self.source, self.clip, 1000, 530)['passed'])
        self.assertFalse(audit.compare(self.source, self.clip, 1000, 530.125)['passed'])
        self.assertFalse(audit.compare(self.source, -self.clip, 1000, 500)['passed'])

    def test_hf_absolute_source_offset_does_not_add_chapter_base_twice(self):
        sample = audit.measure_sample(self.source, self.clip, 2, 1, 500, 1000, b'fixture', chapter_offset=500)
        self.assertTrue(sample['source_offset_hypothesis']['passed'])
        self.assertEqual(sample['source_offset_hypothesis']['best_lag_ms'], 0)
        self.assertFalse(audit.compare(self.source, self.clip, 1500, 500)['passed'])
        self.assertNotIn('chapter_plus_source_hypothesis', sample)

    def test_repeated_http_500_records_time_body_and_keeps_backoff(self):
        transport = audit.SerialTransport()
        clock, waits, starts = [100.0], [], []
        body = b'{"error":"fixture upstream failure","url":"https://fixture.invalid/?signature=private","token":"private"}'
        def sleep(seconds):
            waits.append(seconds)
            clock[0] += seconds
        def fail(*unused, **kwargs):
            starts.append(clock[0])
            raise urllib.error.HTTPError('https://fixture.invalid/', 500, 'fixture', {}, io.BytesIO(body))
        with patch.object(transport.opener, 'open', side_effect=fail), patch('lib.hf_serial_ranges.time.monotonic', side_effect=lambda: clock[0]), patch('lib.hf_serial_ranges.time.sleep', side_effect=sleep):
            with self.assertRaises(urllib.error.HTTPError):
                transport.open('https://fixture.invalid/')
        self.assertEqual(starts, [100.0, 102.0, 106.0])
        self.assertEqual(waits, [2, 4])
        self.assertEqual(len(transport.stats['http_500_events']), 3)
        for event in transport.stats['http_500_events']:
            self.assertIn('T', event['checked_at'])
            self.assertIn('fixture upstream failure', event['response_text'])
            self.assertNotIn('private', event['response_text'])
            self.assertNotIn('https://', event['response_text'])

    def test_http_500_redacts_credentials_in_non_json_response(self):
        from lib.hf_serial_ranges import safe_response_text
        text = safe_response_text(b'<Signature>private</Signature> <Password>private</Password> Cookie=private https://fixture.invalid/?signature=private Bearer private {"token":"private",')
        self.assertNotIn('private', text)
        self.assertNotIn('https://', text)

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
