"""Snapshot a running B report and inventory local packet/native candidates.

This tool makes no network calls, invokes no audio decoder, and never changes
the live report, raw classifications, v1 measurements, or publication state.
Absolute scratch paths and the full snapshot remain in private output only.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def core_candidate(sample):
    envelope, vad = sample.get('envelope', {}), sample.get('vad', {})
    score, lag = envelope.get('score'), envelope.get('best_lag_ms')
    agreement, duration = vad.get('agreement'), sample.get('duration_difference_ms')
    return (envelope.get('measured') is True
            and all(finite(value) for value in (score, lag, agreement, duration))
            and score >= .90 and agreement >= .90 and abs(lag) <= 30 and 0 <= duration <= 30)


def provenance_guards(record, old):
    """Compare the measured inputs to retained v1, not marker booleans alone."""
    samples = record.get('samples', [])
    original = {(s['surah'], s['ayah']): s for s in old.get('samples', [])}
    pairs = [(s['surah'], s['ayah']) for s in samples]
    unique = bool(pairs) and len(pairs) == len(set(pairs)) and set(pairs) == set(original)
    counts = Counter(s['surah'] for s in samples)
    distribution = record.get('sample_distribution', {})
    chapters = distribution.get('chapters', {})
    distributed = (unique and distribution.get('verified') is True and len(counts) >= 3
                   and min(counts.values()) >= 5 and set(chapters) == {str(s) for s in counts})
    if distributed:
        for chapter, metadata in chapters.items():
            observed = [s['ayah'] for s in samples if str(s['surah']) == chapter]
            distributed = distributed and (
                observed == metadata.get('fixed_distributed_ayahs')
                and observed[0] == metadata.get('first_observed_ayah')
                and observed[-1] == metadata.get('last_observed_ayah'))
    source_hashes = record.get('source_sha256')
    source = (isinstance(source_hashes, dict) and bool(source_hashes)
              and source_hashes == record.get('retained_catalog_source_sha256')
              and source_hashes == old.get('catalog_source_sha256'))
    hf, metrics = unique, unique
    for sample in samples:
        original_sample = original.get((sample['surah'], sample['ayah']), {})
        hf = hf and (
            sample.get('same_hf_payload_as_original') is True
            and sample.get('same_hf_metadata_as_original') is True
            and sample.get('hf_audio_sha256') == sample.get('original_hf_audio_sha256')
            == original_sample.get('hf_audio_sha256')
            and sample.get('source_offset_ms') == original_sample.get('source_offset_ms')
            and sample.get('hf_duration_ms') == original_sample.get('duration_ms'))
        metrics = metrics and (sample.get('v1_original') == sample.get('v1_remeasured')
                              == original_sample.get('source_offset_hypothesis'))
    return {'fixed_distribution_matches_v1': bool(distributed),
            'reported_source_hashes_match_v1': bool(source),
            'hf_hashes_and_metadata_match_v1': bool(hf), 'v1_metrics_match': bool(metrics)}


def local_files(record):
    """Do not follow a network/UNC scratch path supplied by report data."""
    path = Path(record.get('scratch_dir', ''))
    temporary = Path(os.environ.get('TEMP', os.environ.get('TMP', '')))
    if (not path.is_absolute() or str(path).startswith(('\\\\', '//'))
            or not temporary.is_absolute() or not path.resolve().is_relative_to(temporary.resolve())):
        return None, []
    names = [f'{chapter}.audio' for chapter in sorted({s['surah'] for s in record.get('samples', [])})]
    names += [f"clip-{s['surah']}-{s['ayah']}.mp3" for s in record.get('samples', [])]
    return path, [{'filename': name, 'available': (path / name).is_file()} for name in names]


def inventory(diagnosis, retained):
    public, private = [], []
    for config, record in diagnosis.get('results', {}).items():
        samples = record.get('samples', [])
        guards = provenance_guards(record, retained.get('results', {}).get(config, {}))
        core = [core_candidate(s) for s in samples]
        complete = record.get('status') == 'measured' and bool(samples)
        all_core = complete and all(core)
        pcm_failed = [(s['surah'], s['ayah']) for s in samples
                      if s.get('interior_pcm', {}).get('passed') is False]
        encoded_missing = [(s['surah'], s['ayah']) for s in samples
                           if s.get('encoded_identity', {}).get('proven') is not True]
        scratch, files = local_files(record)
        local = bool(files) and all(item['available'] for item in files)
        needs_identity = bool(pcm_failed or encoded_missing)
        candidate = all_core and all(guards.values()) and needs_identity and local
        public.append({'config': config, 'raw_status': record.get('status'),
                       'raw_classification_pattern': record.get('classification', {}).get('pattern'),
                       'raw_classification_reason': record.get('classification', {}).get('reason'),
                       'sample_count': len(samples), 'core_candidate_samples': sum(core),
                       'all_samples_meet_reported_core': all_core,
                       'reported_numeric_markers_agree_with_computed_core': all(
                           s.get('v2_numeric_candidate') is flag for s, flag in zip(samples, core)),
                       'failed_raw_8khz_interior_samples': [{'surah': s, 'ayah': a} for s, a in pcm_failed],
                       'missing_encoded_identity_samples': [{'surah': s, 'ayah': a} for s, a in encoded_missing],
                       'provenance_guards': guards, 'local_files': files,
                       'local_audio_hashes_rechecked_here': False,
                       'local_packet_native_proof_candidate': candidate,
                       'v2_accepted': False, 'published': False})
        if candidate:
            private.append({'config': config, 'scratch': str(scratch),
                            'guarded_candidate_only': True,
                            'requires_packet_offset_bounds_and_fixed_native_identity': True,
                            'v2_acceptance_or_publication': False})
    return public, private


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['diagnosis', 'retained-v1', 'private-directory', 'report']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    path, retained_path = Path(args.diagnosis), Path(args.retained_v1)
    raw, old_raw = path.read_bytes(), retained_path.read_bytes()
    diagnosis, retained = json.loads(raw), json.loads(old_raw)
    rows, tasks = inventory(diagnosis, retained)
    digest = hashlib.sha256(raw).hexdigest()
    private = Path(args.private_directory) / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    private.mkdir(parents=True, exist_ok=False)
    snapshot = private / f'{digest}.diagnosis-snapshot.json'
    snapshot.write_bytes(raw)
    (private / 'local-proof-tasks.json').write_text(json.dumps(
        {'snapshot': str(snapshot), 'tasks': tasks, 'network_permitted': False}, indent=2) + '\n', encoding='utf-8')
    report = {'schema_version': 1, 'checked_at': datetime.now(timezone.utc).isoformat(),
              'read_only': True, 'live_diagnosis_snapshot_sha256': digest,
              'retained_v1_checkout_sha256': hashlib.sha256(old_raw).hexdigest(),
              'analyzer_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'calculator_snapshot': diagnosis.get('calculator'),
              'core_bounds': {'envelope_score_min': .90, 'vad_agreement_min': .90,
                              'absolute_lag_max_ms': 30, 'duration_difference_max_ms': 30},
              'records_observed': len(rows), 'all_core_config_count': sum(r['all_samples_meet_reported_core'] for r in rows),
              'local_proof_candidate_count': len(tasks), 'configs': rows,
              'audio_decodes_executed': 0, 'network_requests': 0, 'publication_changed': False,
              'v2_accepted': False, 'raw_classifications_replaced': False,
              'manual_cleanup_required': True, 'private_outputs': '%TEMP%\\ayahx-b-proof-candidates',
              'limitations': ['Core counts use the retained report measurements; no independent VAD replay occurs here.',
                              'Source/HF provenance compares retained evidence. Actual local audio file hashes are checked again by packet/native tools before a proof.',
                              'Numeric core, packet mapping, native identity, offset bounds, and publication remain separate decisions.',
                              'The running report can advance after this captured snapshot; this inventory does not resume or modify its helper.']}
    output = Path(args.report)
    if output.exists():
        raise ValueError('NEW_REPORT_FILENAME_REQUIRED; previous evidence preserved')
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'records': len(rows), 'all_core_configs': report['all_core_config_count'],
                      'local_proof_candidates': len(tasks), 'audio_decodes': 0, 'network_requests': 0}))


if __name__ == '__main__':
    main()
