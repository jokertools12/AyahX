# AyahX exact alignment and Animate decision

## Decision

AyahX owns the render contract and the trust boundary. A provider may supply
word/letter/phoneme intervals, but no provider is allowed to turn a verse
duration, WPM value, character count, or token shape into a guessed word
boundary. The render harness consumes only explicit intervals and only an
approved map can drive word-level Animate profiles.

The production path is:

```text
browser audio selection
        |
        v
authenticated Node alignment route
        |
        +-- quran_foundation: server OAuth fetch -> strict coverage -> streamed SHA-256
        +-- internal_ctc: signed request -> FastAPI/Modal worker -> exact result -> review
        +-- verified_dataset: explicit attestation and provenance
        +-- manual: immutable review revision
        +-- QUA/Lafzize: opt-in external adapter, legal/provider review required
        v
immutable AlignmentDocument + user-bound HMAC attestation
        v
RenderManifest -> shared render-harness -> FFmpeg / Skia / Browser Cloud
```

The HMAC is not a substitute for validation. It binds the user, map id, audio
hash, provider, and every timing interval, so a browser cannot edit an
approved map and still request a word animation. Unreviewed maps remain useful
for static scripture and human review, but are never presented as exact
word-by-word synchronization.

## Provider policy

| Provider | Role in AyahX | Trust / release gate |
| --- | --- | --- |
| `quran_foundation` | First-party word segments for supported QF recitations | Server OAuth, complete contiguous coverage, allowlisted audio, streamed SHA-256; no browser timestamps or fallback |
| `internal_ctc` | Our trainable adapter for reciter/mode coverage | Exact audio hash, complete canonical words, monotonic spans, then human review; worker returns `MODEL_NOT_CONFIGURED` without real weights |
| `verified_dataset` | Import of a separately audited corpus | Dataset attestation, license/provenance record, deterministic split and evaluation report |
| `manual` | Human correction/review | Immutable child document linked to its parent and reviewer event |
| `quranic_universal_aligner` | Optional research adapter | Explicit endpoint, explicit provider choice, review required; no fallback |
| `lafzize` | Optional adapter only after legal review | `LAFZIZE_LICENSE_REVIEW_APPROVED=true` plus explicit endpoint; otherwise disabled |

The research links supplied for the study remain evidence for adapter design,
not an implicit production data source:

- [Quranic Universal Aligner Space](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner)
- [Quranic Universal Audio](https://huggingface.co/spaces/hetchyy/quranic-universal-audio)
- [QuranLab Quran Audio word-timing catalog](https://huggingface.co/datasets/quranlab/quran-audio)
- [QuranReciteToText releases](https://github.com/Iam-Muslim/QuranReciteToText/releases)
- [lafzize](https://sr.ht/~rehandaphedar/lafzize/)
- [quran-align](https://github.com/cpfair/quran-align)

Before importing any external checkpoint/audio, record its license, source
revision, audio hash, Quran edition/riwayah, and a human approval in the
dataset manifest. A URL being reachable is not evidence that redistribution or
training is permitted.

The QuranLab catalog is an annotation-only source for selected EveryAyah
per-ayah clips: its card documents CC-BY-4.0 timings for 44 of 47 recordings,
while linked audio remains under its upstream terms. Treat the intervals as
automatic alignment, not human gold. The current candidate exporter pins
revision `55d48a9cfc9dec3836efc9b0f8631c4ff6399c28`, records attribution, and
never downloads audio. It is intentionally disconnected from production
alignment: candidates lack audio hashes and are not render-eligible. The
EveryAyah byte-identity matcher, multi-ayah duration/offset composer, and
reviewed catalog provider are not implemented yet. Keep `verified_dataset`
disabled; its generic environment attestation is only a guard, not evidence
that an external row matches the selected audio. The QuranLab timing catalog is
not a licensed Quran audio training corpus.

## Animate profiles

`static`, `karaoke`, `teleprompter`, `reveal`, `fade`, `spotlight`, `isolate`,
and `consume` are deterministic presentation profiles. They do not alter the
audio or invent timings. The same `render-harness.html` scene is used by live
preview and all export engines; `animationReducedMotion` removes pulse/scale
while preserving the exact event clock.

The current profile clock is word-occurrence based. Letter-level timing is not
yet a supported render tier. In particular, QUA's letter data is a set of
script-specific paint ranges over DigitalKhatt Unicode scalars, not ordinary
per-character timestamps; it needs a dedicated renderer mapping and font/text
parity tests before AyahX may advertise letter-synchronous animation.

If the map is not approved, the harness forcibly selects a full-ayah static
view. The UI may still show the chosen profile as a design preference, but it
cannot imply exact synchronization until the evidence gate passes.

## Worker deployment

The small FastAPI image is suitable for a CPU control service on Railway or
FastAPI Cloud. It does not download model weights. A GPU image is built with
`--build-arg INSTALL_CTC=1`, or the same app can be hosted by
`services/alignment-worker/modal_app.py` on Modal after model and license
approval. Railway remains the Node API/render orchestration plane; it is not a
place to hide unreviewed model weights or credentials in the browser.

Required production secrets are server-side only:

```text
ALIGNMENT_ATTESTATION_SECRET
ALIGNMENT_WORKER_SHARED_TOKEN
ALIGNMENT_INTERNAL_CTC_TOKEN
QF_CLIENT_ID / QF_CLIENT_SECRET (or the environment-specific QF settings)
```

The worker endpoint is `POST /v1/align`; the Node adapter sends the canonical
request and expects `{ "result": AlignmentResult }`. Health is split into
`/health/live` and `/health/ready`. Readiness is intentionally false until
authentication and a real engine are configured.

## Dataset/training gate

`services/alignment-worker/dataset_tools.py` validates JSONL records and
produces deterministic train/validation/test manifests grouped by reciter and
audio hash. Training rows require cleared audio usage and a reviewed Quran
transcription; manually reviewed word spans are not needed for CTC training.
Boundary evaluation has the stricter requirement of complete, separately
reviewed gold word spans. It evaluates only the held-out test split and counts
missing or unexpected predictions against coverage. Training is not considered
production-ready until the held-out report and checkpoint digest are recorded
and a reviewer approves the result.

The opt-in GPU job is `services/alignment-worker/train_ctc.py`. It balances the
curated `murattal`, `mujawwad`, `tarteel`, and `tajweed` modes in the training
split and refuses to start when a required mode is absent:

```bash
python services/alignment-worker/dataset_tools.py prepare approved.jsonl dataset-manifest.json
python services/alignment-worker/train_ctc.py dataset-manifest.json checkpoints/ayahx-ctc \
  --model-id <approved-arabic-ctc-model> --revision <pinned-revision>
```

The command requires local audio paths and re-checks every file hash before
training. It does not download or redistribute the research corpora.

## Verification checklist

1. `npm run build` and the focused Vitest suite pass.
2. Python contract tests pass with `pytest -q services/alignment-worker/test_worker.py`.
3. The CPU worker returns `MODEL_NOT_CONFIGURED` when no model is configured;
   it never emits placeholder timings.
4. A QF integration run uses real OAuth credentials, confirms complete word
   coverage, records the streamed audio hash, and renders an actual MP4.
5. Each render engine is checked against the same scene and audio duration;
   Railway readiness/logs and a non-zero output artifact are inspected before
   publication.
