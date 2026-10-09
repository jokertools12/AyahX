"""Classification/permission boundary tests; no real requests or audio."""
import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('audio_diagnosis', Path(__file__).with_name('diagnose-qud-audio.py'))
diagnosis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnosis)


def sample(surah, offset, lag, identity=True, duration=0):
    return {'surah': surah, 'source_offset_ms': offset,
            'envelope': {'measured': True, 'score': .99, 'best_lag_ms': lag},
            'log_mel': {'measured': True, 'score': .99, 'best_lag_ms': lag},
            'encoded_identity': {'proven': identity}, 'vad': {'agreement': .98},
            'duration_difference_ms': duration, 'v2_numeric_candidate': abs(lag) <= 30 and duration <= 30}


class ClassificationTests(unittest.TestCase):
    def test_youtube_is_explicitly_blocked_without_extraction(self):
        self.assertFalse(diagnosis.direct_source_allowed({'channel': 'youtube'}, 'https://cdn.example.org/source.mp3'))
        for url in ('https://youtube.com/watch?v=1', 'https://music.youtube.com/watch?v=1',
                    'https://x.googlevideo.com/stream', 'blob:local', 'http://example.org/source.mp3',
                    'https://user:pass@example.org/source.mp3'):
            self.assertFalse(diagnosis.direct_source_allowed({'channel': 'mp3quran'}, url))
        self.assertTrue(diagnosis.direct_source_allowed({'channel': 'mp3quran'}, 'https://cdn.example.org/source.mp3'))

    def test_constant_lag_stays_failed(self):
        result = diagnosis.classify([sample(1, index * 10000, -50) for index in range(5)])
        self.assertEqual(result['pattern'], 'constant_lag')
        self.assertFalse(result['v2_eligible'])

    def test_increasing_drift_is_not_explained_away_as_codec(self):
        result = diagnosis.classify([sample(1, index * 10000, index * 20) for index in range(5)])
        self.assertEqual(result['pattern'], 'increasing_drift')
        self.assertFalse(result['v2_eligible'])

    def test_identity_proof_is_required_and_duration_never_relaxed(self):
        samples = [sample(1, index * 10000, 1) for index in range(5)]
        self.assertTrue(diagnosis.classify(samples)['v2_eligible'])
        samples[0]['duration_difference_ms'] = 31
        samples[0]['v2_numeric_candidate'] = False
        result = diagnosis.classify(samples)
        self.assertEqual(result['pattern'], 'codec_processing_only')
        self.assertFalse(result['v2_eligible'])
        self.assertIn('duration_difference_above_30ms', result['v2_blockers'])
        samples[0]['encoded_identity']['proven'] = False
        self.assertEqual(diagnosis.classify(samples)['pattern'], 'unresolved')

    def test_no_evidence_never_becomes_a_recording_mismatch_claim(self):
        self.assertEqual(diagnosis.classify([])['pattern'], 'unresolved')
        samples = [sample(1, index * 10000, 1, identity=False) for index in range(5)]
        self.assertEqual(diagnosis.classify(samples)['pattern'], 'unresolved')


if __name__ == '__main__':
    unittest.main()
