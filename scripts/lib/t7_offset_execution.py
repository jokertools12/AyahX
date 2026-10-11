"""Opt-in T7 kernel/transport. Imports never make network requests or decode audio."""
from datetime import datetime, timezone
import email.utils
import hashlib
import http.client
import importlib.util
import ipaddress
import json
import math
import re
from pathlib import Path
import socket
import threading
import time
from urllib.parse import parse_qsl, urlparse
import urllib.error
import urllib.request

import numpy as np
from scipy.signal import correlate

from .acoustic_diagnostics import additional_metrics, encoded_interior_identity
from .hf_serial_ranges import safe_response_text

RATE = 8000
TRIM_MS = 300


def provider_host_allowed(host, hosts):
    """Only exact hosts and the audited Internet Archive US CDN namespace."""
    hostname = host.lower()
    return any(value.lower() == hostname or value == '*.us.archive.org'
               and hostname.endswith('.us.archive.org') and hostname != 'us.archive.org'
               for value in hosts)


def validate_provider_hosts(hosts):
    if not isinstance(hosts, list) or not hosts:
        return False
    return all(isinstance(host, str) and (host == '*.us.archive.org'
               or re.fullmatch(r'[a-z0-9.-]+', host) is not None and '*' not in host)
               for host in hosts)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def load_diagnostic_modules():
    """Reuse pure calculations only. Never call legacy audit/main/cleanup."""
    path = Path(__file__).resolve().parents[1] / 'diagnose-qud-audio.py'
    spec = importlib.util.spec_from_file_location('retained_t7_diagnostics', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, module.v1


def raw_compare(source, clip, offset_ms, duration_ms):
    """Legacy lag search and normalization, with an unrounded decision score.

    Keep historical v1 reports intact. Reporting may round score_display only;
    score and passed retain the computed float used by the T7 acceptance gate.
    """
    center = round(offset_ms * RATE / 1000)
    margin = round(.300 * RATE)
    start = max(0, center - margin)
    end = min(len(source), center + len(clip) + margin)
    window = source[start:end]
    if len(window) < len(clip) or len(clip) == 0:
        return {'passed': False, 'reason': 'source_window_too_short'}
    observed = clip - clip.mean()
    scores = correlate(window, observed, mode='valid', method='fft')
    sums = np.concatenate(([0], np.cumsum(window)))
    squares = np.concatenate(([0], np.cumsum(window * window)))
    count = len(observed)
    energy = squares[count:] - squares[:-count] - (sums[count:] - sums[:-count]) ** 2 / count
    scores /= np.sqrt(np.maximum(energy * np.dot(observed, observed), 1e-20))
    lags = (np.arange(len(scores)) + start - center) * 1000 / RATE
    scores[np.abs(lags) > 300] = -1
    best = int(np.argmax(scores))
    score, lag = float(scores[best]), float(lags[best])
    delta = abs(count * 1000 / RATE - duration_ms)
    return {'score': score, 'score_display': round(score, 8), 'best_lag_ms': lag,
            'duration_difference_ms': delta, 'passed': score >= .95 and delta <= 30 and abs(lag) <= 30}


def fixed_position_interior(source, clip, start):
    trim = round(TRIM_MS * RATE / 1000)
    count = len(clip) - 2 * trim
    result = {'measured': False, 'trim_each_side_ms': TRIM_MS, 'minimum_interior_duration_ms': 800,
              'source_sample_start': int(start), 'interior_duration_ms': max(0, count) * 1000 / RATE}
    if count < round(800 * RATE / 1000):
        return {**result, 'reason': 'insufficient_fixed_interior_duration'}
    first, last = start + trim, start + len(clip) - trim
    if first < 0 or last > len(source):
        return {**result, 'reason': 'fixed_source_interior_out_of_bounds'}
    reference, observed = source[first:last], clip[trim:-trim]
    reference, observed = reference - np.mean(reference), observed - np.mean(observed)
    denominator = float(np.linalg.norm(reference) * np.linalg.norm(observed))
    if denominator <= 1e-15:
        return {**result, 'reason': 'constant_or_silent_interior'}
    score = float(np.clip(np.dot(reference, observed) / denominator, -1, 1))
    return {**result, 'measured': True, 'score': score, 'passed': score >= .95}


def measured_sample(source, clip, offset_ms, duration_ms, segments, source_bytes, clip_bytes, v1, features=None):
    if (any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
            for value in (offset_ms, duration_ms)) or offset_ms < 0 or duration_ms <= 0):
        raise ValueError('FINITE_POSITIVE_HF_OFFSET_DURATION_REQUIRED')
    source, clip = np.asarray(source, dtype=np.float64), np.asarray(clip, dtype=np.float64)
    if (source.ndim != 1 or clip.ndim != 1 or not len(source) or not len(clip)
            or not np.all(np.isfinite(source)) or not np.all(np.isfinite(clip))):
        raise ValueError('FINITE_NONEMPTY_MONO_AUDIO_REQUIRED')
    full = raw_compare(source, clip, offset_ms, duration_ms)
    trim = round(TRIM_MS * RATE / 1000)
    internal = {'measured': False, 'reason': 'interior_too_short', 'trim_each_side_ms': TRIM_MS}
    if len(clip) > 2 * trim:
        candidate = raw_compare(source, clip[trim:-trim], offset_ms + TRIM_MS, (len(clip) - 2 * trim) * 1000 / RATE)
        if 'score' in candidate:
            internal = {'measured': True, 'trim_each_side_ms': TRIM_MS, 'score': candidate['score'],
                        'best_lag_ms': candidate['best_lag_ms'],
                        'interior_duration_ms': (len(clip) - 2 * trim) * 1000 / RATE}
        else:
            internal = {**internal, 'reason': candidate.get('reason', 'interior_unmeasured')}
    full_start = round((offset_ms + full.get('best_lag_ms', 0)) * RATE / 1000)
    full_window_complete = ('score' in full and full_start >= 0 and full_start + len(clip) <= len(source))
    delta = abs(len(clip) * 1000 / RATE - duration_ms)
    accepted_v1 = bool(full_window_complete and internal['measured'] and internal['score'] >= .95
                       and abs(internal['best_lag_ms']) <= 30 and abs(full['best_lag_ms']) <= 30 and delta <= 30)
    # Approved v2 core metrics remain complete-clip metrics, including exact supplied segments for VAD.
    extra = additional_metrics(source, clip, offset_ms, duration_ms, segments, features)
    extra['encoded_identity'] = encoded_interior_identity(source_bytes, clip_bytes)
    if extra['envelope'].get('measured'):
        extra['interior_pcm'] = fixed_position_interior(source, clip, extra['envelope']['source_sample_start'])
    else:
        extra['interior_pcm'] = {'measured': False, 'passed': False, 'trim_each_side_ms': TRIM_MS, 'reason': 'source_position_unmeasured'}
    return {**extra, 'source_offset_ms': offset_ms, 'hf_duration_ms': duration_ms,
            'decoded_full_clip_duration_ms': len(clip) * 1000 / RATE, 'duration_difference_ms': delta,
            'full_v1_diagnostic': full, 'interior_v1': internal, 'full_source_window_complete': full_window_complete,
            't7_v1_passed': accepted_v1, 'audio_measurement_scope': 'real_only_when_called_by_execute_with_real_decoded_inputs'}


def evaluate_recitation(samples, selection, diagnosis, source_matches):
    expected = {(row['surah'], row['ayah']) for row in selection['samples']}
    actual = {(row['surah'], row['ayah']) for row in samples}
    if actual != expected or len(actual) != len(samples):
        raise ValueError('LOCKED_SAMPLE_SET_INCOMPLETE_OR_DUPLICATED')
    classification = diagnosis.classify(samples, selection['distribution_proof'], source_matches)
    v1_passed = (diagnosis.sample_distribution(samples, selection['distribution_proof'])['verified']
                 and all(row['t7_v1_passed'] for row in samples))
    if classification.get('pattern') == 'codec_processing_only':
        classification['v2_source_position_evidence'] = 'fixed_300ms_trim_interior_PCM_NCC_ge_0.95; min_800ms; no_lag_search'
    v2_passed = (classification.get('pattern') == 'codec_processing_only'
                 and classification.get('v2_eligible') is True
                 and all(row['full_source_window_complete'] for row in samples))
    method = 'v1' if v1_passed else 'v2' if v2_passed else None
    return {'verification_status': 'passed' if method else 'failed', 'offset_verified_candidate': bool(method),
            'verification_method_candidate': method, 'v1_all_samples_passed': v1_passed,
            'v2_all_gates_and_cause_proven': v2_passed, 'classification': classification,
            'surah_start_basmala_audio_status': 'unverified',
            'database_offset_verified_changed': False, 'publication_changed': False}


class AuditRequestUnavailable(urllib.error.URLError):
    def __init__(self, code, phase, retry_at=None):
        super().__init__(code)
        self.audit_code = code
        self.phase = phase
        self.retry_at = retry_at


class SingleWindowTransport:
    """Exactly one attempt per HTTP operation. 500/429 never cause an in-window retry."""
    def __init__(self, phase, hosts=(), persist_event=None, clock=time.time, monotonic=time.monotonic, sleep=time.sleep):
        self.phase, self.hosts = phase, set(hosts)
        self.persist_event = persist_event or (lambda event: None)
        self.clock, self.monotonic, self.sleep = clock, monotonic, sleep
        self.last = None
        self.blocked_until = 0.0
        self.last_progress = 0.0
        self.lock = threading.RLock()
        self.spacing = 5 if phase == 'drive' else 2
        self.stats = {'requests': 0, 'bytes': 0, 'statuses': [], 'minimum_interval_seconds': self.spacing,
                      'http_500_events': [], 'in_request_retry_count': 0}
        transport = self

        class Redirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, request, fp, code, message, headers, new_url):
                hops = getattr(request, 't7_redirect_hops', 0) + 1
                if hops > 5:
                    raise AuditRequestUnavailable('AUDIO_REDIRECT_LIMIT', transport.phase)
                transport.validate_url(new_url)
                transport.pace()
                redirected = super().redirect_request(request, fp, code, message, headers, new_url)
                if redirected is not None:
                    redirected.t7_redirect_hops = hops
                return redirected

        class PinnedConnection(http.client.HTTPSConnection):
            def connect(self):
                if self._tunnel_host:
                    raise AuditRequestUnavailable('HTTP_TUNNEL_PROHIBITED', transport.phase)
                addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
                if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
                    raise AuditRequestUnavailable('AUDIO_DNS_UNSAFE', transport.phase)
                sock = socket.create_connection((addresses[0][4][0], self.port), self.timeout, self.source_address)
                self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

        class PinnedHTTPS(urllib.request.HTTPSHandler):
            def https_open(self, request):
                return self.do_open(PinnedConnection, request, context=self._context)

        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), Redirect(), PinnedHTTPS())

    def validate_url(self, url):
        parsed = urlparse(url)
        host = (parsed.hostname or '').lower()
        if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443)
                or 'youtube' in host or host == 'youtu.be' or host.endswith('.googlevideo.com')):
            raise AuditRequestUnavailable('HTTPS_PUBLIC_SOURCE_REQUIRED', self.phase)
        if self.phase == 'hf':
            allowed = (host in ('datasets-server.huggingface.co', 'huggingface.co')
                       or host.endswith('.huggingface.co') or host.endswith('.hf.co'))
        else:
            allowed = provider_host_allowed(host, self.hosts)
            if any(re.search(r'token|signature|credential|expires|x-amz|x-goog|policy|^sig$|^api[_-]?key$', key, re.I)
                   for key, _ in parse_qsl(parsed.query)):
                raise AuditRequestUnavailable('SIGNED_PROVIDER_SOURCE_PROHIBITED', self.phase)
        if not allowed:
            raise AuditRequestUnavailable('AUDIO_HOST_NOT_ALLOWED', self.phase)

    def pace(self):
        with self.lock:
            if self.blocked_until > self.clock():
                raise AuditRequestUnavailable('HTTP_RETRY_WINDOW_PENDING', self.phase, self.blocked_until)
            while self.last is not None and self.monotonic() - self.last < self.spacing:
                self.sleep(min(1, self.spacing - (self.monotonic() - self.last)))
            now = self.monotonic()
            if self.last is not None:
                interval = now - self.last
                self.stats['minimum_observed_interval_seconds'] = min(interval, self.stats.get('minimum_observed_interval_seconds', interval))
            self.last = now
            self.stats['requests'] += 1
            self.progress()

    def progress(self):
        if self.monotonic() - self.last_progress >= 30:
            self.last_progress = self.monotonic()
            print(json.dumps({'audit_progress': True, 'phase': self.phase, 'requests': self.stats['requests'], 'bytes': self.stats['bytes']}), flush=True)

    def open(self, url, method='GET', headers=None):
        if any(key.lower() in ('authorization', 'proxy-authorization', 'cookie') for key in (headers or {})):
            raise ValueError('AUDIT_AUTHENTICATION_HEADERS_PROHIBITED')
        self.validate_url(url)
        self.pace()
        try:
            response = self.opener.open(urllib.request.Request(url, method=method,
                headers={'User-Agent': 'AyahX-T7-read-only-audit/1.0', **(headers or {})}), timeout=90)
            self.stats['statuses'].append(response.status)
            return response
        except urllib.error.HTTPError as error:
            self.stats['statuses'].append(error.code)
            event = {'checked_at': datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(),
                     'phase': self.phase, 'status': error.code, 'method': method, 'attempt_in_request': 1}
            if error.code == 500:
                try:
                    payload = error.read(65537)
                    event.update(response_text=safe_response_text(payload[:65536]), response_truncated=len(payload) > 65536,
                                 captured_body_sha256=digest(payload[:65536]))
                except OSError as capture_error:
                    event['response_read_error'] = type(capture_error).__name__
                self.stats['http_500_events'].append(event)
            if self.phase == 'hf' and error.code in (429, 500, 502, 503, 504):
                retry = error.headers.get('Retry-After')
                delay = 1800
                if retry:
                    try:
                        numeric_delay = float(retry)
                        if not math.isfinite(numeric_delay):
                            raise ValueError('INVALID_RETRY_AFTER')
                        delay = max(delay, numeric_delay)
                    except ValueError:
                        try:
                            delay = max(delay, email.utils.parsedate_to_datetime(retry).timestamp() - self.clock())
                        except (ValueError, TypeError, OverflowError):
                            event['invalid_retry_after'] = True
                self.blocked_until = self.clock() + delay
                event['next_window_epoch'] = self.blocked_until
            self.persist_event(event)
            error.close()
            raise AuditRequestUnavailable('HTTP_' + str(error.code), self.phase, self.blocked_until or None) from None


def download_once(transport, url, destination, maximum_bytes=256 * 1024 * 1024):
    # Files are created once and kept, including partial downloads. No overwrite or cleanup.
    if destination.exists():
        raise ValueError('AUDIT_SOURCE_FILE_ALREADY_EXISTS_REQUIRE_CHECKPOINT_VALIDATION')
    started = time.monotonic()
    count = 0
    with transport.open(url) as response, destination.open('xb') as output:
        mime = str(response.headers.get('Content-Type', ''))
        if not (mime.lower().startswith('audio/') or mime.lower().startswith('application/octet-stream')):
            raise AuditRequestUnavailable('SOURCE_NOT_AUDIO_NO_DRIVE_CONFIRMATION_BYPASS', transport.phase)
        while data := response.read(65536):
            count += len(data)
            if count > maximum_bytes:
                raise AuditRequestUnavailable('AUDIT_SOURCE_BYTE_LIMIT', transport.phase)
            output.write(data)
            transport.stats['bytes'] += len(data)
            if transport.phase == 'drive':
                while time.monotonic() - started < count / 81920:
                    time.sleep(min(1, count / 81920 - (time.monotonic() - started)))
            transport.progress()
    if not count:
        raise AuditRequestUnavailable('AUDIT_SOURCE_EMPTY', transport.phase)
    return {'sha256': digest(destination.read_bytes()), 'bytes': count}
