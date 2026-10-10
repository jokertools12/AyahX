"""Partial proofs preserve unknowns and keep position gates separate."""
import unittest

from prove_qud_packet_positions_partial import partial_sample, packet_capacity
from test_prove_qud_packet_positions import fixture


def large_fixture(first=7):
    """Same exact clock as the controls, with the production fixed byte trim."""
    _, _, source_probe, clip_probe = fixture()
    blocks = [bytes([index + 1]) * 512 for index in range(30)]
    for probe in (source_probe, clip_probe):
        for index, packet in enumerate(probe['packets']):
            packet.update(pos=str(index * 512), size='512')
    return b''.join(blocks), b''.join(blocks[first:first + 15]), source_probe, clip_probe


def sample(offset, first=7):
    return {'encoded_identity': {'proven': True, 'source_byte_position': first * 512 + 1024},
            'source_offset_ms': offset, 'envelope': {'best_lag_ms': -5}}


class PartialPacketTest(unittest.TestCase):
    def test_noncontiguous_match_stays_unproven(self):
        self.assertEqual(partial_sample(b'', b'', {}, {}, {'encoded_identity': {'proven': False}}),
                         {'packet_mapping_proven': False, 'reason': 'NO_RETAINED_CONTIGUOUS_INTERIOR_MATCH'})

    def test_capacity_is_metadata_not_pcm(self):
        _, _, source, _ = fixture()
        capacity = packet_capacity(source)
        self.assertEqual(capacity['packet_native_sample_capacity'], 595)
        self.assertFalse(capacity['actual_pcm_decoding_performed'])

    def test_exact_mapping_cannot_accept_wrong_declared_offset(self):
        proof = partial_sample(*large_fixture(), sample(1000))
        self.assertTrue(proof['packet_mapping_proven'])
        self.assertEqual(proof['decoded_packet_lag_ms']['value'], -865)
        self.assertFalse(proof['decoded_packet_lag_within_30ms'])
        self.assertFalse(proof['v2_accepted'])
        self.assertFalse(proof['native_pcm_identity_measured_here'])

    def test_priming_before_source_zero_is_explicit(self):
        proof = partial_sample(*large_fixture(0), sample(0, 0))
        self.assertEqual(proof['native_packet_source_sample_start'], -5)
        self.assertTrue(proof['window_precedes_source_pcm_origin'])
        self.assertFalse(proof['full_window_fits_packet_sample_capacity'])

    def test_tail_discard_capacity_does_not_invent_decoded_coverage(self):
        source, clip, source_probe, clip_probe = large_fixture(15)
        source_probe['packets'][-1]['side_data_list'] = [
            {'side_data_type': 'Skip Samples', 'discard_padding': 10}]
        proof = partial_sample(source, clip, source_probe, clip_probe, sample(300, 15))
        self.assertEqual(proof['source_capacity']['packet_native_sample_capacity'], 585)
        self.assertTrue(proof['window_exceeds_packet_sample_capacity'])
        self.assertFalse(proof['full_window_fits_packet_sample_capacity'])
        self.assertFalse(proof['source_capacity']['actual_pcm_decoding_performed'])


if __name__ == '__main__':
    unittest.main()
