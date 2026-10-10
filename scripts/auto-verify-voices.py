"""Build K4's 69-row advisory evidence, no network or database writes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path

from lib.voice_auto_verification import alignment_evidence, decide_voice, fingerprint_conflicts, sha256


def load(path):
    raw = Path(path).read_bytes()
    return json.loads(raw), sha256(raw)


def build(catalog, identity, alignment=None, speakers=None, youtube_metadata=None):
    alignment, speakers, youtube_metadata = alignment or {}, speakers or {}, youtube_metadata or {}
    measurements = identity.get('duration_quality_comparison', {}).get('measurements', [])
    conflicts = fingerprint_conflicts(measurements)
    pcm_measurements = [{**row, 'actual_source_sha256': row['decoded_pcm_sha256'],
                         'source_sha256_matches': True, 'status': 'measured'}
                        for row in speakers.get('measurements', [])]
    conflicts += [{**row, 'scope': 'fixed_10000ms_start_25000ms_decoded_PCM'}
                  for row in fingerprint_conflicts(pcm_measurements)]
    conflicted = {slug for group in conflicts for slug in group['recitations']}
    aliases = {row['slug']: row for row in identity['folder_checks']}
    measured = {}
    for row in measurements:
        if row.get('source_sha256_matches') is True and row.get('status') == 'measured':
            measured.setdefault(row['slug'], []).append({'surah': row['surah'], 'sha256': row['actual_source_sha256']})
    siblings = Counter(row['reciter_id'] for row in catalog['recitations'])
    rows = []
    for recitation in catalog['recitations']:
        slug = recitation['slug']
        alias = aliases.get(slug, {})
        metadata = youtube_metadata.get(slug, {})
        metadata_match = (alias.get('folder_classification') == 'DESCRIPTIVE_FOLDER_ALIAS_MATCH'
                          or metadata.get('original_name_match_verified') is True)
        fingerprints = measured.get(slug, [])
        v1_pass = metadata_match and len({r['surah'] for r in fingerprints}) >= 2 and slug not in conflicted
        v1 = {'passed': v1_pass, 'status': 'passed' if v1_pass else 'unverified',
              'metadata_name_match': metadata_match,
              'folder_classification': alias.get('folder_classification', 'NOT_CHECKED'),
              'content_fingerprint_scope': fingerprints, 'cross_reader_content_conflict': slug in conflicted,
              'limitations': 'Folder/channel correspondence and content uniqueness are provenance evidence, not absolute voice-name identity.'}
        v2 = alignment_evidence(alignment.get('results', {}).get(slug, {}))
        speaker = speakers.get('results', {}).get(slug, {})
        model_available = speakers.get('model_loaded') is True
        v3 = speaker.get('V3', {'passed': False, 'status': 'unverified', 'reason': 'SPEAKER_EVIDENCE_UNAVAILABLE'})
        v4 = (speaker.get('V4', {'passed': False, 'status': 'unverified', 'reason': 'SIBLING_SPEAKER_COVERAGE_INCOMPLETE'})
              if siblings[recitation['reciter_id']] > 1 else {'status': 'not_applicable', 'reason': 'SINGLE_RECITATION_READER'})
        if model_available and speakers.get('calibration', {}).get('accepted') is not True:
            reason = speakers.get('calibration', {}).get('reason', 'SPEAKER_CALIBRATION_NOT_ACCEPTED')
            v3 = {**v3, 'passed': False, 'status': 'unverified', 'reason': reason}
            if siblings[recitation['reciter_id']] > 1:
                v4 = {**v4, 'passed': False, 'status': 'unverified', 'reason': reason}
        if siblings[recitation['reciter_id']] > 1:
            expected_siblings = {r['slug'] for r in catalog['recitations'] if r['reciter_id'] == recitation['reciter_id'] and r['slug'] != slug}
            observed_siblings = {r['slug'] for r in speakers.get('measurements', []) if r['reciter_id'] == recitation['reciter_id'] and r['slug'] != slug}
            missing_siblings = sorted(expected_siblings - observed_siblings)
            if missing_siblings:
                v4 = {**v4, 'passed': False, 'status': 'unverified', 'reason': 'SIBLING_SPEAKER_COVERAGE_INCOMPLETE', 'missing_recitations': missing_siblings}
        licensed = metadata.get('licensed_file_verified') is True
        decision = decide_voice(v1, v2, v3, v4, model_available, recitation['channel'] == 'youtube' and not licensed)
        rows.append({'slug': slug, 'reciter_id': recitation['reciter_id'], 'name_ar': recitation['name_ar'],
                     'provider': recitation['channel'], 'V1': v1, 'V2': v2, 'V3': v3, 'V4': v4,
                     **decision, 'review_item_type': 'voice_confirmation'})
    calibration_pairs = [r for r in speakers.get('pairs', []) if r.get('cohort') == 'calibration']
    same = [r for r in calibration_pairs if r.get('same_catalog_reader')]
    different = [r for r in calibration_pairs if not r.get('same_catalog_reader')]
    speaker_summary = {'model_loaded': speakers.get('model_loaded') is True, 'model': speakers.get('model'),
                       'calibration': speakers.get('calibration'), 'model_files_sha256': speakers.get('model_files_sha256'),
                       'elapsed_seconds': speakers.get('elapsed_seconds'), 'measured_sources': len(speakers.get('measurements', [])),
                       'measured_recitations': len(speakers.get('results', {})), 'unavailable_sources': len(speakers.get('unavailable', [])),
                       'calibration_same_pairs': len(same), 'calibration_different_pairs': len(different),
                       'minimum_same_pair': min(same, key=lambda r: r['cosine_raw']) if same else None,
                       'maximum_different_pair': max(different, key=lambda r: r['cosine_raw']) if different else None,
                       'measurement_protocol': speakers.get('protocol')}
    return {'schema_version': 1, 'actor': 'auto-verifier-v1', 'checked_at': datetime.now(timezone.utc).isoformat(),
            'scope': 'Advisory automated checks only. Speaker consistency does not prove absolute named identity.',
            'network_requests': 0, 'database_writes': 0, 'same_audio_conflicts': conflicts, 'speaker_measurement_summary': speaker_summary,
            'counts': {'recitations': len(rows), 'status': dict(Counter(row['voice_identity_status'] for row in rows)),
                       'checks_passed': {key: sum(row[key].get('passed') is True for row in rows) for key in ['V1', 'V2', 'V3', 'V4']}},
            'results': {row['slug']: row for row in rows}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('catalog', 'identity', 'out'):
        parser.add_argument('--' + field, required=True)
    for field in ('alignment', 'speakers', 'youtube-metadata'):
        parser.add_argument('--' + field)
    args = parser.parse_args()
    inputs, hashes = {}, {}
    for key in ('catalog', 'identity', 'alignment', 'speakers', 'youtube_metadata'):
        path = getattr(args, key, None)
        if path:
            inputs[key], hashes[key] = load(path)
    report = build(**inputs)
    report['input_sha256'] = hashes
    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps(report['counts']))


if __name__ == '__main__':
    main()
