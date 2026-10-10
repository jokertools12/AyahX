"""Classification/permission boundary tests; no real requests or audio."""
import importlib.util
from pathlib import Path
import unittest
import urllib.error


spec = importlib.util.spec_from_file_location('audio_diagnosis', Path(__file__).with_name('diagnose-qud-audio.py'))
diagnosis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnosis)


def sample(surah, offset, lag, identity=True, duration=0):
    return {'surah': surah, 'ayah': int(offset / 10000) + 1, 'source_offset_ms': offset,
            'envelope': {'measured': True, 'score': .99, 'best_lag_ms': lag},
            'log_mel': {'measured': True, 'score': .99, 'best_lag_ms': lag},
            'encoded_identity': {'proven': identity}, 'vad': {'agreement': .98},
            'interior_pcm': {'measured': True, 'passed': True, 'score': .999, 'interior_duration_ms': 1200},
            'duration_difference_ms': duration, 'v2_numeric_candidate': abs(lag) <= 30 and duration <= 30}


def valid_distribution_samples():
    samples, proof = [], {}
    for surah, count in ((1, 5), (2, 9), (3, 13)):
        ayahs = [round(index * (count - 1) / 4) + 1 for index in range(5)]
        proof[str(surah)] = {'fixed_distributed_ayahs': ayahs, 'observed_ayah_count': count}
        for index, ayah in enumerate(ayahs):
            row = sample(surah, index * 10000, 1)
            row['ayah'] = ayah
            samples.append(row)
    return samples, proof, {str(surah): True for surah in (1, 2, 3)}


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
        samples, proof, source_matches = valid_distribution_samples()
        self.assertTrue(diagnosis.classify(samples, proof, source_matches)['v2_eligible'])
        samples[0]['duration_difference_ms'] = 31
        samples[0]['v2_numeric_candidate'] = False
        result = diagnosis.classify(samples, proof, source_matches)
        self.assertEqual(result['pattern'], 'codec_processing_only')
        self.assertFalse(result['v2_eligible'])
        self.assertIn('duration_difference_above_30ms', result['v2_blockers'])
        samples[0]['encoded_identity']['proven'] = False
        self.assertEqual(diagnosis.classify(samples, proof, source_matches)['pattern'], 'unresolved')

    def test_no_evidence_never_becomes_a_recording_mismatch_claim(self):
        self.assertEqual(diagnosis.classify([])['pattern'], 'unresolved')
        samples = [sample(1, index * 10000, 1, identity=False) for index in range(5)]
        self.assertEqual(diagnosis.classify(samples)['pattern'], 'unresolved')

    def test_one_four_duplicate_and_unproved_distribution_never_qualify(self):
        samples, proof, source_matches = valid_distribution_samples()
        for insufficient in (samples[:1], samples[:4], samples[:5], samples[:-1], samples + [samples[0]]):
            self.assertFalse(diagnosis.classify(insufficient, proof, source_matches)['v2_eligible'])
        self.assertFalse(diagnosis.classify(samples, None, source_matches)['v2_eligible'])
        wrong = {**proof, '1': {**proof['1'], 'fixed_distributed_ayahs': [1, 2, 3, 4, 6]}}
        self.assertFalse(diagnosis.classify(samples, wrong, source_matches)['v2_eligible'])

    def test_source_hash_and_measured_position_are_required(self):
        samples, proof, source_matches = valid_distribution_samples()
        for matches, reason in (({**source_matches, '1': False}, 'source_changed_since_v1'),
                                ({**source_matches, '1': None}, 'unproven_old_source')):
            result = diagnosis.classify(samples, proof, matches)
            self.assertFalse(result['v2_eligible'])
            self.assertEqual(result['pattern'], 'unresolved')
            self.assertEqual(result['reason'], reason)
        samples[0]['interior_pcm']['score'] = .94
        self.assertFalse(diagnosis.classify(samples, proof, source_matches)['v2_eligible'])

    def test_missing_sample_ayah_ids_cannot_satisfy_distribution(self):
        samples, proof, _ = valid_distribution_samples()
        del samples[0]['ayah']
        self.assertFalse(diagnosis.sample_distribution(samples, proof)['verified'])

    def test_calculation_errors_are_not_mislabeled_network_source_failures(self):
        self.assertEqual(diagnosis.error_status(ValueError('VAD_MASK_SHAPE_MISMATCH'), 'calculate_sample_metrics'), 'diagnostic_error')
        self.assertEqual(diagnosis.error_status(diagnosis.duckdb.ParserException('fixture syntax'), 'fetch_hf'), 'diagnostic_error')
        self.assertEqual(diagnosis.error_status(urllib.error.URLError('fixture upstream'), 'fetch_hf'), 'source_unavailable')
        self.assertEqual(diagnosis.error_status(ValueError('AUDIO_DECODE_FAILED'), 'decode_hf_clip'), 'source_unavailable')

    def test_resume_refuses_old_calculator_kernel_and_method(self):
        calculator = {'method_version': 'fixed-v1', 'script_sha256': 'script', 'kernel_sha256': 'kernel'}
        report = {'catalog_sha256': 'catalog', 'original_evidence_sha256': 'v1', 'calculator': calculator}
        diagnosis.validate_resume(report, 'catalog', 'v1', calculator)
        for key in ('method_version', 'script_sha256', 'kernel_sha256'):
            with self.assertRaisesRegex(ValueError, 'RESUME_CALCULATOR_SHA_MISMATCH'):
                diagnosis.validate_resume(report, 'catalog', 'v1', {**calculator, key: 'changed'})
        with self.assertRaisesRegex(ValueError, 'RESUME_INPUT_SHA_MISMATCH'):
            diagnosis.validate_resume(report, 'changed', 'v1', calculator)

    def test_stale_boolean_does_not_override_final_numeric_fields(self):
        samples, proof, source_matches = valid_distribution_samples()
        samples[0]['duration_difference_ms'] = 31
        self.assertTrue(samples[0]['v2_numeric_candidate'])
        self.assertFalse(diagnosis.classify(samples, proof, source_matches)['v2_eligible'])
        samples[0]['duration_difference_ms'] = 0
        samples[0]['vad']['agreement'] = .1
        self.assertFalse(diagnosis.classify(samples, proof, source_matches)['v2_eligible'])
        for invalid in (None, float('nan'), float('inf'), -1):
            samples[0]['duration_difference_ms'] = invalid
            self.assertFalse(diagnosis.v2_numeric_acceptance(samples[0]))


if __name__ == '__main__':
    unittest.main()
