# AyahX alignment worker

This directory contains the explicit `internal_ctc` adapter used by the Node
alignment service. It is intentionally fail-closed:

- every request has a contiguous Quran reference snapshot and a SHA-256 audio
  identity;
- the worker streams/reads the source and compares its bytes with that hash;
- every returned word must carry a canonical `surah:ayah:word` key, an explicit
  interval, complete coverage, and monotonic non-overlapping boundaries;
- no duration/WPM/proportional fallback exists;
- without `ALIGNMENT_ENGINE_MODULE`, `ALIGNMENT_ENGINE_COMMAND`, or
  `ALIGNMENT_CTC_MODEL_ID`, `/health/ready` and `/v1/align` return
  `MODEL_NOT_CONFIGURED`.

## Local contract checks

The base project intentionally does not install Python into the Node
workspace. In a Python environment:

```bash
pip install -r requirements-dev.txt
pytest -q test_worker.py
```

## CPU control image

```bash
docker build -t ayahx-alignment-worker services/alignment-worker
docker run --rm -p 8080:8080 \
  -e ALIGNMENT_WORKER_SHARED_TOKEN=replace-with-a-long-random-token \
  ayahx-alignment-worker
```

This image is a contract/control image. It does not download model weights and
will correctly report `MODEL_NOT_CONFIGURED` until a real engine is attached.

## GPU/model image

Install optional CTC dependencies only in a dedicated GPU deployment:

```bash
docker build --build-arg INSTALL_CTC=1 -t ayahx-alignment-worker-ctc services/alignment-worker
```

Set `ALIGNMENT_CTC_MODEL_ID` and pin `ALIGNMENT_CTC_MODEL_REVISION` to an
approved checkpoint. Record the checkpoint digest in the dataset/evaluation
report before enabling it in production. The model output remains
`providerVerified=false`; a human review or separately attested dataset is
still required for word animation.

## Engine adapters

`ALIGNMENT_ENGINE_MODULE=package.module:function` loads a Python callable that
accepts `(AlignmentRequest, audio_path=...)` or `(AlignmentRequest)`. A command
adapter receives canonical JSON on stdin and must return a JSON
`AlignmentResult` on stdout. Neither adapter is allowed to return partial
coverage. `ALIGNMENT_WORKER_SHARED_TOKEN` is mandatory in production.

`modal_app.py` is an optional Modal GPU host for the same `/v1/align` contract;
it is not required by the Node API and should be deployed only after model,
license, and dataset approvals.

## Dataset governance

`dataset_tools.py` validates JSONL records, rejects unapproved/licence-less
audio and unreviewed transcriptions, and prevents reciter/audio leakage across
deterministic train/validation/test splits. CTC training uses the reviewed Quran
transcript and does not require hand-labeled timing spans. Boundary evaluation
is stricter: only the held-out test split is scored, and every reference needs
complete `wordTimingReviewed: true` spans. Missing or extra prediction records
and missing words count against the coverage/pass gate. Reports include overall
and by-mode/by-reciter coverage and boundary MAE/P50/P95. These training and
evaluation tools do not fetch or redistribute research audio.

### QuranLab timing candidates (metadata only)

`quranlab_catalog.py` can stream one per-recitation config from the pinned
`quranlab/quran-audio` revision and export a candidate bundle:

```bash
pip install datasets
python quranlab_catalog.py husary candidates.json
```

It reads only the CC-BY-4.0 timing/config table; the repository contains audio
references, not audio bytes. Each output is explicitly `needs_review`, has no
audio hash, and sets `providerVerified`, `renderEligible`, and
`trainingEligible` to false. It rejects moving revisions, non-Hafs rows,
non-EveryAyah hosts, malformed intervals, and incomplete word positions. This
does **not** make the candidates production timings: a separate server-side
byte-identity match against the exact selected clip, duration/offset checks,
and human review are still required. Do not use this export as training audio
or as permission to fetch/redistribute the referenced recordings.

### Quranic Universal Audio v3.2.0 word and letter-paint candidates (metadata only)

`qua_release_catalog.py` exports selected Hafs word timelines and, when present,
the release's letter-paint events from the pinned Quranic Universal Audio
release. Download only `manifest.json`, `catalog.json`, and the chosen
recitation ZIP from the [v3.2.0 release]; this importer never fetches linked
recitation audio. For example:

```bash
python qua_release_catalog.py \
  mahmoud_khalil_al_husary_qdc_128k \
  data/mahmoud_khalil_al_husary_qdc_128k.zip \
  data/husary-candidates.json.gz \
  --manifest data/manifest.json \
  --catalog data/catalog.json
```

The tool verifies pinned SHA-256 digests for the release manifest/catalog and
the selected ZIP, then checks the archive's script projection and timeline
schema. Letter-tier rows become candidate `letterTiming` events that preserve
the source text, Unicode-scalar paint ranges, zero-based word-occurrence
references, `ownsSound` flags, and millisecond spans. These are not phoneme
boundaries or timestamps for every character, and are not yet consumed by the
AyahX renderer. A `.json.gz` output path writes a compact compressed bundle,
which is recommended for full-recitation imports. It exports CC-BY-4.0 attribution, but every result remains
`needs_review`: audio hash and duration are empty, upstream recording rights
are uncleared, and `providerVerified`, `renderEligible`, and `trainingEligible`
are all false. Exact audio binding, exact script/font mapping, renderer parity,
and human review are required before word- or letter-synchronous rendering.
Repeated source word indexes are preserved as separate audio occurrences (with
a source index and an occurrence index); the importer reports them instead of
flattening a repeated recitation into a single event.

[v3.2.0 release]: https://github.com/QUD-Technologies/quranic-universal-audio/releases/tag/v3.2.0

Each source row's `provenance` must include a stable `sourceId`, the applicable
`license`, `usageApproved: true`, and `transcriptionReviewed: true`. Rows with
timing labels additionally require `wordTimingReviewed: true`. Keep local audio
paths only in the private approved manifest; the trainer re-hashes each file
before reading it.
