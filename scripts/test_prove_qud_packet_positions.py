"""Meaningful false-position/missing-clock controls for the local analyzer."""
from copy import deepcopy
from fractions import Fraction
import unittest

from prove_qud_packet_positions import milliseconds, prove_pair, validate_packet_clock


def fixture():
    blocks = [bytes([index + 1]) * 32 for index in range(30)]
    source, clip = b''.join(blocks), b''.join(blocks[7:22])
    source_stream = {'codec_name': 'mp3', 'sample_rate': '1000', 'channels': 1,
                     'time_base': '1/1000', 'start_pts': 5}
    clip_stream = {**source_stream, 'start_pts': 0}
    def packets(count):
        return [{'pos': str(i * 32), 'size': '32', 'pts': i * 20, 'duration': 20}
                for i in range(count)]
    sp, cp = packets(30), packets(15)
    sp[0]['side_data_list'] = [{'side_data_type': 'Skip Samples', 'skip_samples': 5}]
    return source, clip, {'packets': sp, 'streams': [source_stream]}, {'packets': cp, 'streams': [clip_stream]}


class PacketPositionTest(unittest.TestCase):
    def test_exact_position_and_skip_are_preserved_without_rounding(self):
        args = fixture()
        proof = prove_pair(*args, 140, 7 * 32 + 32, trim=32)
        self.assertEqual(proof['encoded_frame_start_ms']['value'], 140)
        self.assertEqual(proof['source_decoded_pcm_coordinate_of_clip_decoded_zero_ms']['value'], 135)
        self.assertEqual(proof['decoded_coordinate_minus_declared_offset_ms']['value'], -5)
        self.assertEqual(proof['complete_interior_packets_checked'], 13)
        self.assertFalse(proof['changes_acceptance'])
        value = milliseconds(Fraction(1105, 44100))
        self.assertEqual(Fraction(value['numerator'], value['denominator']), Fraction(11050, 441))

    def test_bytes_somewhere_cannot_validate_wrong_reported_position(self):
        with self.assertRaisesRegex(ValueError, 'POSITION_MISMATCH'):
            prove_pair(*fixture(), 140, 8 * 32 + 32, trim=32)

    def test_byte_copy_with_discontinuous_pts_is_rejected(self):
        source, clip, sp, cp = fixture()
        sp = deepcopy(sp)
        sp['packets'][14]['pts'] += 1
        with self.assertRaisesRegex(ValueError, 'NONCONTIGUOUS'):
            prove_pair(source, clip, sp, cp, 140, 7 * 32 + 32, trim=32)

    def test_embedded_copy_in_wrong_file_does_not_inherit_known_offset(self):
        source, clip, sp, cp = fixture()
        proof = prove_pair(source, clip, sp, cp, 1000, 7 * 32 + 32, trim=32)
        self.assertEqual(proof['encoded_frame_start_minus_declared_offset_ms']['value'], -860)

    def test_unexplained_stream_start_or_skip_is_rejected(self):
        _, _, sp, _ = fixture()
        sp['streams'][0]['start_pts'] = 6
        with self.assertRaisesRegex(ValueError, 'SKIP_SAMPLES_DISAGREE'):
            validate_packet_clock(sp['packets'], sp['streams'][0])

    def test_missing_clock_fails_without_estimation(self):
        _, _, sp, _ = fixture()
        del sp['packets'][5]['pts']
        with self.assertRaises(KeyError):
            validate_packet_clock(sp['packets'], sp['streams'][0])


if __name__ == '__main__':
    unittest.main()
