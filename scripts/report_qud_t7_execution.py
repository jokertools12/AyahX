"""Read-only public T7 evidence from private checkpoints; never fetch or decide gates."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def report(manifest, checkpoint, checkpoint_sha):
    proof = dict(checkpoint)
    claimed = proof.pop('checkpoint_sha256')
    if digest(canonical(proof)) != claimed:
        raise ValueError('CHECKPOINT_SELF_SHA_MISMATCH')
    state = checkpoint['state']
    rows = {}
    fields = ['verification_status', 'reason', 'phase', 'verification_method_candidate',
              'offset_verified_candidate', 'v1_all_samples_passed', 'v2_all_gates_and_cause_proven',
              'classification', 'source_matches_retained', 'completed_at', 'checked_at',
              'surah_start_basmala_audio_status', 'drive_attempt_started', 'drive_attempt_complete']
    sample_fields = ['surah', 'ayah', 'source_offset_ms', 'hf_duration_ms', 'decoded_full_clip_duration_ms',
                     'duration_difference_ms', 'full_v1_diagnostic', 'interior_v1', 'full_source_window_complete',
                     't7_v1_passed', 'envelope', 'vad', 'spectral', 'log_mel', 'encoded_identity', 'interior_pcm',
                     'catalog_source_sha256', 'hf_clip_sha256', 'audio_measurement_scope']
    for slug, selection in manifest['results'].items():
        measured = state['results'].get(slug, {})
        samples = [{key: sample[key] for key in sample_fields if key in sample}
                   for sample in measured.get('samples', [])]
        failure = Counter()
        for sample in samples:
            if not sample.get('t7_v1_passed'):
                interior, full = sample.get('interior_v1', {}), sample.get('full_v1_diagnostic', {})
                if interior.get('score', -1) < .95:
                    failure['interior_raw_NCC_below_0.95'] += 1
                if abs(interior.get('best_lag_ms', 301)) > 30 or abs(full.get('best_lag_ms', 301)) > 30:
                    failure['optimal_lag_above_30ms'] += 1
                if sample.get('duration_difference_ms', 31) > 30:
                    failure['full_duration_difference_above_30ms'] += 1
                if not sample.get('full_source_window_complete'):
                    failure['source_window_incomplete'] += 1
        rows[slug] = {**{key: measured[key] for key in fields if key in measured},
                      'verification_status': measured.get('verification_status', 'not_started'),
                      'cohort': selection['cohort'], 'channel': selection['channel'], 'riwayah': selection['riwayah'],
                      'retained_v1_status': selection['retained_v1_status'],
                      'expected_sample_ids': [[sample['surah'], sample['ayah']] for sample in selection['samples']],
                      'measured_samples': len(samples), 'samples': samples, 'overlapping_v1_failure_counts': dict(failure),
                      'hf_windows': measured.get('hf_windows', []), 'publication_changed': False,
                      'database_offset_verified_changed': False, 'surah_start_basmala_audio_status': 'unverified'}
    bindings = {key: value for key, value in checkpoint['bindings'].items() if key != 'scratch'}
    return {'checked_at': datetime.now(timezone.utc).isoformat(), 'report_scope': 'Actual private checkpoint observations, no new gate decisions',
            'checkpoint_file_sha256': checkpoint_sha, 'checkpoint_self_sha256': claimed, 'checkpoint_sequence': checkpoint['sequence'],
            'bindings': bindings, 'database_writes': 0, 'publication_changed': False,
            'counts': dict(Counter(row['verification_status'] for row in rows.values())),
            'method_candidates': dict(Counter(row.get('verification_method_candidate') for row in rows.values()
                                              if row.get('offset_verified_candidate') is True)),
            'measured_samples': sum(row['measured_samples'] for row in rows.values()),
            'real_measurements_complete': state.get('real_measurements_complete', False),
            'http_events': state.get('http_events', []), 'transport_statistics': state.get('transport_statistics', {}),
            'results': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('manifest', 'manifest-sha', 'checkpoint', 'out'):
        parser.add_argument('--' + field, required=True)
    args = parser.parse_args()
    raw_manifest = Path(args.manifest).read_bytes()
    if digest(raw_manifest) != args.manifest_sha:
        raise ValueError('MANIFEST_FILE_SHA_MISMATCH')
    raw_checkpoint = Path(args.checkpoint).read_bytes()
    value = report(json.loads(raw_manifest), json.loads(raw_checkpoint), digest(raw_checkpoint))
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if 'https://' in text or 'http://' in text:
        raise ValueError('PUBLIC_REPORT_URL_PRESENT_REVIEW_REQUIRED')
    Path(args.out).write_text(text, encoding='utf-8')
    print(json.dumps({'counts': value['counts'], 'measured_samples': value['measured_samples'],
                      'report_sha256': digest(text.encode())}))


if __name__ == '__main__':
    main()
