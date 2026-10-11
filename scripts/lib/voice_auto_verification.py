"""Advisory K4 decisions. Pure calculations; never confirms identity or writes DB."""
import hashlib
import math
import re

ACTOR = 'auto-verifier-v1'
REQUIRED_AUDITIONS = {1, 112, 36}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fingerprint_conflicts(measurements):
    owners = {}
    for row in measurements:
        if row.get('source_sha256_matches') is not True or row.get('status') != 'measured':
            continue
        fingerprint = row.get('actual_source_sha256')
        if not isinstance(fingerprint, str) or len(fingerprint) != 64:
            raise ValueError('VERIFIED_CONTENT_SHA256_REQUIRED')
        owners.setdefault(fingerprint, []).append(row)
    return [{'sha256': fingerprint, 'reciter_ids': sorted({r['reciter_id'] for r in rows}),
             'recitations': sorted({r['slug'] for r in rows})}
            for fingerprint, rows in owners.items() if len({r['reciter_id'] for r in rows}) > 1]


def alignment_evidence(evidence):
    """Require measured content evidence, not HTTP success or forced timing alone.

    Forced alignment cannot independently identify a surah. A passing record
    must contain an independently decoded recognized reference and a calibrated
    confidence policy. Existing adapters do not guarantee these fields.
    """
    rows = evidence.get('samples', []) if isinstance(evidence, dict) else []
    reasons = []
    chapters = set()
    for row in rows:
        if row.get('measurement_scope') != 'actual_aligner_response':
            reasons.append('ALIGNER_ACTUAL_RESPONSE_REQUIRED')
            continue
        if row.get('surah') not in REQUIRED_AUDITIONS:
            reasons.append('ALIGNER_UNEXPECTED_SURAH')
            continue
        confidence, threshold = row.get('confidence'), row.get('calibrated_confidence_threshold')
        if (not isinstance(confidence, (int, float)) or isinstance(confidence, bool)
                or not math.isfinite(confidence) or not isinstance(threshold, (int, float))
                or isinstance(threshold, bool) or not math.isfinite(threshold)
                or not 0 <= threshold <= confidence <= 1
                or not re.fullmatch('[a-f0-9]{64}', row.get('calibration_evidence_sha256', ''))):
            reasons.append('ALIGNER_CALIBRATED_HIGH_CONFIDENCE_REQUIRED')
            continue
        if (row.get('recognized_reference_matches') is not True
                or row.get('word_coverage_complete') is not True
                or not re.fullmatch('[a-f0-9]{64}', row.get('audio_sha256', ''))
                or not re.fullmatch('[a-f0-9]{64}', row.get('response_sha256', ''))):
            reasons.append('ALIGNER_INDEPENDENT_CONTENT_MATCH_REQUIRED')
            continue
        chapters.add(row['surah'])
    if chapters != REQUIRED_AUDITIONS:
        reasons.append('ALIGNER_AUDITION_COVERAGE_INCOMPLETE')
    return {'passed': not reasons, 'status': 'passed' if not reasons else 'unverified',
            'covered_surahs': sorted(chapters), 'required_surahs': sorted(REQUIRED_AUDITIONS),
            'reasons': sorted(set(reasons))}


def decide_voice(v1, v2, v3, v4, speaker_model_available, youtube_without_licensed_file=False):
    reasons = []
    for name, evidence in [('V1', v1), ('V2', v2)]:
        if evidence.get('passed') is not True:
            reasons.append(name + '_NOT_VERIFIED')
    if speaker_model_available:
        for name, evidence in [('V3', v3), ('V4', v4)]:
            if evidence.get('status') == 'not_applicable' and name == 'V4':
                continue
            if evidence.get('passed') is not True:
                reasons.append(name + '_NOT_VERIFIED')
    if youtube_without_licensed_file:
        reasons.append('YOUTUBE_LICENSED_AUDIO_REQUIRED')
    return {'actor': ACTOR, 'voice_identity_status': 'unverified' if reasons else 'auto_verified',
            'decision_reasons': reasons, 'advisory_only': True, 'human_confirmation_changed': False,
            'license_changed': False, 'publication_changed': False}


def calibrated_threshold(same_scores, different_scores):
    if not same_scores or not different_scores:
        return {'accepted': False, 'reason': 'CALIBRATION_PAIRS_INCOMPLETE'}
    values = [*same_scores, *different_scores]
    if any(not math.isfinite(value) or not -1 <= value <= 1 for value in values):
        raise ValueError('FINITE_COSINE_SCORES_REQUIRED')
    lower, upper = max(different_scores), min(same_scores)
    if lower >= upper:
        return {'accepted': False, 'reason': 'CALIBRATION_CLASSES_OVERLAP',
                'maximum_different_score': lower, 'minimum_same_score': upper}
    return {'accepted': True, 'threshold': (lower + upper) / 2,
            'derivation': '(maximum_different_reader_cosine + minimum_same_reader_cosine)/2',
            'maximum_different_score': lower, 'minimum_same_score': upper,
            'same_pairs': len(same_scores), 'different_pairs': len(different_scores)}
