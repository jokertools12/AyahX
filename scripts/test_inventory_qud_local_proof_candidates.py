"""Core/provenance controls never infer v2 acceptance from identity alone."""
from copy import deepcopy
import unittest

from inventory_qud_local_proof_candidates import core_candidate, provenance_guards


def sample():
    return {'envelope': {'measured': True, 'score': .95, 'best_lag_ms': 30},
            'vad': {'agreement': .9}, 'duration_difference_ms': 30,
            'interior_pcm': {'passed': False}, 'encoded_identity': {'proven': True}}


def records():
    original = {'catalog_source_sha256': {'1': 'a', '2': 'b', '3': 'c'}, 'samples': []}
    current = {'source_sha256': original['catalog_source_sha256'].copy(),
               'retained_catalog_source_sha256': original['catalog_source_sha256'].copy(),
               'samples': [], 'sample_distribution': {'verified': True, 'chapters': {}}}
    for chapter in (1, 2, 3):
        current['sample_distribution']['chapters'][str(chapter)] = {
            'fixed_distributed_ayahs': [1, 2, 3, 4, 5], 'first_observed_ayah': 1, 'last_observed_ayah': 5}
        for ayah in range(1, 6):
            old = {'surah': chapter, 'ayah': ayah, 'hf_audio_sha256': f'{chapter}-{ayah}',
                   'source_offset_ms': 1000, 'duration_ms': 100,
                   'source_offset_hypothesis': {'passed': False, 'score': .8}}
            original['samples'].append(old)
            current['samples'].append({**sample(), 'surah': chapter, 'ayah': ayah,
                'hf_audio_sha256': old['hf_audio_sha256'], 'original_hf_audio_sha256': old['hf_audio_sha256'],
                'same_hf_payload_as_original': True, 'same_hf_metadata_as_original': True,
                'source_offset_ms': 1000, 'hf_duration_ms': 100,
                'v1_original': old['source_offset_hypothesis'].copy(),
                'v1_remeasured': old['source_offset_hypothesis'].copy()})
    return current, original


class LocalCandidateTest(unittest.TestCase):
    def test_identity_failure_is_separate_from_numeric_core(self):
        self.assertTrue(core_candidate(sample()))
        broken = sample()
        broken['vad']['agreement'] = .89
        self.assertFalse(core_candidate(broken))

    def test_bounds_are_finite_inclusive_and_never_coerced(self):
        for key, value in [('best_lag_ms', 30.00001), ('score', float('nan')), ('score', True)]:
            row = sample()
            row['envelope'][key] = value
            self.assertFalse(core_candidate(row))
        row = sample()
        row['duration_difference_ms'] = -1
        self.assertFalse(core_candidate(row))

    def test_source_or_hf_change_cannot_become_candidate(self):
        current, old = records()
        self.assertTrue(all(provenance_guards(current, old).values()))
        changed = deepcopy(current)
        changed['source_sha256']['2'] = 'new'
        self.assertFalse(provenance_guards(changed, old)['reported_source_hashes_match_v1'])
        changed = deepcopy(current)
        changed['samples'][0]['source_offset_ms'] += 1
        self.assertFalse(provenance_guards(changed, old)['hf_hashes_and_metadata_match_v1'])

    def test_distribution_or_v1_metric_change_fails_guard(self):
        current, old = records()
        current['samples'].pop()
        self.assertFalse(provenance_guards(current, old)['fixed_distribution_matches_v1'])
        current, old = records()
        current['samples'][0]['v1_remeasured']['score'] = .9
        self.assertFalse(provenance_guards(current, old)['v1_metrics_match'])


if __name__ == '__main__':
    unittest.main()
