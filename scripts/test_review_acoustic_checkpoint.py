"""Synthetic boundary tests for the independent, local-only B reviewer."""

import copy
import unittest

from review_acoustic_checkpoint import lag_trends, numeric_gate


def sample(surah=1, offset=0, lag=0):
    return {'surah': surah, 'source_offset_ms': offset,
            'envelope': {'measured': True, 'score': .9, 'best_lag_ms': lag},
            'vad': {'agreement': .9}, 'duration_difference_ms': 30,
            'v2_numeric_candidate': True}


class IndependentReviewTest(unittest.TestCase):
    def test_inclusive_numeric_boundaries(self):
        for lag in (-30, 0, 30):
            with self.subTest(lag=lag):
                self.assertTrue(numeric_gate(sample(lag=lag)))

    def test_one_sample_over_boundary_cannot_be_rounded(self):
        for lag in (-30.125, 30.125):
            with self.subTest(lag=lag):
                self.assertFalse(numeric_gate(sample(lag=lag)))

    def test_stale_true_flag_cannot_override_numeric_failure(self):
        row = sample()
        row['duration_difference_ms'] = 30.125
        self.assertFalse(numeric_gate(row))

    def test_nonfinite_boolean_and_string_numbers_rejected(self):
        for value in (True, False, float('nan'), float('inf'), float('-inf'), '.9', None):
            for field in ('score', 'lag', 'vad', 'duration'):
                with self.subTest(value=value, field=field):
                    row = copy.deepcopy(sample())
                    if field in ('score', 'lag'):
                        row['envelope']['score' if field == 'score' else 'best_lag_ms'] = value
                    elif field == 'vad':
                        row['vad']['agreement'] = value
                    else:
                        row['duration_difference_ms'] = value
                    self.assertFalse(numeric_gate(row))

    def test_chapter_intercepts_must_not_create_drift(self):
        rows = [sample(surah=surah, offset=offset, lag=lag)
                for surah, lag in ((1, -100), (2, 0), (3, 100))
                for offset in (0, 100000, 200000)]
        trends = lag_trends(rows)
        self.assertEqual(len(trends), 3)
        self.assertTrue(all(t['fitted_lag_change_ms'] == 0 and not t['increasing_drift_evidence'] for t in trends))

    def test_actual_within_chapter_clock_drift_detected(self):
        rows = [sample(offset=offset, lag=lag) for offset, lag in ((0, 10), (100000, 25), (200000, 45))]
        trend = lag_trends(rows)[0]
        self.assertAlmostEqual(trend['fitted_lag_change_ms'], 35)
        self.assertTrue(trend['increasing_drift_evidence'])

    def test_two_reliable_points_do_not_establish_drift(self):
        rows = [sample(offset=0, lag=0), sample(offset=100000, lag=200), sample(offset=200000, lag=400)]
        rows[-1]['envelope']['score'] = .899999
        self.assertEqual(lag_trends(rows), [])


if __name__ == '__main__':
    unittest.main()
