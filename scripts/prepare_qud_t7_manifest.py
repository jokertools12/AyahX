"""Pure T7 selection preparation. No network, decoder, database, delete or move.

The output is a locked protocol, not an acoustic result or permission to execute
T7. Existing v1/B sample IDs are excluded before selection. Scores, durations,
lags, readiness and previous pass/fail metrics never rank sample candidates.
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlparse
import zipfile

DRIVE_TARGETS = (
    'ibrahim_al_akhdar_drive', 'khalid_al_mohana_drive', 'mohammed_ayyub_drive',
    'mohammed_siddiq_al_minshawi_1967_drive',
)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def public_source(url):
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.fragment
            or host == 'youtu.be' or 'youtube' in host or host.endswith('.googlevideo.com')
            or any(re.search(r'token|signature|credential|expires|x-amz|x-goog|policy|^sig$|^api[_-]?key$', key, re.I)
                   for key, _ in parse_qsl(parsed.query))):
        raise ValueError('PUBLIC_PERSISTENT_NON_YOUTUBE_SOURCE_REQUIRED')
    return url


def retained_pairs(slug, *reports):
    pairs = set()
    for report in reports:
        for sample in report.get('results', {}).get(slug, {}).get('samples', []):
            surah, ayah = sample.get('surah'), sample.get('ayah')
            if type(surah) is not int or type(ayah) is not int or surah <= 0 or ayah <= 0:
                raise ValueError('RETAINED_SAMPLE_IDS_INVALID')
            pairs.add((surah, ayah))
    return pairs


def verse_metadata(package_bytes, expected_sha256, slug):
    if digest(package_bytes) != expected_sha256:
        raise ValueError('PINNED_RELEASE_PACKAGE_SHA_MISMATCH')
    with zipfile.ZipFile(io.BytesIO(package_bytes)) as package:
        value = json.loads(gzip.decompress(package.read('verse_timestamps.json.gz')))
    meta, rows = value.get('_meta', {}), value.get('rows')
    if (meta.get('schema_version') != 3 or meta.get('slug') != slug or meta.get('units') != 'ms'
            or meta.get('tier') != 'verse' or not isinstance(rows, list)
            or len(rows) != meta.get('occurrence_count')):
        raise ValueError('PINNED_RELEASE_VERSE_SCHEMA_MISMATCH')
    return rows


def choose_samples(record, verse_rows, excluded):
    observed, occurrences = defaultdict(set), defaultdict(list)
    urls = record['audio']['chapter_urls']
    for row in verse_rows:
        if not isinstance(row, list) or len(row) != 5 or not re.fullmatch(r'\d+:\d+', str(row[0])):
            raise ValueError('RELEASE_VERSE_REFERENCE_SCHEMA_INVALID')
        surah, ayah = map(int, row[0].split(':'))
        if surah <= 0 or ayah <= 0 or str(surah) not in urls:
            continue
        observed[surah].add(ayah)
        # Preserve invalid interval metadata in the protocol; never filter it to improve later results.
        occurrences[(surah, ayah)].append(row[1:])
    fresh = {surah: sorted(ayah for ayah in ayahs if (surah, ayah) not in excluded)
             for surah, ayahs in observed.items()}
    eligible = sorted(surah for surah, ayahs in fresh.items() if len(ayahs) >= 5)
    pool = eligible[len(eligible) * 2 // 3:]
    by_length = {}
    for surah in pool:
        by_length.setdefault(len(observed[surah]), surah)
    # Metadata-only fallback happens before any results, never as a response to a failed measurement.
    if len(by_length) < 3:
        for surah in eligible:
            by_length.setdefault(len(observed[surah]), surah)
    lengths = sorted(by_length)
    if len(lengths) < 3:
        return {'state': 'blocked', 'reason': 'INSUFFICIENT_NEW_AYAH_IDS_IN_THREE_DISTINCT_OBSERVED_LENGTHS',
                'eligible_chapter_count': len(eligible), 'distinct_observed_lengths': lengths, 'samples': []}
    chapters = sorted(by_length[lengths[index]] for index in (0, len(lengths) // 2, len(lengths) - 1))
    samples, proof = [], {}
    for surah in chapters:
        available = fresh[surah]
        # Python round uses ties-to-even, matching the retained auditor. Exactly five new IDs.
        ayahs = [available[round(index * (len(available) - 1) / 4)] for index in range(5)]
        url = public_source(urls[str(surah)])
        proof[str(surah)] = {'observed_ayah_count': len(observed[surah]), 'new_candidate_count': len(available),
                             'excluded_old_ids': sorted(ayah for chapter, ayah in excluded if chapter == surah),
                             'fixed_distributed_ayahs': ayahs, 'quintile_pool': 'observed_ids_minus_all_retained_sample_ids'}
        for ayah in ayahs:
            samples.append({'surah': surah, 'ayah': ayah, 'original_public_url': url,
                            'release_occurrence_intervals': occurrences[(surah, ayah)],
                            'catalog_chapter_offset_ms': record['audio'].get('chapter_offsets_ms', {}).get(str(surah)),
                            'coordinate_note': 'Release tier metadata retained unchanged; do not add chapter base to HF absolute source_offset_ms.'})
    if len(samples) != len({(row['surah'], row['ayah']) for row in samples}) or any((row['surah'], row['ayah']) in excluded for row in samples):
        raise ValueError('NEW_SAMPLE_SELECTION_INVARIANT_FAILED')
    return {'state': 'prepared', 'chapters': chapters, 'samples': samples, 'sample_count': len(samples),
            'distribution_proof': proof, 'eligible_chapter_count': len(eligible)}


def build_manifest(catalog, original, raw, review, summary, preparation, load_package, input_hashes):
    records = {row['slug']: row for row in catalog['recitations']}
    if len(records) != len(catalog['recitations']) or set(records) != set(original['results']):
        raise ValueError('CATALOG_ORIGINAL_RECITATION_SET_MISMATCH')
    failed = {slug for slug, row in original['results'].items() if row['verification_status'] == 'failed'}
    if set(raw['results']) != failed or set(review['results']) != failed:
        raise ValueError('RETAINED_B_FAILED_COHORT_INCOMPLETE')
    if (review.get('validation_errors') or any(row.get('proof_errors') for row in review['results'].values())
            or review['raw_report_sha256'] != input_hashes['raw']
            or summary['input_sha256']['raw'] != input_hashes['raw']
            or summary['input_sha256']['review'] != input_hashes['review']
            or summary['input_sha256']['catalog'] != input_hashes['catalog']
            or review['original_semantic_sha256'] != digest(canonical(original))):
        raise ValueError('RETAINED_B_EVIDENCE_BINDING_FAILED')
    boundary = sorted(slug for slug, row in review['results'].items() if row['reviewed_pattern'] == 'boundary_confounded')
    declared = sorted(row['config'] for row in summary['recitations'] if row['reviewed_cause'] == 'boundary_confounded')
    if boundary != declared or len(boundary) != summary['reviewed_cause_counts']['boundary_confounded']:
        raise ValueError('BOUNDARY_COHORT_SET_MISMATCH')
    pins = {row['slug']: row for row in preparation['results']}
    if preparation['qud_version'] != 'v3.2.0' or set(pins) != set(records):
        raise ValueError('PINNED_D3_PREPARATION_SET_OR_VERSION_MISMATCH')
    results = {}
    for slug in sorted(set(boundary).union(DRIVE_TARGETS)):
        if slug not in records or slug not in pins:
            raise ValueError('REQUESTED_T7_RECITATION_MISSING')
        record = records[slug]
        if record['channel'] == 'youtube':
            raise ValueError('T7_YOUTUBE_PROHIBITED')
        drive = slug in DRIVE_TARGETS
        if drive and record['channel'] != 'drive':
            raise ValueError('REQUESTED_DRIVE_RECITATION_CHANNEL_MISMATCH')
        if not drive and original['results'][slug]['verification_status'] != 'failed':
            raise ValueError('BOUNDARY_TARGET_NOT_A_RETAINED_V1_FAILURE')
        package = load_package(slug)
        excluded = retained_pairs(slug, original, raw, review)
        selected = choose_samples(record, verse_metadata(package, pins[slug]['source_sha256'], slug), excluded)
        results[slug] = {**selected, 'cohort': 'public_drive_retry_once' if drive else 'boundary_confounded',
                         'channel': record['channel'], 'riwayah': record['riwayah'],
                         'source_package_sha256': pins[slug]['source_sha256'],
                         'retained_v1_status': original['results'][slug]['verification_status'],
                         'retained_excluded_pairs': [list(pair) for pair in sorted(excluded)],
                         'retained_catalog_source_sha256': original['results'][slug].get('catalog_source_sha256', {}),
                         'new_results_present': False, 'offset_verified_changed': False, 'publication_changed': False}
        if drive:
            source_urls = sorted({public_source(row['original_public_url']) for row in selected['samples']})
            if any(urlparse(url).hostname not in ('drive.google.com', 'drive.usercontent.google.com') for url in source_urls):
                raise ValueError('DRIVE_PUBLIC_SOURCE_HOST_REQUIRED')
            results[slug]['drive_fetch_policy'] = {'attempts_per_recitation_max': 1, 'attempts_per_public_file_max': 1, 'request_start_spacing_ms_min': 5000,
                'maximum_read_bytes_per_second': 81920, 'public_source_urls': source_urls,
                'no_confirmation_or_quota_bypass': True, 'unavailable_remains_source_unavailable': True}
    protocol = {
        'schema_version': 1, 'task': 'D4/T7 sample preparation only', 'preparation_only': True,
        'network_requests': 0, 'database_writes': 0, 'audio_measurements': 0,
        'execution_gate': 'T0_through_T6_accepted_and_root_self_review_before_any_audio_or_HF_request',
        'input_sha256': input_hashes, 'boundary_cohort': boundary, 'drive_retry_cohort': list(DRIVE_TARGETS),
        'algorithm': {'version': 'new-retained-exclusion-quintiles-v1',
            'old_id_exclusion': 'union of original v1, retained B raw and independent-review sample pairs, per recitation',
            'chapter_pool': 'last third of eligible sorted chapter IDs; metadata-only whole-set extension if fewer than three distinct observed lengths',
            'chapter_selection': 'smallest, median and largest distinct observed ayah counts; first surah ID for a length',
            'ayah_selection': 'five ties-to-even rounded quintiles of sorted observed IDs after exclusion',
            'ranking_uses_audio_scores_or_duration_or_ready_state': False, 'reselect_after_measurement': False,
            'insufficient_selection': 'blocked record retained; do not replace targets or relax limits'},
        'comparison_policy': {'trim_each_side_ms': 300, 'lag_search_absolute_max_ms': 300,
            'trim_after_full_clip_decode': True, 'full_clip_duration_gate_is_untrimmed': True,
            'source_window_truncation_is_failure': True, 'interior_too_short_is_failure_no_reselection': True,
            'v1': {'NCC_min': 0.95, 'duration_difference_ms_max': 30, 'absolute_lag_ms_max': 30},
            'v2': {'envelope_NCC_min': 0.90, 'VAD_agreement_min': 0.90, 'duration_difference_ms_max': 30,
                'absolute_lag_ms_max': 30, 'extra_log_mel_score_min': 0.90, 'codec_cause_must_be_proven': True,
                'exact_contiguous_encoded_interior_copy_required': True, 'fixed_position_PCM_NCC_min': 0.95,
                'fixed_position_minimum_interior_ms': 800, 'retained_source_identity_must_be_proven': True,
                'drift_or_different_recording_never_eligible': True, 'numeric_pass_alone_not_accepted': True},
            'retain_full_v1_and_full_v2_diagnostics_alongside_new_interior_metrics': True,
            'hf_request_spacing_ms_min': 2000, 'hf_retry_windows_max': 3, 'hf_retry_window_spacing_ms_min': 1800000},
        'executor_adaptations_required': [
            'Consume this exact manifest and its SHA; do not call old sample_chapters/selected_rows/distribution_proof to reselect.',
            'Old verify-qud-offsets.py performs shutil.rmtree and checkpoint.replace: do not execute that audit/main under the no-delete/no-move policy.',
            'Old B additional_metrics uses complete windows and interior_pcm_match trims 200ms: add explicit locked 300ms interior measurements, preserving complete duration and old gates.',
            'Keep source_offset_ms from HF absolute; never add catalog chapter offsets a second time.',
            'Use audit-only HF supplied segments; log every outcome and 500 response/time; do not switch providers or accelerate retry windows.',
        ], 'results': results,
    }
    protocol['selection_sha256'] = digest(canonical(protocol))
    return protocol


def outside_git(path):
    resolved = path.resolve()
    if any((parent / '.git').exists() for parent in (resolved.parent, *resolved.parents)):
        raise ValueError('PRIVATE_PREPARATION_OUTPUT_OUTSIDE_ALL_GIT_CHECKOUTS_REQUIRED')
    return resolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('catalog', 'original', 'raw', 'review', 'summary', 'preparation', 'release-dir', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    inputs = {name: getattr(args, name).read_bytes() for name in ('catalog', 'original', 'raw', 'review', 'summary', 'preparation')}
    hashes = {name: digest(value) for name, value in inputs.items()}
    hashes['preparer_script'] = digest(Path(__file__).read_bytes())
    data = {name: json.loads(value) for name, value in inputs.items()}
    manifest = build_manifest(**data, load_package=lambda slug: (args.release_dir / (slug + '.zip')).read_bytes(), input_hashes=hashes)
    encoded = json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode('utf-8') + b'\n'
    output = outside_git(args.output)
    if output.exists():
        if output.read_bytes() != encoded:
            raise ValueError('LOCKED_SELECTION_ALREADY_EXISTS_AND_DIFFERS_PRESERVE_PREVIOUS_MANIFEST')
    else:
        with output.open('xb') as stream:
            stream.write(encoded)
    print(json.dumps({'preparation_only': True, 'boundary_recitations': len(manifest['boundary_cohort']),
                      'drive_recitations': len(manifest['drive_retry_cohort']), 'network_requests': 0,
                      'prepared': sum(row['state'] == 'prepared' for row in manifest['results'].values()),
                      'blocked': sum(row['state'] == 'blocked' for row in manifest['results'].values()),
                      'manifest_file_sha256': digest(encoded), 'selection_sha256': manifest['selection_sha256']}))


if __name__ == '__main__':
    main()
