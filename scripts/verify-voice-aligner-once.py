"""One bounded K4 Aligner request, explicitly enabled by root. No DB/retries.

    Provider contract is server/services/alignmentService.ts externalProvider.
    internal_ctc and quranic_universal_aligner must be selected explicitly.
    Request source audio is transmitted only after --execute-explicit-consent.
    Endpoint/token come from server environment; never printed or persisted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import math
import os
import re
from pathlib import Path
from urllib.parse import urlparse
import urllib.error
import urllib.request


def private(path):
    path = Path(path).resolve()
    if any((parent / '.git').exists() for parent in [path, *path.parents]):
        raise ValueError('PRIVATE_ALIGNER_REQUEST_RESPONSE_REQUIRED')
    return path


def endpoint_from_environment(provider):
    endpoint = (os.environ.get('ALIGNMENT_INTERNAL_CTC_URL') if provider == 'internal_ctc'
                else os.environ.get('QUA_ALIGNER_API_URL') or os.environ.get('QUA_ALIGNER_URL'))
    if not endpoint:
        raise ValueError('ALIGNMENT_PROVIDER_NOT_CONFIGURED')
    parsed = urlparse(endpoint)
    private_http = provider == 'internal_ctc' and parsed.scheme == 'http' and (parsed.hostname or '').endswith('.railway.internal')
    if (parsed.scheme != 'https' and not private_http) or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('ALIGNMENT_PROVIDER_HTTPS_ENDPOINT_REQUIRED')
    return endpoint


def validate_request(request, maximum_audio_ms=30000):
    if request.get('providerId') not in ('quranic_universal_aligner', 'internal_ctc') or request.get('granularity', 'word') != 'word':
        raise ValueError('EXPLICIT_WORD_PROVIDER_REQUIRED')
    if not isinstance(maximum_audio_ms, int) or isinstance(maximum_audio_ms, bool) or not 1 <= maximum_audio_ms <= 120000:
        raise ValueError('MAXIMUM_AUDIO_DURATION_LIMIT_120000MS')
    duration = request.get('audio', {}).get('durationMs')
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= maximum_audio_ms:
        raise ValueError('BOUNDED_AUDIO_SAMPLE_DURATION_LIMIT')
    sample = request.get('providerInput', {}).get('k4_sample_contract', {})
    if (sample.get('standalone_verified_sample') is not True
            or sample.get('verified_full_source_duration_ms') != duration
            or not re.fullmatch('[a-f0-9]{64}', request.get('audio', {}).get('contentHash', ''))
            or sample.get('verified_full_source_sha256') != request['audio']['contentHash']):
        raise ValueError('STANDALONE_SAMPLE_BYTES_DURATION_PROOF_REQUIRED_NO_FAKE_CROP')
    audio = urlparse(request.get('audio', {}).get('sourceUrlOrAssetId', ''))
    host = audio.hostname or ''
    if (audio.scheme != 'https' or audio.username or audio.password or not host
            or host == 'youtu.be' or host == 'youtube.com' or host.endswith('.youtube.com')
            or host == 'googlevideo.com' or host.endswith('.googlevideo.com')):
        raise ValueError('TRUSTED_NON_YOUTUBE_HTTPS_AUDIO_REQUIRED')
    if audio.port not in (None, 443) or host.lower() in ('localhost', 'localhost.localdomain'):
        raise ValueError('TRUSTED_PUBLIC_AUDIO_HOST_REQUIRED')
    try:
        literal_address = ipaddress.ip_address(host)
    except ValueError:
        literal_address = None  # A hostname, resolved by the worker's SSRF gate.
    if literal_address is not None and not literal_address.is_global:
        raise ValueError('TRUSTED_PUBLIC_AUDIO_HOST_REQUIRED')
    reference = request.get('reference', {})
    if reference.get('surahNumber') not in (1, 112, 36) or not reference.get('ayahs'):
        raise ValueError('CANONICAL_AUDITION_REFERENCE_REQUIRED')
    start, end = reference.get('startAyah'), reference.get('endAyah')
    if (not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int)
            or isinstance(end, bool) or not 1 <= start <= end <= 300
            or [row.get('numberInSurah') for row in reference['ayahs']] != list(range(start, end + 1))
            or any(not isinstance(row.get('text'), str) or not row['text'].strip() for row in reference['ayahs'])):
        raise ValueError('CONTIGUOUS_IMPORTED_CANONICAL_REFERENCE_REQUIRED')
    raw = json.dumps(request, ensure_ascii=False, allow_nan=False).encode()
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('ALIGNMENT_REQUEST_LIMIT')
    return raw


def request_once(request, endpoint, token=None, opener=None, maximum_audio_ms=30000):
    raw = validate_request(request, maximum_audio_ms)
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    # No redirects, retries, implicit alternate providers, or response body logs.
    class RejectRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), RejectRedirect())
    result = {'checked_at': datetime.now(timezone.utc).isoformat(), 'actor': 'auto-verifier-v1',
              'provider': request['providerId'], 'requests': 1, 'retries': 0, 'maximum_audio_ms': maximum_audio_ms,
              'request_sha256': hashlib.sha256(raw).hexdigest(), 'v2_status': 'unverified',
              'surah': request['reference']['surahNumber'], 'audio_sha256': request['audio'].get('contentHash')}
    try:
        with opener.open(urllib.request.Request(endpoint, data=raw, headers=headers, method='POST'), timeout=45) as response:
            result['http_status'] = response.status
            body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                return {**result, 'code': 'ALIGNMENT_RESPONSE_TOO_LARGE'}
            result['response_sha256'] = hashlib.sha256(body).hexdigest()
            payload = json.loads(body)
            data = payload.get('result', payload)
            words = data.get('words')
            if not isinstance(words, list) or not words:
                return {**result, 'code': 'ALIGNMENT_RESPONSE_WORDS_REQUIRED'}
            confidence = [row.get('confidence') for row in words if isinstance(row, dict)]
            finite = [value for value in confidence if not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1]
            result.update(code='ALIGNMENT_RESPONSE_RECEIVED_CONTENT_REVIEW_REQUIRED', word_count=len(words),
                          words_with_finite_confidence=len(finite), minimum_word_confidence=min(finite) if finite else None,
                          measurement_scope='actual_aligner_response',
                          reason='Forced reference alignment alone is not independent content recognition. Calibrated high-confidence/recognized-reference evidence is required.')
            return result
    except urllib.error.HTTPError as error:
        code = {402: 'ALIGNMENT_QUOTA_PAYMENT_REQUIRED', 429: 'ALIGNMENT_RATE_LIMITED', 503: 'ALIGNMENT_PROVIDER_UNAVAILABLE'}.get(error.code, 'ALIGNMENT_HTTP_' + str(error.code))
        retry = error.headers.get('Retry-After')
        result.update(http_status=error.code, code=code)
        if retry and retry.isdigit():
            result['retry_after_seconds'] = int(retry)
        error.close()
        return result
    except urllib.error.URLError:
        return {**result, 'code': 'ALIGNMENT_TRANSPORT_UNAVAILABLE'}
    except TimeoutError:
        return {**result, 'code': 'ALIGNMENT_TIMEOUT'}
    except (json.JSONDecodeError, ValueError, TypeError):
        return {**result, 'code': 'ALIGNMENT_RESPONSE_INVALID'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--execute-explicit-consent', action='store_true')
    parser.add_argument('--maximum-audio-ms', type=int, default=30000)
    args = parser.parse_args()
    request = json.loads(private(args.request).read_bytes())
    validate_request(request, args.maximum_audio_ms)
    if not args.execute_explicit_consent:
        print(json.dumps({'code': 'ALIGNMENT_DRY_RUN', 'requests': 0, 'validated': True}))
        return
    provider = request['providerId']
    token = os.environ.get('ALIGNMENT_INTERNAL_CTC_TOKEN') if provider == 'internal_ctc' else os.environ.get('QUA_ALIGNER_API_TOKEN')
    result = request_once(request, endpoint_from_environment(provider), token, maximum_audio_ms=args.maximum_audio_ms)
    output = private(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps({key: result.get(key) for key in ['code', 'http_status', 'requests', 'retries', 'v2_status']}))


if __name__ == '__main__':
    main()
