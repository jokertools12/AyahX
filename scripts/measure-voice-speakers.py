"""Local ECAPA measurement of retained B sources. No audio fetch or deletion."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import itertools
import json
from pathlib import Path
import subprocess
import time

import numpy as np
from lib.voice_auto_verification import calibrated_threshold, sha256

MODEL_ID = 'speechbrain/spkrec-ecapa-voxceleb'
MODEL_REVISION = '0f99f2d0ebe89ac095bcc5903c4dd8f72b367286'


def private(path):
    path = Path(path).resolve()
    if any((parent / '.git').exists() for parent in [path, *path.parents]):
        raise ValueError('MODEL_AND_MEASUREMENT_OUTPUT_MUST_BE_PRIVATE')
    path.mkdir(parents=True, exist_ok=True)
    return path


def file_sha(path):
    import hashlib
    result = hashlib.sha256()
    with path.open('rb') as handle:
        while data := handle.read(1024 * 1024):
            result.update(data)
    return result.hexdigest()


def run(args):
    started = time.monotonic()
    private(args.model_dir)
    private(Path(args.out).parent)
    import torch
    from huggingface_hub import snapshot_download
    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy
    from hyperpyyaml import load_hyperpyyaml
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    snapshot = snapshot_download(MODEL_ID, revision=MODEL_REVISION, cache_dir=args.model_dir,
                                 allow_patterns=['*.ckpt', 'hyperparams.yaml', 'label_encoder.txt'])
    # SpeechBrain1.0.3's from_hparams catches ValueError for a missing optional
    # custom.py but local files raise FileNotFoundError. This official model
    # needs no custom.py. Follow its documented loader steps explicitly, and
    # point every checkpoint to the already downloaded pinned snapshot.
    with (Path(snapshot) / 'hyperparams.yaml').open(encoding='utf-8') as handle:
        parameters = load_hyperpyyaml(handle, {'pretrained_path': Path(snapshot).as_posix()})
    parameters['pretrainer'].set_collect_in(str(Path(args.model_dir) / 'loaded'))
    parameters['pretrainer'].collect_files(default_source=snapshot, local_strategy=LocalStrategy.COPY)
    parameters['pretrainer'].load_collected()
    classifier = EncoderClassifier(parameters['modules'], parameters, run_opts={'device': 'cpu'})
    raw_bytes = Path(args.retained_evidence).read_bytes()
    raw = json.loads(raw_bytes)
    quality_bytes = Path(args.identity).read_bytes()
    quality = json.loads(quality_bytes)['duration_quality_comparison']['measurements']
    vectors, measurements, unavailable = {}, [], []
    for index, row in enumerate(sorted(quality, key=lambda value: (value['slug'], value['surah']))):
        if time.monotonic() - started > 3 * 3600:
            raise TimeoutError('LOCAL_SPEAKER_THREE_HOUR_LIMIT')
        slug, chapter = row['slug'], row['surah']
        source = Path(raw['results'][slug]['scratch_dir']) / row['source_file_name']
        if file_sha(source) != row['actual_source_sha256']:
            raise ValueError('RETAINED_AUDIO_CONTENT_SHA256_MISMATCH')
        # Decode a fixed 25s interior at 10s. Output is RAM, not a new audio file.
        decoded = subprocess.run([args.ffmpeg, '-v', 'error', '-protocol_whitelist', 'file,pipe',
                                  '-ss', '10', '-i', str(source), '-t', '25', '-f', 'f32le',
                                  '-ac', '1', '-ar', '16000', 'pipe:1'], capture_output=True, timeout=90)
        if decoded.returncode:
            unavailable.append({'slug': slug, 'surah': chapter, 'reason': 'LOCAL_AUDIO_DECODE_FAILED'})
            continue
        pcm = np.frombuffer(decoded.stdout, dtype='<f4').copy()
        if len(pcm) < 16000 * 5 or not np.all(np.isfinite(pcm)) or np.linalg.norm(pcm) < 1e-8:
            unavailable.append({'slug': slug, 'surah': chapter, 'reason': 'INSUFFICIENT_NON_SILENT_SAMPLE'})
            continue
        with torch.no_grad():
            vector = classifier.encode_batch(torch.from_numpy(pcm).unsqueeze(0)).squeeze().cpu().numpy().astype(float)
        vector /= np.linalg.norm(vector)
        key = (slug, chapter)
        vectors[key] = vector
        measurements.append({'slug': slug, 'reciter_id': row['reciter_id'], 'surah': chapter,
                             'source_sha256': row['actual_source_sha256'], 'decoded_pcm_sha256': sha256(decoded.stdout),
                             'start_ms': 10000, 'duration_ms': len(pcm) * 1000 / 16000,
                             'embedding_sha256': sha256(vector.astype('<f8').tobytes())})
        print(json.dumps({'speaker_measurement': index + 1, 'expected': len(quality), 'slug': slug, 'surah': chapter}), flush=True)
    by_slug, by_reader = defaultdict(list), defaultdict(list)
    for row in measurements:
        by_slug[row['slug']].append(row)
        by_reader[row['reciter_id']].append(row)
    # Deterministic reader split is fixed before examining pair scores. No
    # threshold is accepted if classes overlap or held-out pairs misclassify.
    readers = sorted(by_reader)
    calibration_readers = set(readers[::2])
    pairs = []
    for left, right in itertools.combinations(measurements, 2):
        same = left['reciter_id'] == right['reciter_id']
        if not same and left['surah'] != right['surah']:
            continue
        if same and left['slug'] != right['slug'] and left['surah'] != right['surah']:
            continue
        if same and left['slug'] == right['slug'] and left['surah'] == right['surah']:
            continue
        score = float(np.dot(vectors[left['slug'], left['surah']], vectors[right['slug'], right['surah']]))
        cohort = ('calibration' if left['reciter_id'] in calibration_readers and right['reciter_id'] in calibration_readers
                  else 'validation' if left['reciter_id'] not in calibration_readers and right['reciter_id'] not in calibration_readers else 'cross_split')
        pairs.append({'left_slug': left['slug'], 'left_surah': left['surah'], 'right_slug': right['slug'],
                      'right_surah': right['surah'], 'same_catalog_reader': same, 'cosine_raw': score, 'cohort': cohort})
    calibration = calibrated_threshold([r['cosine_raw'] for r in pairs if r['cohort'] == 'calibration' and r['same_catalog_reader']],
                                       [r['cosine_raw'] for r in pairs if r['cohort'] == 'calibration' and not r['same_catalog_reader']])
    if calibration['accepted']:
        threshold = calibration['threshold']
        validation = [r for r in pairs if r['cohort'] == 'validation']
        errors = [r for r in validation if (r['cosine_raw'] >= threshold) != r['same_catalog_reader']]
        calibration.update(validation_pairs=len(validation), validation_errors=len(errors))
        if errors or not any(r['same_catalog_reader'] for r in validation) or not any(not r['same_catalog_reader'] for r in validation):
            calibration.update(accepted=False, reason='HELD_OUT_CALIBRATION_NOT_SEPARATED')
    results = {}
    expected_by_reader = defaultdict(set)
    for row in json.loads(quality_bytes)['folder_checks']:
        expected_by_reader[row['reciter_id']].add(row['slug'])
    for slug, rows in by_slug.items():
        within = [r for r in pairs if r['left_slug'] == slug and r['right_slug'] == slug]
        reader = rows[0]['reciter_id']
        sibling_slugs = expected_by_reader[reader] - {slug}
        measured_siblings = {r['slug'] for r in by_reader[reader] if r['slug'] != slug}
        between = [r for r in pairs if slug in (r['left_slug'], r['right_slug'])
                   and r['left_slug'] != r['right_slug'] and r['same_catalog_reader']]
        def check(selected, coverage):
            passed = calibration['accepted'] and coverage and bool(selected) and all(r['cosine_raw'] >= calibration['threshold'] for r in selected)
            return {'passed': bool(passed), 'status': 'passed' if passed else 'unverified', 'pairs': selected,
                    'coverage_complete': coverage, 'reason': None if passed else calibration.get('reason', 'SPEAKER_COVERAGE_OR_CONSISTENCY_FAILED')}
        results[slug] = {'V3': check(within, len({r['surah'] for r in rows}) >= 3),
                         'V4': check(between, sibling_slugs == measured_siblings) if sibling_slugs else {'status': 'not_applicable'}}
    return {'schema_version': 1, 'checked_at': datetime.now(timezone.utc).isoformat(), 'model_loaded': True,
            'model': {'id': MODEL_ID, 'revision': MODEL_REVISION, 'speechbrain': '1.0.3', 'torch': '2.5.1', 'torchaudio': '2.5.1', 'device': 'cpu'},
            'input_sha256': {'retained_evidence': sha256(raw_bytes), 'identity': sha256(quality_bytes)},
            'model_files_sha256': {path.name: file_sha(path) for path in Path(snapshot).glob('*') if path.is_file()},
            'protocol': {'selection': 'all retained B source files, fixed start10000ms/duration25000ms; no reselection',
                         'calibration_split': 'sorted known catalog reader IDs, alternating IDs before scores',
                         'identity_limit': 'Catalog name labels are provisional; consistency is not proof of named identity.',
                         'audio_network_requests': 0, 'audio_files_created': 0, 'audio_files_deleted': 0, 'database_writes': 0},
            'elapsed_seconds': time.monotonic() - started, 'calibration': calibration, 'measurements': measurements,
            'unavailable': unavailable, 'pairs': pairs, 'results': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('identity', 'retained-evidence', 'ffmpeg', 'model-dir', 'out'):
        parser.add_argument('--' + field, required=True)
    args = parser.parse_args()
    report = run(args)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'model_loaded': report['model_loaded'], 'measurements': len(report['measurements']), 'calibration': report['calibration']}))


if __name__ == '__main__':
    main()
