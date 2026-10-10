"""Local MP3 packet-position diagnosis; never changes offset acceptance.

ffprobe reads each complete local file from its beginning. Its MP3 PTS are
frame-count clocks, not embedded recording wall clocks. Exact integer PTS and
time_base are retained and converted to milliseconds as rational numbers.
No network, deletion, seek, offset correction, or runtime import is performed.
"""
import argparse
from bisect import bisect_right
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess


def sha(value):
    return hashlib.sha256(value).hexdigest()


def milliseconds(value):
    value *= 1000
    return {'numerator': value.numerator, 'denominator': value.denominator,
            'value': float(value)}


def packet_clock(packet, stream):
    if 'pts' not in packet or 'time_base' not in stream:
        raise ValueError('PACKET_PTS_AND_TIME_BASE_REQUIRED')
    return Fraction(packet['pts']) * Fraction(stream['time_base'])


def containing_packet(packets, position):
    positions = [int(packet['pos']) for packet in packets]
    index = bisect_right(positions, position) - 1
    if index < 0 or position >= positions[index] + int(packets[index]['size']):
        raise ValueError('BYTE_POSITION_OUTSIDE_PACKET')
    return index, packets[index]


def validate_packet_clock(packets, stream):
    """Reject missing/non-contiguous timestamps instead of estimating PTS."""
    if not packets or stream.get('codec_name') != 'mp3':
        raise ValueError('MP3_PACKETS_REQUIRED')
    for left, right in zip(packets, packets[1:]):
        if (int(left['pos']) + int(left['size']) != int(right['pos'])
                or left['pts'] + left['duration'] != right['pts']):
            raise ValueError('NONCONTIGUOUS_MP3_BYTE_OR_PTS_CLOCK')
    first_skip = sum(item.get('skip_samples', 0)
                     for item in packets[0].get('side_data_list', [])
                     if item.get('side_data_type') == 'Skip Samples')
    start = Fraction(stream['start_pts']) * Fraction(stream['time_base'])
    first = packet_clock(packets[0], stream)
    if start - first != Fraction(first_skip, int(stream['sample_rate'])):
        raise ValueError('STREAM_START_AND_SKIP_SAMPLES_DISAGREE')
    return {'packet_count': len(packets), 'first_packet': packets[0],
            'last_packet': packets[-1], 'stream': stream,
            'first_packet_skip_samples': first_skip,
            'generated_frame_clock_contiguous_from_file_start': True}


def prove_pair(source_bytes, clip_bytes, source_probe, clip_probe,
               declared_offset_ms, reported_source_position, trim=1024):
    """Tie a unique contiguous interior to its packet position, not anywhere.

    Each complete interior packet is byte-identical and has one constant
    source-minus-clip PTS. Five fixed byte landmarks must lie inside equal
    packets at equal intra-packet positions. Byte positions are never linearly
    interpolated into timestamps. The packet is the timing precision bound.
    """
    if len(clip_bytes) < trim * 2 + 1:
        raise ValueError('EMPTY_ENCODED_INTERIOR')
    interior = clip_bytes[trim:-trim]
    position = source_bytes.find(interior)
    if position < 0 or source_bytes.find(interior, position + 1) >= 0:
        raise ValueError('UNIQUE_CONTIGUOUS_INTERIOR_REQUIRED')
    if position != reported_source_position:
        raise ValueError('DIAGNOSIS_SOURCE_BYTE_POSITION_MISMATCH')
    source_origin = position - trim
    source_packets, clip_packets = source_probe['packets'], clip_probe['packets']
    source_stream, clip_stream = source_probe['streams'][0], clip_probe['streams'][0]
    validate_packet_clock(source_packets, source_stream)
    validate_packet_clock(clip_packets, clip_stream)
    if (source_stream['sample_rate'], source_stream['channels']) != (
            clip_stream['sample_rate'], clip_stream['channels']):
        raise ValueError('SAMPLE_RATE_OR_CHANNELS_DIFFER')
    source_positions = {int(p['pos']): (i, p) for i, p in enumerate(source_packets)}
    fixed = [trim, trim + len(interior) // 4, trim + len(interior) // 2,
             trim + len(interior) * 3 // 4, len(clip_bytes) - trim - 1]
    landmarks, shifts = [], set()
    for clip_position in fixed:
        ci, cp = containing_packet(clip_packets, clip_position)
        si, sp = containing_packet(source_packets, source_origin + clip_position)
        if (clip_position - int(cp['pos']) != source_origin + clip_position - int(sp['pos'])
                or cp['size'] != sp['size']
                or clip_bytes[int(cp['pos']):int(cp['pos']) + int(cp['size'])]
                != source_bytes[int(sp['pos']):int(sp['pos']) + int(sp['size'])]):
            raise ValueError('FIXED_LANDMARK_PACKET_BYTES_OR_POSITION_DIFFER')
        shift = packet_clock(sp, source_stream) - packet_clock(cp, clip_stream)
        shifts.add(shift)
        landmarks.append({'clip_byte_position': clip_position,
                          'source_byte_position': source_origin + clip_position,
                          'source_packet_index': si, 'clip_packet_index': ci,
                          'source_packet': sp, 'clip_packet': cp,
                          'intra_packet_byte_position': clip_position - int(cp['pos']),
                          'source_packet_start_ms': milliseconds(packet_clock(sp, source_stream)),
                          'source_packet_end_ms': milliseconds(packet_clock(sp, source_stream)
                                                               + Fraction(sp['duration']) * Fraction(source_stream['time_base'])),
                          'packet_shift_ms': milliseconds(shift)})
    count = 0
    for cp in clip_packets:
        start, size = int(cp['pos']), int(cp['size'])
        if start < trim or start + size > len(clip_bytes) - trim:
            continue
        match = source_positions.get(source_origin + start)
        if match is None:
            raise ValueError('INTERIOR_PACKET_BOUNDARY_ABSENT_IN_SOURCE')
        _, sp = match
        if int(sp['size']) != size or source_bytes[source_origin + start:source_origin + start + size] != clip_bytes[start:start + size]:
            raise ValueError('INTERIOR_PACKET_PAYLOAD_DIFFER')
        shifts.add(packet_clock(sp, source_stream) - packet_clock(cp, clip_stream))
        count += 1
    if len(shifts) != 1 or not count:
        raise ValueError('INTERIOR_PACKET_PTS_SHIFT_NOT_CONSTANT')
    shift = shifts.pop()
    source_start = Fraction(source_stream['start_pts']) * Fraction(source_stream['time_base'])
    clip_start = Fraction(clip_stream['start_pts']) * Fraction(clip_stream['time_base'])
    decoded_start = shift - source_start + clip_start
    first_index, first_packet = containing_packet(source_packets, source_origin + int(clip_packets[0]['pos']))
    return {'proven': True, 'method': 'unique_contiguous_copy_with_fixed_landmarks_and_all_complete_interior_packet_clocks',
            'source_byte_origin_for_clip_byte_zero': source_origin,
            'encoded_interior_bytes': len(interior), 'complete_interior_packets_checked': count,
            'fixed_landmarks': landmarks, 'first_source_packet_index': first_index,
            'first_source_packet': first_packet, 'first_clip_packet': clip_packets[0],
            'encoded_frame_start_ms': milliseconds(shift),
            'encoded_frame_start_minus_declared_offset_ms': milliseconds(shift - Fraction(declared_offset_ms, 1000)),
            'source_decoded_pcm_coordinate_of_clip_decoded_zero_ms': milliseconds(decoded_start),
            'decoded_coordinate_minus_declared_offset_ms': milliseconds(decoded_start - Fraction(declared_offset_ms, 1000)),
            'packet_precision_bound_ms': milliseconds(Fraction(first_packet['duration']) * Fraction(source_stream['time_base'])),
            'source_start_pts': source_stream['start_pts'], 'clip_start_pts': clip_stream['start_pts'],
            'source_time_base': source_stream['time_base'], 'clip_time_base': clip_stream['time_base'],
            'decoded_coordinate_can_precede_source_pcm_zero': decoded_start < 0,
            'changes_acceptance': False}


def probe(ffprobe, audio, private_directory, label):
    path = private_directory / f'{label}.packets.json'
    command = [str(ffprobe), '-v', 'error', '-select_streams', 'a:0', '-show_packets',
               '-show_streams', '-show_entries',
               'packet=pts,dts,duration,pos,size,side_data_list:stream=index,codec_name,sample_rate,channels,time_base,start_pts,start_time,duration_ts,duration',
               '-of', 'json=compact=1', str(audio)]
    with path.open('wb') as output:
        process = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, timeout=180)
    if process.returncode:
        raise ValueError('FFPROBE_LOCAL_FILE_FAILED')
    value = json.loads(path.read_text(encoding='utf-8'))
    if len(value.get('streams', [])) != 1:
        raise ValueError('ONE_AUDIO_STREAM_REQUIRED')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['diagnosis', 'scratch', 'ffprobe', 'private-directory', 'report', 'config']:
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    diagnosis_path, scratch = Path(args.diagnosis), Path(args.scratch)
    before = diagnosis_path.read_bytes()
    diagnosis = json.loads(before)['results'][args.config]
    private_directory = Path(args.private_directory)
    private_directory.mkdir(parents=True, exist_ok=True)
    results, sources = [], {}
    for chapter in sorted({sample['surah'] for sample in diagnosis['samples']}):
        path = scratch / f'{chapter}.audio'
        source_bytes = path.read_bytes()
        expected = diagnosis['source_sha256'][str(chapter)]
        if sha(source_bytes) != expected:
            raise ValueError('SOURCE_SHA_MISMATCH')
        source_probe = probe(args.ffprobe, path, private_directory, f'source-{chapter}')
        sources[str(chapter)] = {'sha256': expected, **validate_packet_clock(source_probe['packets'], source_probe['streams'][0])}
        for sample in [s for s in diagnosis['samples'] if s['surah'] == chapter]:
            clip = scratch / f"clip-{chapter}-{sample['ayah']}.mp3"
            clip_bytes = clip.read_bytes()
            if sha(clip_bytes) != sample['hf_audio_sha256']:
                raise ValueError('CLIP_SHA_MISMATCH')
            clip_probe = probe(args.ffprobe, clip, private_directory, f"clip-{chapter}-{sample['ayah']}")
            proof = prove_pair(source_bytes, clip_bytes, source_probe, clip_probe,
                               sample['source_offset_ms'], sample['encoded_identity']['source_byte_position'])
            results.append({'surah': chapter, 'ayah': sample['ayah'],
                            'source_offset_ms': sample['source_offset_ms'],
                            'hf_duration_ms': sample['hf_duration_ms'], 'hf_audio_sha256': sample['hf_audio_sha256'],
                            'clip_stream': clip_probe['streams'][0],
                            'clip_first_packet_skip_samples': validate_packet_clock(clip_probe['packets'], clip_probe['streams'][0])['first_packet_skip_samples'],
                            'retained_envelope_lag_ms': sample['envelope']['best_lag_ms'],
                            'retained_interior_pcm_score': sample['interior_pcm']['score'],
                            'retained_v1_passed': sample['v1_original']['passed'],
                            'packet_proof': proof})
        if sha(path.read_bytes()) != expected:
            raise ValueError('SOURCE_CHANGED_DURING_DIAGNOSIS')
    if diagnosis_path.read_bytes() != before:
        raise ValueError('DIAGNOSIS_CHANGED_DURING_ANALYSIS')
    report = {'schema_version': 1, 'checked_at': datetime.now(timezone.utc).isoformat(),
              'read_only': True, 'config': args.config, 'diagnosis_sha256': sha(before),
              'ffprobe_version': subprocess.check_output([args.ffprobe, '-version']).decode().splitlines()[0],
              'analyzer_sha256': sha(Path(__file__).read_bytes()), 'sources': sources, 'samples': results,
              'packet_mapping_proven_samples': len(results), 'all_input_hashes_unchanged': True,
              'v1_results_replaced': False, 'v2_accepted': False, 'publication_changed': False,
              'limitations': ['MP3 PTS is a demuxer-generated frame-count clock, not stored wall-clock timestamps.',
                              'Packet timing establishes encoded position and skip-sample convention; it does not alone prove the cause of a low PCM correlation.',
                              'No frame-boundary correction or resampling-phase change is applied to runtime or acceptance.',
                              'Only this retained recitation and these 15 samples were measured.'],
              'manual_cleanup_required': True, 'private_outputs': '%TEMP%\\ayahx-b-packet-proof',
              'deletion_or_move_attempted': False}
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'samples_proven': len(results), 'report': Path(args.report).name,
                      'v2_accepted': False, 'hashes_unchanged': True}))


if __name__ == '__main__':
    main()
