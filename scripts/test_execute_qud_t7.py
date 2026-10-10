"""Offline synthetic unit evidence only. No real voice/offset acceptance."""
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import numpy as np

import execute_qud_t7 as executor
from lib.t7_offset_execution import (AuditRequestUnavailable, SingleWindowTransport,
    canonical, digest, evaluate_recitation, fixed_position_interior, load_diagnostic_modules, measured_sample)


class RetainedScratchCase(unittest.TestCase):
    def setUp(self):
        # Intentional retained scratch. Do not use TemporaryDirectory cleanup.
        self.scratch = Path(tempfile.mkdtemp(prefix='ayahx-t7-unit-retained-'))


class CheckpointTests(RetainedScratchCase):
    def test_append_resume_and_binding(self):
        checkpoints = executor.Checkpoints(self.scratch, {'manifest_sha': 'fixture'})
        checkpoints.state['results']['one'] = {'verification_status': 'pending'}
        first = checkpoints.save()
        checkpoints.state['results']['one']['verification_status'] = 'failed'
        second = checkpoints.save()
        self.assertTrue(first.exists())
        self.assertNotEqual(first.read_bytes(), second.read_bytes())
        resumed = executor.Checkpoints(self.scratch, {'manifest_sha': 'fixture'})
        self.assertEqual(resumed.state['results']['one']['verification_status'], 'failed')
        with self.assertRaisesRegex(ValueError, 'BINDING_MISMATCH'):
            executor.Checkpoints(self.scratch, {'manifest_sha': 'different'})

    def test_corrupt_latest_stops_without_fallback(self):
        checkpoint = executor.Checkpoints(self.scratch, {'fixture': True})
        checkpoint.save()
        checkpoint.save()
        # Explicit synthetic fixture corruption, never a production file.
        (self.scratch / '00000002.json').write_bytes(b'{"broken":')
        with self.assertRaises(json.JSONDecodeError):
            executor.Checkpoints(self.scratch, {'fixture': True})
        self.assertEqual(len(list(self.scratch.glob('*.json'))), 2)

    def test_source_attempt_intent_prevents_second_request(self):
        checkpoints = executor.Checkpoints(self.scratch / 'checkpoints', {})
        url = 'https://audio.example/one.mp3'
        key = 'public-source-' + digest(url.encode())
        checkpoints.state['resources'][key] = {'status': 'attempt_started', 'phase': 'drive'}
        checkpoints.save()
        fake = type('Transport', (), {'phase': 'drive', 'validate_url': lambda self, url: None})()
        with patch.object(executor, 'download_once') as download:
            with self.assertRaises(AuditRequestUnavailable):
                executor.source_resource(checkpoints, fake, url, self.scratch)
            download.assert_not_called()

    def test_cached_bytes_are_hash_verified(self):
        checkpoints = executor.Checkpoints(self.scratch / 'checkpoints', {})
        path = self.scratch / 'fixture.audio'
        path.write_bytes(b'synthetic-only')
        checkpoints.state['resources']['key'] = {'status': 'complete', 'phase': 'hf',
                                                'sha256': digest(b'synthetic-only'), 'bytes': 14}
        self.assertEqual(executor.cached_resource(checkpoints, 'key', path), b'synthetic-only')
        path.write_bytes(b'corrupt-synthetic-only')
        with self.assertRaisesRegex(ValueError, 'CACHE_CORRUPT'):
            executor.cached_resource(checkpoints, 'key', path)

    def test_immutable_files_never_overwrite(self):
        path = self.scratch / 'fixture'
        executor.immutable_bytes(path, b'first')
        executor.immutable_bytes(path, b'first')
        with self.assertRaisesRegex(ValueError, 'NO_OVERWRITE'):
            executor.immutable_bytes(path, b'second')
        self.assertEqual(path.read_bytes(), b'first')

    def test_manifest_file_and_selection_hash_are_required(self):
        path = self.scratch / 'manifest.json'
        payload = canonical({'selection_sha256': '0' * 64})
        path.write_bytes(payload)
        with self.assertRaisesRegex(ValueError, 'INPUT_FILE_SHA256'):
            executor.locked_manifest(path, 'f' * 64)
        with self.assertRaisesRegex(ValueError, 'SELECTION_SHA256'):
            executor.locked_manifest(path, digest(payload))


class FakeClock:
    def __init__(self):
        self.value = 0.
    def time(self):
        return self.value
    def sleep(self, seconds):
        self.value += seconds


class TransportTests(unittest.TestCase):
    def transport(self, phase='hf'):
        clock = FakeClock()
        events = []
        transport = SingleWindowTransport(phase, ('audio.example',), persist_event=events.append,
            clock=clock.time, monotonic=clock.time, sleep=clock.sleep)
        return transport, clock, events

    def test_500_one_attempt_and_full_retry_window_with_redacted_body(self):
        transport, clock, events = self.transport()
        error = urllib.error.HTTPError('https://huggingface.co/fixture', 500, 'fixture',
            {'Retry-After': '3600'}, io.BytesIO(b'{"token":"hf_secret","url":"https://x.test/?signature=secret","error":"upstream"}'))
        with patch.object(transport.opener, 'open', side_effect=error) as opened:
            with self.assertRaises(AuditRequestUnavailable):
                transport.open('https://huggingface.co/fixture')
            with self.assertRaisesRegex(AuditRequestUnavailable, 'RETRY_WINDOW_PENDING'):
                transport.open('https://huggingface.co/fixture')
            self.assertEqual(opened.call_count, 1)
        self.assertEqual(transport.blocked_until, 3600)
        self.assertEqual(events[0]['status'], 500)
        self.assertNotIn('hf_secret', events[0]['response_text'])
        self.assertNotIn('https://', events[0]['response_text'])
        clock.sleep(3600)
        with patch.object(transport.opener, 'open', return_value=type('Response', (), {'status': 200})()) as opened:
            transport.open('https://huggingface.co/fixture')
            self.assertEqual(opened.call_count, 1)

    def test_pace_includes_clock_zero_and_drive_five_seconds(self):
        for phase, delay in [('hf', 2), ('drive', 5)]:
            transport, clock, _ = self.transport(phase)
            transport.pace()
            transport.pace()
            self.assertEqual(clock.value, delay)
            self.assertEqual(transport.stats['minimum_observed_interval_seconds'], delay)

    def test_exact_hosts_no_youtube_http_or_credentials(self):
        transport, _, _ = self.transport('source')
        transport.validate_url('https://audio.example/file.mp3')
        for url in ['http://audio.example/file', 'https://sub.audio.example/file',
                    'https://audio.example.evil/file', 'https://user:pass@audio.example/file',
                    'https://youtube.com/watch?v=test', 'https://127.0.0.1/file']:
            with self.assertRaises(AuditRequestUnavailable):
                transport.validate_url(url)
        with self.assertRaisesRegex(ValueError, 'AUTHENTICATION'):
            transport.open('https://audio.example/file', headers={'Authorization': 'fixture'})

    def test_hf_windows_require_spacing_and_max_three(self):
        windows = []
        executor.start_hf_window(windows, 0, 0)
        with self.assertRaises(AuditRequestUnavailable):
            executor.start_hf_window(windows, 1799, 0)
        executor.start_hf_window(windows, 1800, 0)
        executor.start_hf_window(windows, 3600, 0)
        with self.assertRaisesRegex(AuditRequestUnavailable, 'THREE_WINDOWS_EXHAUSTED'):
            executor.start_hf_window(windows, 5400, 0)
        self.assertEqual(windows, [0, 1800, 3600])

    def test_https_handler_compatible_without_connection(self):
        transport, _, _ = self.transport()
        handler = next(row for row in transport.opener.handlers if type(row).__name__ == 'PinnedHTTPS')
        with patch.object(handler, 'do_open', return_value='offline-fixture') as operation:
            self.assertEqual(handler.https_open(object()), 'offline-fixture')
            self.assertIn('context', operation.call_args.kwargs)

    def test_dns_private_address_rejected_before_socket_creation(self):
        transport, _, _ = self.transport()
        handler = next(row for row in transport.opener.handlers if type(row).__name__ == 'PinnedHTTPS')
        with patch.object(handler, 'do_open', return_value='offline-fixture') as operation:
            handler.https_open(object())
            connection_class = operation.call_args.args[0]
        import socket
        private = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))]
        connection = connection_class('huggingface.co')
        with patch('lib.t7_offset_execution.socket.getaddrinfo', return_value=private), \
             patch('lib.t7_offset_execution.socket.create_connection') as opened:
            with self.assertRaisesRegex(AuditRequestUnavailable, 'DNS_UNSAFE'):
                connection.connect()
            opened.assert_not_called()


class SyntheticMetricTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.diagnosis, cls.v1 = load_diagnostic_modules()
        rng = np.random.default_rng(731)
        cls.source = rng.normal(0, .05, 80000)
        cls.clip = cls.source[16000:32000].copy()

    def measure(self, clip=None, offset=2000, duration=2000):
        return measured_sample(self.source, self.clip if clip is None else clip, offset, duration,
                               [[0, 1, 0, 1900]], b'synthetic-encoded-source', b'synthetic-clip', self.v1)

    def test_exact_signal_passes_interior_full_duration_full_lag(self):
        row = self.measure()
        self.assertTrue(row['t7_v1_passed'])
        self.assertEqual(row['full_v1_diagnostic']['best_lag_ms'], 0)
        self.assertEqual(row['interior_v1']['trim_each_side_ms'], 300)
        self.assertEqual(row['duration_difference_ms'], 0)

    def test_boundary_noise_excluded_only_from_ncc(self):
        clip = self.clip.copy()
        clip[:2400] = 0
        clip[-2400:] = 0
        row = self.measure(clip)
        self.assertLess(row['full_v1_diagnostic']['score'], .95)
        self.assertGreaterEqual(row['interior_v1']['score'], .95)
        self.assertTrue(row['t7_v1_passed'])

    def test_full_duration_31ms_is_failure_even_with_interior_match(self):
        row = self.measure(duration=2031)
        self.assertGreaterEqual(row['interior_v1']['score'], .95)
        self.assertEqual(row['duration_difference_ms'], 31)
        self.assertFalse(row['t7_v1_passed'])

    def test_full_lag_31ms_is_failure(self):
        row = self.measure(offset=1969)
        self.assertEqual(row['full_v1_diagnostic']['best_lag_ms'], 31)
        self.assertFalse(row['t7_v1_passed'])

    def test_raw_ncc_below_threshold_does_not_round_to_success(self):
        # The legacy compare rounds its report to eight decimal places. T7 must
        # measure the raw coefficient independently before making its decision.
        from lib import t7_offset_execution as kernel
        with patch.object(kernel, 'raw_compare', return_value={
                'score': 0.949999997, 'score_display': 0.95,
                'best_lag_ms': 0, 'duration_difference_ms': 0, 'passed': False}):
            row = self.measure()
        self.assertEqual(row['interior_v1']['score'], 0.949999997)
        self.assertFalse(row['t7_v1_passed'])

    def test_real_calculation_preserves_subthreshold_raw_coefficient(self):
        from lib.t7_offset_execution import raw_compare
        rng = np.random.default_rng(981)
        reference = rng.normal(size=16000)
        reference -= reference.mean()
        reference /= np.linalg.norm(reference)
        noise = rng.normal(size=16000)
        noise -= noise.mean()
        noise -= np.dot(noise, reference) * reference
        noise /= np.linalg.norm(noise)
        coefficient = 0.949999997
        observed = coefficient * reference + np.sqrt(1 - coefficient ** 2) * noise
        source = np.concatenate((rng.normal(size=16000), reference, rng.normal(size=16000)))
        legacy = self.v1.compare(source, observed, 2000, 2000)
        result = raw_compare(source, observed, 2000, 2000)
        self.assertEqual(legacy['score'], .95)
        self.assertEqual(result['score_display'], .95)
        self.assertAlmostEqual(result['score'], coefficient, places=10)
        self.assertFalse(result['passed'])

    def test_fixed_position_minimum_duration_and_wrong_position(self):
        self.assertFalse(fixed_position_interior(self.source, self.clip[:10000], 16000)['measured'])
        self.assertTrue(fixed_position_interior(self.source, self.clip, 16000)['passed'])
        self.assertFalse(fixed_position_interior(self.source, self.clip, 16100)['passed'])

    def test_silent_signal_never_passes(self):
        row = self.measure(clip=np.zeros_like(self.clip))
        self.assertFalse(row['t7_v1_passed'])
        self.assertFalse(row['interior_pcm'].get('passed', False))

    def fixture(self):
        samples, proof = [], {}
        for chapter in (1, 2, 3):
            proof[str(chapter)] = {'observed_ayah_count': 10 * chapter, 'fixed_distributed_ayahs': [1, 2, 3, 4, 5]}
            for ayah in (1, 2, 3, 4, 5):
                samples.append({'surah': chapter, 'ayah': ayah, 't7_v1_passed': False,
                    'full_source_window_complete': True, 'source_offset_ms': ayah * 1000,
                    'duration_difference_ms': 0, 'encoded_identity': {'proven': True},
                    'envelope': {'measured': True, 'score': .95, 'best_lag_ms': 0},
                    'log_mel': {'measured': True, 'score': .95}, 'vad': {'agreement': .95},
                    'interior_pcm': {'measured': True, 'score': .98, 'interior_duration_ms': 1000}})
        return samples, {'samples': samples, 'distribution_proof': proof}

    def test_v2_requires_every_proof_and_never_numeric_only(self):
        samples, selection = self.fixture()
        matches = {'1': True, '2': True, '3': True}
        self.assertEqual(evaluate_recitation(samples, selection, self.diagnosis, matches)['verification_method_candidate'], 'v2')
        for key, value in [('encoded_identity', {'proven': False}), ('vad', {'agreement': .89}),
                           ('duration_difference_ms', 31), ('log_mel', {'measured': True, 'score': .89}),
                           ('envelope', {'measured': True, 'score': .95, 'best_lag_ms': 31}),
                           ('full_source_window_complete', False)]:
            changed = copy.deepcopy(samples)
            changed[0][key] = value
            self.assertFalse(evaluate_recitation(changed, selection, self.diagnosis, matches)['offset_verified_candidate'], key)
        self.assertFalse(evaluate_recitation(samples, selection, self.diagnosis, {'1': None, '2': True, '3': True})['offset_verified_candidate'])
        self.assertFalse(evaluate_recitation(samples, selection, self.diagnosis, {'1': False, '2': True, '3': True})['offset_verified_candidate'])

    def test_v2_increasing_drift_is_rejected_even_with_good_numeric_samples(self):
        samples, selection = self.fixture()
        for sample in samples:
            sample['envelope']['best_lag_ms'] = (sample['ayah'] - 3) * 10
        outcome = evaluate_recitation(samples, selection, self.diagnosis, {'1': True, '2': True, '3': True})
        self.assertEqual(outcome['classification']['pattern'], 'increasing_drift')
        self.assertFalse(outcome['offset_verified_candidate'])

    def test_locked_pairs_missing_or_duplicate_rejected(self):
        samples, selection = self.fixture()
        with self.assertRaisesRegex(ValueError, 'LOCKED_SAMPLE_SET'):
            evaluate_recitation(samples[:-1], selection, self.diagnosis, {})
        with self.assertRaisesRegex(ValueError, 'LOCKED_SAMPLE_SET'):
            evaluate_recitation(samples + [samples[0]], selection, self.diagnosis, {})


if __name__ == '__main__':
    unittest.main()
