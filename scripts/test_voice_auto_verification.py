import unittest
import importlib.util
from pathlib import Path
from lib.voice_auto_verification import alignment_evidence, calibrated_threshold, decide_voice, fingerprint_conflicts


class VoiceDecisionTests(unittest.TestCase):
    def test_real_probe_and_readiness_are_observations_not_v2_credit(self):
        spec = importlib.util.spec_from_file_location('voice_report', Path(__file__).with_name('auto-verify-voices.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = {'results': {'fixture': {'V1': {'content_fingerprint_scope': [{'sha256': 'a' * 64}]},
                                          'V2': {'passed': False}, 'voice_identity_status': 'unverified'}}}
        module.attach_aligner_observations(report,
            {'http_status': 404, 'code': 'ALIGNMENT_HTTP_404', 'requests': 1, 'audio_sha256': 'a' * 64,
             'endpoint': 'do-not-copy', 'error_body': 'do-not-copy'}, 'b' * 64,
            {'alignment_posts': 0, 'checks': [{'path': '/health/ready', 'http_status': 503,
                                             'code': 'MODEL_NOT_CONFIGURED', 'body': 'do-not-copy'}]}, 'c' * 64)
        self.assertFalse(report['results']['fixture']['V2']['passed'])
        self.assertEqual(report['results']['fixture']['voice_identity_status'], 'unverified')
        self.assertEqual(report['actual_aligner_probe']['probe_artifact_sha256'], 'b' * 64)
        self.assertEqual(report['actual_aligner_readiness']['readiness_artifact_sha256'], 'c' * 64)
        self.assertNotIn('endpoint', report['actual_aligner_probe'])
        self.assertNotIn('body', report['actual_aligner_readiness']['checks'][0])

    def test_never_confirmed_and_never_public(self):
        passed = {'passed': True}
        for model in (True, False):
            result = decide_voice(passed, passed, passed, passed, model)
            self.assertEqual(result['voice_identity_status'], 'auto_verified')
            self.assertFalse(result['human_confirmation_changed'])
            self.assertFalse(result['publication_changed'])
            self.assertFalse(result['license_changed'])

    def test_every_available_check_and_youtube_file_required(self):
        yes, no = {'passed': True}, {'passed': False}
        for position in range(4):
            evidence = [yes, yes, yes, yes]
            evidence[position] = no
            self.assertEqual(decide_voice(*evidence, True)['voice_identity_status'], 'unverified')
        self.assertEqual(decide_voice(yes, yes, no, no, False)['voice_identity_status'], 'auto_verified')
        self.assertEqual(decide_voice(yes, yes, yes, yes, False, True)['voice_identity_status'], 'unverified')

    def test_single_recitation_v4_not_applicable(self):
        yes = {'passed': True}
        self.assertEqual(decide_voice(yes, yes, yes, {'status': 'not_applicable'}, True)['voice_identity_status'], 'auto_verified')

    def test_alignment_success_or_forced_reference_alone_is_not_content_proof(self):
        self.assertFalse(alignment_evidence({'samples': [{'surah': 1, 'http_status': 200, 'confidence': 1}]})['passed'])
        rows = [{'surah': surah, 'measurement_scope': 'actual_aligner_response', 'confidence': .99,
                 'calibrated_confidence_threshold': .9, 'calibration_evidence_sha256': 'a' * 64,
                 'recognized_reference_matches': True, 'word_coverage_complete': True,
                 'audio_sha256': 'b' * 64, 'response_sha256': 'c' * 64} for surah in (1, 112, 36)]
        self.assertTrue(alignment_evidence({'samples': rows})['passed'])
        rows[0]['recognized_reference_matches'] = False
        self.assertFalse(alignment_evidence({'samples': rows})['passed'])

    def test_calibration_must_derive_threshold_and_reject_overlap(self):
        result = calibrated_threshold([.8, .9], [.2, .3])
        self.assertAlmostEqual(result['threshold'], .55)
        self.assertFalse(calibrated_threshold([.3], [.3])['accepted'])
        self.assertFalse(calibrated_threshold([], [.2])['accepted'])

    def test_content_duplicate_is_cross_reader_not_cross_recording_same_reader(self):
        rows = [{'slug': slug, 'reciter_id': reader, 'actual_source_sha256': 'a' * 64,
                 'source_sha256_matches': True, 'status': 'measured'}
                for slug, reader in [('first', 'one'), ('second', 'one')]]
        self.assertEqual(fingerprint_conflicts(rows), [])
        rows[1]['reciter_id'] = 'two'
        self.assertEqual(fingerprint_conflicts(rows)[0]['recitations'], ['first', 'second'])

    def test_report_rejects_speaker_pass_when_calibration_or_sibling_coverage_missing(self):
        spec = importlib.util.spec_from_file_location('voice_report', Path(__file__).with_name('auto-verify-voices.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        catalog = {'recitations': [{'slug': slug, 'reciter_id': 'reader', 'name_ar': 'fixture', 'channel': 'mp3quran'} for slug in ('one', 'two')]}
        identity = {'folder_checks': [{'slug': slug, 'folder_classification': 'DESCRIPTIVE_FOLDER_ALIAS_MATCH'} for slug in ('one', 'two')],
                    'duration_quality_comparison': {'measurements': []}}
        speakers = {'model_loaded': True, 'calibration': {'accepted': False, 'reason': 'CALIBRATION_CLASSES_OVERLAP'},
                    'results': {'one': {'V3': {'passed': True}, 'V4': {'passed': True}}}, 'measurements': []}
        result = module.build(catalog, identity, speakers=speakers)['results']['one']
        self.assertFalse(result['V3']['passed'])
        self.assertEqual(result['V3']['reason'], 'CALIBRATION_CLASSES_OVERLAP')
        self.assertFalse(result['V4']['passed'])
        self.assertEqual(result['V4']['missing_recitations'], ['two'])
        self.assertEqual(result['voice_identity_status'], 'unverified')


if __name__ == '__main__':
    unittest.main()
