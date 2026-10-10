"""Unit metadata fixtures only: no network, decoder, database, delete or move."""
import gzip
import io
import json
from pathlib import Path
import unittest
import zipfile

import prepare_qud_t7_manifest as preparation


def metadata_rows():
    return [[f'{surah}:{ayah}', ayah * 1000, ayah * 1000 + 900, True, 100]
            for surah, count in enumerate((6, 10, 15, 20, 30, 40), 1) for ayah in range(1, count + 1)]


def record(slug, channel='mp3quran'):
    url = 'https://drive.google.com/uc?id=' + slug if channel == 'drive' else 'https://audio.example/' + slug + '/'
    return {'slug': slug, 'channel': channel, 'riwayah': 'hafs_an_asim', 'audio': {
        'chapter_urls': {str(surah): url if channel == 'drive' else url + str(surah) + '.mp3' for surah in range(1, 7)},
        'chapter_offsets_ms': {'1': 5000}}}


def package(slug, rows):
    content = {'_meta': {'schema_version': 3, 'slug': slug, 'units': 'ms', 'tier': 'verse', 'occurrence_count': len(rows)}, 'rows': rows}
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as target:
        target.writestr('verse_timestamps.json.gz', gzip.compress(json.dumps(content).encode(), mtime=0))
    return output.getvalue()


def fixture():
    slugs = ['boundary_one', *preparation.DRIVE_TARGETS]
    records = [record(slug, 'drive' if slug in preparation.DRIVE_TARGETS else 'mp3quran') for slug in slugs]
    originals = {slug: {'verification_status': 'source_unavailable' if slug in preparation.DRIVE_TARGETS else 'failed',
                        'samples': [] if slug in preparation.DRIVE_TARGETS else [{'surah': 1, 'ayah': 1}],
                        'catalog_source_sha256': {'1': 'a' * 64}} for slug in slugs}
    raw = {'results': {'boundary_one': {'samples': [{'surah': 2, 'ayah': 3}]}}}
    review = {'raw_report_sha256': 'raw', 'original_semantic_sha256': preparation.digest(preparation.canonical({'results': originals})),
              'validation_errors': [], 'results': {'boundary_one': {'reviewed_pattern': 'boundary_confounded', 'proof_errors': [], 'samples': [{'surah': 3, 'ayah': 4}]}}}
    summary = {'input_sha256': {'raw': 'raw', 'review': 'review', 'catalog': 'catalog'}, 'reviewed_cause_counts': {'boundary_confounded': 1},
               'recitations': [{'config': 'boundary_one', 'reviewed_cause': 'boundary_confounded'}]}
    packages = {slug: package(slug, metadata_rows()) for slug in slugs}
    pins = {'qud_version': 'v3.2.0', 'results': [{'slug': slug, 'source_sha256': preparation.digest(packages[slug])} for slug in slugs]}
    return {'catalog': {'recitations': records}, 'original': {'results': originals}, 'raw': raw, 'review': review,
            'summary': summary, 'preparation': pins, 'load_package': packages.__getitem__,
            'input_hashes': {'raw': 'raw', 'review': 'review', 'catalog': 'catalog'}}


class T7PreparationTests(unittest.TestCase):
    def test_abbreviated_signed_query_keys_are_prohibited_before_lock(self):
        for key in ('sig', 'api_key', 'apikey', 'api-key'):
            with self.assertRaisesRegex(ValueError, 'PUBLIC_PERSISTENT'):
                preparation.public_source('https://audio.example/source.mp3?' + key + '=fixture')

    def test_fixed_new_quintiles_distributed_over_three_different_observed_lengths(self):
        previous = {(1, 1), (2, 3), (3, 4)}
        selected = preparation.choose_samples(record('one'), metadata_rows(), previous)
        self.assertEqual(selected['state'], 'prepared')
        self.assertEqual(selected['sample_count'], 15)
        self.assertEqual(len(selected['chapters']), 3)
        self.assertEqual(len({p['observed_ayah_count'] for p in selected['distribution_proof'].values()}), 3)
        pairs = {(row['surah'], row['ayah']) for row in selected['samples']}
        self.assertEqual(len(pairs), 15)
        self.assertFalse(pairs.intersection(previous))
        for chapter in selected['chapters']:
            self.assertEqual(sum(row['surah'] == chapter for row in selected['samples']), 5)
        self.assertEqual(selected, preparation.choose_samples(record('one'), list(reversed(metadata_rows())), previous))

    def test_union_exclusion_from_every_retained_v1_raw_and_review_sample(self):
        inputs = fixture()
        pairs = preparation.retained_pairs('boundary_one', inputs['original'], inputs['raw'], inputs['review'])
        self.assertEqual(pairs, {(1, 1), (2, 3), (3, 4)})

    def test_invalid_interval_is_not_silently_removed_or_replaced(self):
        rows = metadata_rows()
        chosen = preparation.choose_samples(record('one'), rows, set())['samples'][0]
        row = next(row for row in rows if row[0] == f"{chosen['surah']}:{chosen['ayah']}")
        row[2] = row[1] - 1
        second = preparation.choose_samples(record('one'), rows, set())
        self.assertEqual(second['samples'][0]['release_occurrence_intervals'][0][1], row[2])
        self.assertEqual([(r['surah'], r['ayah']) for r in second['samples']],
                         [(r['surah'], r['ayah']) for r in preparation.choose_samples(record('one'), metadata_rows(), set())['samples']])

    def test_insufficient_new_ids_retains_blocked_record_without_relaxation(self):
        excluded = {(surah, ayah) for surah in range(1, 7) for ayah in range(1, 41)}
        result = preparation.choose_samples(record('one'), metadata_rows(), excluded)
        self.assertEqual(result['state'], 'blocked')
        self.assertEqual(result['samples'], [])

    def test_source_package_pin_and_schema_are_verified_in_memory(self):
        payload = package('one', metadata_rows())
        self.assertEqual(preparation.verse_metadata(payload, preparation.digest(payload), 'one'), metadata_rows())
        with self.assertRaisesRegex(ValueError, 'PACKAGE_SHA_MISMATCH'):
            preparation.verse_metadata(payload, 'f' * 64, 'one')
        with self.assertRaisesRegex(ValueError, 'SCHEMA_MISMATCH'):
            preparation.verse_metadata(payload, preparation.digest(payload), 'another')

    def test_manifest_is_deterministic_and_not_an_acoustic_result(self):
        inputs = fixture()
        manifest = preparation.build_manifest(**inputs)
        self.assertEqual(manifest, preparation.build_manifest(**inputs))
        self.assertEqual(manifest['network_requests'], 0)
        self.assertEqual(manifest['audio_measurements'], 0)
        self.assertEqual(manifest['database_writes'], 0)
        self.assertEqual(manifest['comparison_policy']['trim_each_side_ms'], 300)
        self.assertTrue(manifest['comparison_policy']['full_clip_duration_gate_is_untrimmed'])
        self.assertEqual(manifest['comparison_policy']['v1'], {'NCC_min': .95, 'duration_difference_ms_max': 30, 'absolute_lag_ms_max': 30})
        self.assertTrue(manifest['comparison_policy']['v2']['codec_cause_must_be_proven'])
        self.assertTrue(manifest['comparison_policy']['v2']['numeric_pass_alone_not_accepted'])
        for row in manifest['results'].values():
            self.assertFalse(row['new_results_present'])
            self.assertFalse(row['offset_verified_changed'])
        for slug in preparation.DRIVE_TARGETS:
            self.assertEqual(manifest['results'][slug]['drive_fetch_policy']['attempts_per_recitation_max'], 1)
            self.assertEqual(len(manifest['results'][slug]['drive_fetch_policy']['public_source_urls']), 1)

    def test_samples_do_not_depend_on_previous_scores_and_failures_remain_failures(self):
        inputs = fixture()
        first = preparation.build_manifest(**inputs)
        inputs['raw']['results']['boundary_one']['samples'][0]['score'] = -1
        inputs['original']['results']['boundary_one']['offset_check_score'] = 0.999
        inputs['review']['original_semantic_sha256'] = preparation.digest(preparation.canonical(inputs['original']))
        second = preparation.build_manifest(**inputs)
        self.assertEqual(first['results']['boundary_one']['samples'], second['results']['boundary_one']['samples'])
        self.assertEqual(second['results']['boundary_one']['retained_v1_status'], 'failed')

    def test_modified_review_cohort_or_missing_retained_records_stop_preparation(self):
        inputs = fixture()
        inputs['summary']['reviewed_cause_counts']['boundary_confounded'] = 2
        with self.assertRaisesRegex(ValueError, 'COHORT_SET_MISMATCH'):
            preparation.build_manifest(**inputs)
        inputs = fixture()
        inputs['raw']['results'].clear()
        with self.assertRaisesRegex(ValueError, 'FAILED_COHORT_INCOMPLETE'):
            preparation.build_manifest(**inputs)
        inputs = fixture()
        inputs['review']['raw_report_sha256'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'EVIDENCE_BINDING_FAILED'):
            preparation.build_manifest(**inputs)

    def test_no_youtube_signed_credential_or_authenticated_source_allowed(self):
        for url in ('https://www.youtube.com/watch?v=a', 'https://youtu.be/b', 'https://audio.example/a.mp3?token=secret',
                    'https://user:secret@audio.example/a.mp3', 'http://audio.example/a.mp3'):
            with self.assertRaisesRegex(ValueError, 'PUBLIC_PERSISTENT'):
                preparation.public_source(url)
        self.assertEqual(preparation.public_source('https://drive.google.com/uc?id=AbC_123'), 'https://drive.google.com/uc?id=AbC_123')

    def test_helper_has_no_execution_or_cleanup_primitives(self):
        source = Path(preparation.__file__).read_text(encoding='utf-8')
        # Executor warnings may name prohibited methods; actual helper contains no call/import for them.
        for forbidden in ('import urllib.request', 'import subprocess', 'import shutil', '.unlink(', '.replace(', '.rename(', 'shutil.rmtree('):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
