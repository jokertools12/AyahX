import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('once', Path(__file__).with_name('verify-voice-aligner-once.py'))
once = importlib.util.module_from_spec(spec)
spec.loader.exec_module(once)


class OnceTests(unittest.TestCase):
    def request(self):
        return {'providerId': 'quranic_universal_aligner', 'audio': {'durationMs': 25000,
                'sourceUrlOrAssetId': 'https://provider.example/001.mp3', 'contentHash': 'a' * 64},
                'providerInput': {'k4_sample_contract': {'standalone_verified_sample': True,
                'verified_full_source_duration_ms': 25000, 'verified_full_source_sha256': 'a' * 64}},
                'reference': {'surahNumber': 1, 'startAyah': 1, 'endAyah': 1, 'ayahs': [{'numberInSurah': 1, 'text': 'fixture reference'}]}}

    def test_explicit_http_failures_one_request_no_body_secret(self):
        for status, code in [(402, 'ALIGNMENT_QUOTA_PAYMENT_REQUIRED'), (429, 'ALIGNMENT_RATE_LIMITED'), (503, 'ALIGNMENT_PROVIDER_UNAVAILABLE')]:
            opener = Mock()
            opener.open.side_effect = urllib.error.HTTPError('https://private.example/?secret=bad', status, 'badsecret', {'Retry-After': '90'}, io.BytesIO(b'secret response'))
            result = once.request_once(self.request(), 'https://private.example', token='privatetoken', opener=opener)
            self.assertEqual(result['code'], code)
            self.assertEqual(opener.open.call_count, 1)
            self.assertNotIn('secret', str(result))
            self.assertNotIn('privatetoken', str(result))

    def test_youtube_and_long_audio_never_requested(self):
        for field, value in [('sourceUrlOrAssetId', 'https://www.youtube.com/watch?v=fixture'), ('durationMs', 30001)]:
            request = self.request()
            request['audio'][field] = value
            with self.assertRaises(ValueError):
                once.validate_request(request)

    def test_duration_claim_without_real_standalone_clip_is_rejected(self):
        request = self.request()
        request.pop('providerInput')
        with self.assertRaisesRegex(ValueError, 'NO_FAKE_CROP'):
            once.validate_request(request)

    def test_internal_provider_explicit_selection_and_private_endpoint(self):
        request = self.request()
        request['providerId'] = 'internal_ctc'
        request['audio']['durationMs'] = 32026.067
        request['providerInput']['k4_sample_contract']['verified_full_source_duration_ms'] = 32026.067
        with self.assertRaisesRegex(ValueError, 'DURATION_LIMIT'):
            once.validate_request(request)
        once.validate_request(request, 120000)
        with patch.dict('os.environ', {'ALIGNMENT_INTERNAL_CTC_URL': 'http://worker.railway.internal/v1/align'}, clear=True):
            self.assertEqual(once.endpoint_from_environment('internal_ctc'), 'http://worker.railway.internal/v1/align')
            with self.assertRaisesRegex(ValueError, 'NOT_CONFIGURED'):
                once.endpoint_from_environment('quranic_universal_aligner')
        with patch.dict('os.environ', {'ALIGNMENT_INTERNAL_CTC_URL': 'http://public.example/v1/align'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'HTTPS_ENDPOINT'):
                once.endpoint_from_environment('internal_ctc')


if __name__ == '__main__':
    unittest.main()
