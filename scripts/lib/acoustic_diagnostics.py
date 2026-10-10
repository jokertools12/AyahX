"""Additional local acoustic diagnostics; never modifies the retained v1 gate.

The RMS energy mask is explicitly a VAD proxy, not a speech recognition model.
Feature scores alone cannot establish that two recordings have the same identity.
All time values returned by this module are milliseconds.
"""
import math

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import correlate, stft


RATE = 8000
ENVELOPE_HOP_MS = 1
ENVELOPE_WINDOW_MS = 20
MEL_HOP_MS = 10
MEL_WINDOW_MS = 25
SEARCH_LIMIT_MS = 300


def _signal(value):
    signal = np.asarray(value, dtype=np.float64)
    if signal.ndim != 1 or not len(signal) or not np.all(np.isfinite(signal)):
        raise ValueError('FINITE_NONEMPTY_MONO_AUDIO_REQUIRED')
    return signal


def rms_envelope(audio):
    """Centered 20ms RMS sampled on a fixed, source-anchored 1ms grid."""
    audio = _signal(audio)
    size = round(ENVELOPE_WINDOW_MS * RATE / 1000)
    power = uniform_filter1d(audio * audio, size=size, mode='constant')
    return np.sqrt(np.maximum(power[::round(ENVELOPE_HOP_MS * RATE / 1000)], 0))


def aligned_source_envelope(source, source_sample_start, clip_sample_count):
    """Sample original-source RMS on the exact clip-anchored PCM grid.

    Retain original signal context for RMS filtering, and use the original EOF
    boundary. Every requested centre is an existing source sample. Never trim
    or pad a mismatched window to make masks have equal sizes.
    """
    source = _signal(source)
    if (not isinstance(source_sample_start, (int, np.integer))
            or not isinstance(clip_sample_count, (int, np.integer))
            or source_sample_start < 0 or clip_sample_count <= 0
            or source_sample_start + clip_sample_count > len(source)):
        raise ValueError('ALIGNED_SOURCE_PCM_WINDOW_OUT_OF_BOUNDS')
    context = round(ENVELOPE_WINDOW_MS * RATE / 1000)
    begin = max(0, source_sample_start - context)
    end = min(len(source), source_sample_start + clip_sample_count + context)
    power = uniform_filter1d(source[begin:end] ** 2, size=context, mode='constant')
    positions = source_sample_start - begin + np.arange(0, clip_sample_count,
                                                       round(ENVELOPE_HOP_MS * RATE / 1000))
    return np.sqrt(np.maximum(power[positions], 0))


def refine_envelope_match(source, clip, offset_ms, coarse):
    """Refine +/-2ms around the fixed-window peak at 8000Hz (0.125ms).

    This avoids making a 30.125ms lag appear to satisfy the inclusive 30ms
    acceptance boundary merely because the coarse feature grid uses 1ms bins.
    The coarse +/-300ms search chooses the neighbourhood before refinement.
    """
    if not coarse['measured']:
        return coarse
    center = round((offset_ms + coarse['best_lag_ms']) * RATE / 1000)
    margin = round(2 * RATE / 1000)
    first, last = max(0, center - margin), min(len(source) - len(clip), center + margin)
    size = round(ENVELOPE_WINDOW_MS * RATE / 1000)
    clip_feature = np.sqrt(np.maximum(uniform_filter1d(clip ** 2, size=size, mode='constant'), 0))
    centered_clip = clip_feature - np.mean(clip_feature)
    clip_norm = float(np.linalg.norm(centered_clip))
    if clip_norm <= 1e-15:
        return {'measured': False, 'reason': 'constant_or_silent_envelope'}
    best = None
    for start in range(first, last + 1):
        lag = start * 1000 / RATE - offset_ms
        if abs(lag) > SEARCH_LIMIT_MS:
            continue
        # Both complete PCM windows use the SAME zero-boundary convention.
        # No source samples are trimmed or invented to manufacture a match.
        window = source[start:start + len(clip)]
        feature = np.sqrt(np.maximum(uniform_filter1d(window ** 2, size=size, mode='constant'), 0))
        centered_window = feature - np.mean(feature)
        denominator = float(np.linalg.norm(centered_window) * clip_norm)
        if denominator <= 1e-15:
            continue
        score = float(np.dot(centered_window, centered_clip) / denominator)
        if best is None or score > best['score']:
            best = {'measured': True, 'score': float(np.clip(score, -1, 1)), 'best_lag_ms': lag,
                    'resolution_ms': 1000 / RATE, 'source_sample_start': start,
                    'boundary_convention': 'zero_boundary_on_both_complete_PCM_windows',
                    'coarse_score': coarse['score'], 'coarse_lag_ms': coarse['best_lag_ms']}
    return best or {'measured': False, 'reason': 'no_complete_source_pcm_window_for_refinement'}


def log_mel(audio, bands=32):
    """25ms Hann frames, 10ms hop; power mel bands followed by natural log."""
    audio = _signal(audio)
    window = round(MEL_WINDOW_MS * RATE / 1000)
    hop = round(MEL_HOP_MS * RATE / 1000)
    if len(audio) < window:
        raise ValueError('AUDIO_TOO_SHORT_FOR_LOG_MEL')
    frequencies, _, spectrum = stft(audio, fs=RATE, window='hann', nperseg=window,
                                   noverlap=window - hop, nfft=256, boundary='zeros', padded=True)
    to_mel = lambda hz: 2595 * np.log10(1 + hz / 700)
    to_hz = lambda mel: 700 * (10 ** (mel / 2595) - 1)
    edges = to_hz(np.linspace(to_mel(50), to_mel(RATE / 2), bands + 2))
    filters = np.zeros((bands, len(frequencies)))
    for index, (left, center, right) in enumerate(zip(edges, edges[1:], edges[2:])):
        filters[index] = np.maximum(0, np.minimum((frequencies - left) / (center - left),
                                                (right - frequencies) / (right - center)))
    return np.log(np.maximum(filters @ (np.abs(spectrum) ** 2), 1e-12)).T


def feature_match(source, clip, offset_ms, hop_ms):
    """Centered NCC in a fixed +/-300ms window; positive lag is later source."""
    source = np.asarray(source, dtype=np.float64)
    clip = np.asarray(clip, dtype=np.float64)
    if source.ndim == 1:
        source = source[:, None]
    if clip.ndim == 1:
        clip = clip[:, None]
    if (source.ndim != 2 or clip.ndim != 2 or source.shape[1] != clip.shape[1]
            or not np.all(np.isfinite(source)) or not np.all(np.isfinite(clip))):
        raise ValueError('INCOMPATIBLE_FINITE_FEATURES_REQUIRED')
    if not len(clip):
        return {'measured': False, 'reason': 'empty_clip'}
    center = round(offset_ms / hop_ms)
    margin = round(SEARCH_LIMIT_MS / hop_ms)
    start = max(0, center - margin)
    end = min(len(source), center + len(clip) + margin)
    window = source[start:end]
    if len(window) < len(clip):
        return {'measured': False, 'reason': 'source_window_too_short'}
    centered_clip = clip - np.mean(clip, axis=0)
    clip_energy = float(np.sum(centered_clip ** 2))
    if clip_energy <= 1e-15:
        return {'measured': False, 'reason': 'constant_or_silent_clip'}
    n = len(clip)
    numerator = np.zeros(len(window) - n + 1)
    denominator_energy = np.zeros_like(numerator)
    for column in range(window.shape[1]):
        series = window[:, column]
        numerator += correlate(series, centered_clip[:, column], mode='valid', method='fft')
        sums = np.concatenate(([0], np.cumsum(series)))
        squares = np.concatenate(([0], np.cumsum(series * series)))
        denominator_energy += squares[n:] - squares[:-n] - (sums[n:] - sums[:-n]) ** 2 / n
    scores = numerator / np.sqrt(np.maximum(denominator_energy * clip_energy, 1e-30))
    lags = (np.arange(len(scores)) + start) * hop_ms - offset_ms
    allowed = np.abs(lags) <= SEARCH_LIMIT_MS
    if not np.any(allowed):
        return {'measured': False, 'reason': 'no_candidate_within_search_window'}
    scores[~allowed] = -np.inf
    best = int(np.argmax(scores))
    return {'measured': True, 'score': float(np.clip(scores[best], -1, 1)),
            'best_lag_ms': float(lags[best]), 'resolution_ms': hop_ms,
            'source_feature_start': start + best}


def energy_vad(envelope):
    """Energy proxy: RMS >= max(-50dBFS, peak RMS -35dB), no gap filling."""
    envelope = np.asarray(envelope, dtype=np.float64)
    if not len(envelope) or not np.all(np.isfinite(envelope)):
        raise ValueError('FINITE_NONEMPTY_ENVELOPE_REQUIRED')
    threshold = max(10 ** (-50 / 20), float(np.max(envelope)) * 10 ** (-35 / 20))
    return envelope >= threshold, threshold


def speech_iou(left, right):
    """Speech intersection / union. A pair of silent masks never passes."""
    left, right = np.asarray(left, dtype=bool), np.asarray(right, dtype=bool)
    if left.shape != right.shape:
        raise ValueError('VAD_MASK_SHAPE_MISMATCH')
    union = int(np.sum(left | right))
    return None if union == 0 else float(np.sum(left & right) / union)


def segments_mask(segments, frame_count, hop_ms=ENVELOPE_HOP_MS):
    """Exact union of supplied segment intervals; no silent boundary repair."""
    if not segments:
        raise ValueError('SEGMENTS_REQUIRED_FOR_VAD_AGREEMENT')
    times = np.arange(frame_count) * hop_ms
    mask = np.zeros(frame_count, dtype=bool)
    for segment in segments:
        if (not isinstance(segment, (list, tuple)) or len(segment) != 4
                or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in segment)):
            raise ValueError('INVALID_SEGMENT')
        start, end = segment[2:]
        if start < 0 or end <= start or end > frame_count * hop_ms:
            raise ValueError('SEGMENT_OUTSIDE_DECODED_CLIP')
        mask |= (times >= start) & (times < end)
    return mask


def additional_metrics(source, clip, offset_ms, duration_ms, segments, source_features=None):
    source, clip = _signal(source), _signal(clip)
    source_envelope = source_features['envelope'] if source_features is not None else rms_envelope(source)
    source_mel = source_features['log_mel'] if source_features is not None else log_mel(source)
    clip_envelope = rms_envelope(clip)
    envelope = feature_match(source_envelope, clip_envelope, offset_ms, ENVELOPE_HOP_MS)
    envelope = refine_envelope_match(source, clip, offset_ms, envelope)
    clip_mel = log_mel(clip)
    coarse_mel = feature_match(source_mel, clip_mel, offset_ms, MEL_HOP_MS)
    mel = {'measured': False, 'reason': 'envelope_position_unmeasured', 'coarse_search': coarse_mel}
    if envelope.get('measured'):
        start = envelope['source_sample_start']
        exact_mel = log_mel(source[start:start + len(clip)])
        centered_source = exact_mel - np.mean(exact_mel, axis=0)
        centered_clip = clip_mel - np.mean(clip_mel, axis=0)
        denominator = float(np.linalg.norm(centered_source) * np.linalg.norm(centered_clip))
        if denominator > 1e-15:
            score = float(np.sum(centered_source * centered_clip) / denominator)
            mel = {'measured': True, 'score': float(np.clip(score, -1, 1)),
                   'best_lag_ms': envelope['best_lag_ms'], 'source_sample_start': start,
                   'method': 'fixed_complete_PCM_window_on_exact_clip_STFT_grid; zero_boundary_both_sides',
                   'coarse_search': coarse_mel}
    duration_difference = abs(len(clip) * 1000 / RATE - duration_ms)
    result = {'envelope': envelope, 'log_mel': mel, 'duration_difference_ms': duration_difference,
              'v2_numeric_candidate': False, 'v2_adoption_requires_codec_identity_evidence': True,
              'vad': {'method': 'rms_energy_proxy; peak_minus_35dB; floor_minus_50dBFS; speech_IoU'}}
    if not envelope['measured']:
        result['vad']['reason'] = 'envelope_match_unavailable'
        return result
    matched_envelope = aligned_source_envelope(source, envelope['source_sample_start'], len(clip))
    source_vad, source_threshold = energy_vad(matched_envelope)
    clip_vad, clip_threshold = energy_vad(clip_envelope)
    try:
        reference = segments_mask(segments, len(clip_envelope))
    except ValueError as error:
        result['vad']['reason'] = str(error)
        return result
    agreements = {'source_clip_speech_iou': speech_iou(source_vad, clip_vad),
                  'source_segments_speech_iou': speech_iou(source_vad, reference),
                  'clip_segments_speech_iou': speech_iou(clip_vad, reference)}
    agreement = min(agreements.values()) if all(value is not None for value in agreements.values()) else None
    result['vad'].update(agreements, agreement=agreement, source_threshold=source_threshold,
                         clip_threshold=clip_threshold, clip_speech_frames=int(np.sum(clip_vad)),
                         segment_frames=int(np.sum(reference)))
    result['v2_numeric_candidate'] = (envelope['score'] >= .90 and agreement is not None
                                      and agreement >= .90 and abs(envelope['best_lag_ms']) <= 30
                                      and duration_difference <= 30)
    return result


def encoded_interior_identity(source_bytes, clip_bytes):
    """Prove an exact interior byte copy; never equate a few similar landmarks.

    Header/trailer bytes are excluded explicitly. A contiguous interior copy
    covering >=75% of the clip is evidence for MP3 frame copying from the same
    encoded file; it does not waive duration/lag/VAD or any acceptance limit.
    Absence of such a copy does not prove a different recording.
    """
    trim = 1024
    if len(clip_bytes) < 8192:
        return {'proven': False, 'reason': 'clip_too_small_for_interior_copy_proof'}
    interior = clip_bytes[trim:-trim]
    position = source_bytes.find(interior)
    return {'proven': position >= 0, 'method': 'exact_contiguous_encoded_interior_copy',
            'excluded_header_bytes': trim, 'excluded_trailer_bytes': trim,
            'matched_interior_fraction': len(interior) / len(clip_bytes) if position >= 0 else 0,
            'source_byte_position': position if position >= 0 else None}


def interior_pcm_match(source, clip, source_sample_start):
    """Fixed-position, direct Pearson on the diagnostic PCM interior only.

    Exclude exactly 200ms from each end, require >=800ms remaining, and never
    search for a better lag. This ties identity evidence to the source position
    selected by the envelope metric. It neither recomputes nor repairs v1.
    """
    source, clip = _signal(source), _signal(clip)
    trim = round(200 * RATE / 1000)
    interior_count = len(clip) - 2 * trim
    result = {'measured': False, 'trim_each_side_ms': 200, 'minimum_interior_duration_ms': 800,
              'diagnosis_only': True, 'changes_v1_acceptance': False,
              'source_sample_start': int(source_sample_start)}
    if interior_count < round(800 * RATE / 1000):
        return {**result, 'reason': 'insufficient_fixed_interior_duration'}
    start, end = source_sample_start + trim, source_sample_start + len(clip) - trim
    if start < 0 or end > len(source):
        return {**result, 'reason': 'fixed_source_interior_out_of_bounds'}
    reference, observed = source[start:end], clip[trim:-trim]
    centered_reference, centered_observed = reference - np.mean(reference), observed - np.mean(observed)
    denominator = float(np.linalg.norm(centered_reference) * np.linalg.norm(centered_observed))
    if denominator <= 1e-15:
        return {**result, 'reason': 'constant_or_silent_interior'}
    score = float(np.dot(centered_reference, centered_observed) / denominator)
    return {**result, 'measured': True, 'score': float(np.clip(score, -1, 1)),
            'interior_duration_ms': interior_count * 1000 / RATE, 'passed': score >= .95}


def drift_diagnostics(samples):
    """Per-chapter reliable lag trend, never regress across different chapters."""
    chapters = {}
    for sample in samples:
        metric = sample['envelope']
        if metric.get('measured') and metric['score'] >= .90:
            chapters.setdefault(sample['surah'], []).append((sample['source_offset_ms'], metric['best_lag_ms']))
    results = []
    for surah, observations in sorted(chapters.items()):
        observations = sorted(observations)
        if len(observations) < 3:
            continue
        times, lags = np.asarray(observations, dtype=float).T
        if np.ptp(times) == 0:
            continue
        slope, intercept = np.polyfit(times, lags, 1)
        prediction = slope * times + intercept
        residual = float(np.std(lags - prediction))
        trend_span = float(abs(slope * np.ptp(times)))
        results.append({'surah': surah, 'reliable_sample_count': len(observations),
                        'slope_ms_per_second': float(slope * 1000), 'fitted_lag_change_ms': trend_span,
                        'residual_std_ms': residual, 'observed_lag_range_ms': float(np.ptp(lags)),
                        'increasing_drift_evidence': trend_span > 30 and residual <= 10})
    return results
