"""Import pinned QuranLab word timings as *untrusted candidates*.

This tool reads only the dataset's tabular annotation/config rows. It does not
download audio, train a model, or produce render-eligible alignments. Every
candidate remains unbound to audio bytes until AyahX independently matches the
exact clip and a reviewer approves its boundaries.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit


DATASET_ID = "quranlab/quran-audio"
PINNED_REVISION = "55d48a9cfc9dec3836efc9b0f8631c4ff6399c28"
TIMING_LICENSE = "CC-BY-4.0"
ALLOWED_AUDIO_HOSTS = {"everyayah.com", "www.everyayah.com"}
QURANLAB_FORCED_TIMING_SOURCE = (
    "quranlab-forced-alignment (wav2vec2 Apache-2.0 + torchaudio)"
)


class QuranLabImportError(ValueError):
    """Raised when a source row cannot safely become an AyahX candidate."""


def _positive_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise QuranLabImportError(f"{field} must be a positive integer")
    return value


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise QuranLabImportError(f"{field} must be finite milliseconds")
    return float(value)


def _validated_audio_url(value: Any) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise QuranLabImportError("audio_url is required")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_AUDIO_HOSTS
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or parsed.query
        or parsed.fragment
    ):
        raise QuranLabImportError("audio_url must be a plain HTTPS EveryAyah URL")
    return value


def row_to_candidate(
    row: dict[str, Any],
    *,
    config: str,
    revision: str = PINNED_REVISION,
) -> dict[str, Any] | None:
    """Convert one pinned QuranLab row to an untrusted AyahX candidate.

    Untimed rows return ``None``. Timed rows from non-Hafs readings are
    rejected rather than joined against the Hafs Quran text by accident.
    """
    if revision != PINNED_REVISION:
        raise QuranLabImportError(
            f"unsupported dataset revision {revision!r}; expected the reviewed pinned revision"
        )
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", config):
        raise QuranLabImportError("config must be a lowercase QuranLab recitation id")
    if not isinstance(row, dict):
        raise QuranLabImportError("row must be an object")

    row_config = row.get("recitation_id")
    if row_config != config:
        raise QuranLabImportError("row recitation_id does not match the selected config")

    surah = _positive_int(row.get("surah"), "surah")
    ayah = _positive_int(row.get("ayah"), "ayah")
    verse_key = f"{surah}:{ayah}"
    if row.get("verse_key") != verse_key:
        raise QuranLabImportError("verse_key does not match surah and ayah")

    riwayah = row.get("riwayah")
    if riwayah != "hafs-asim":
        raise QuranLabImportError("only explicitly identified hafs-asim rows are supported")

    audio_url = _validated_audio_url(row.get("audio_url"))
    if row.get("has_word_timing") is not True:
        return None

    timing_source = row.get("timing_source")
    if timing_source == "cpfair/quran-align":
        attribution = "Collin Fair, cpfair/quran-align; catalogued by QuranLab"
    elif timing_source in {"quranlab", QURANLAB_FORCED_TIMING_SOURCE}:
        attribution = "QuranLab; timing source: " + timing_source
    else:
        raise QuranLabImportError("timed row has an unrecognized timing_source")

    segments = row.get("segments")
    if not isinstance(segments, list) or not segments:
        raise QuranLabImportError("has_word_timing row must contain non-empty segments")

    words: list[dict[str, Any]] = []
    previous_end = -1.0
    for expected_position, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            raise QuranLabImportError(f"segments[{expected_position - 1}] must be an object")
        position = _positive_int(segment.get("word_position"), "word_position")
        if position != expected_position:
            raise QuranLabImportError("word positions must be complete and contiguous from 1")
        start_ms = _finite_number(segment.get("start_ms"), "start_ms")
        end_ms = _finite_number(segment.get("end_ms"), "end_ms")
        if start_ms < 0 or end_ms <= start_ms or start_ms < previous_end:
            raise QuranLabImportError("word intervals must be positive, ordered, and non-overlapping")
        previous_end = end_ms
        words.append({
            "canonicalWordKey": f"{surah}:{ayah}:{position}",
            "wordPosition": position,
            "startMs": start_ms,
            "endMs": end_ms,
        })

    reciter_id = row.get("reciter_id")
    style = row.get("style")
    if not isinstance(reciter_id, str) or not reciter_id.strip():
        raise QuranLabImportError("reciter_id is required")
    if not isinstance(style, str) or not style.strip():
        raise QuranLabImportError("style is required")

    return {
        "schemaVersion": "quranlab-timing-candidate-v1",
        "id": f"quranlab:{config}:{verse_key}",
        "status": "needs_review",
        "dataset": {
            "id": DATASET_ID,
            "revision": revision,
            "config": config,
            "license": TIMING_LICENSE,
            "timingSource": timing_source,
            "attribution": attribution,
        },
        "reference": {
            "verseKey": verse_key,
            "surahNumber": surah,
            "ayahNumber": ayah,
            "quranEdition": "uthmani-hafs",
            "riwayah": riwayah,
        },
        "reciterId": reciter_id,
        "style": style,
        "audioBinding": {
            "sourceUrl": audio_url,
            "sha256": None,
            "durationMs": None,
            "byteIdentityVerified": False,
            "upstreamAudioRightsCleared": False,
        },
        "words": words,
        "policy": {
            "providerVerified": False,
            "renderEligible": False,
            "trainingEligible": False,
        },
    }


def import_rows(
    rows: Iterable[dict[str, Any]],
    *,
    config: str,
    revision: str = PINNED_REVISION,
) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    seen_verses: set[str] = set()
    for index, row in enumerate(rows):
        try:
            candidate = row_to_candidate(row, config=config, revision=revision)
        except QuranLabImportError as error:
            raise QuranLabImportError(f"row[{index}]: {error}") from error
        if candidate is None:
            continue
        verse_key = candidate["reference"]["verseKey"]
        if verse_key in seen_verses:
            raise QuranLabImportError(f"duplicate timed verse row: {verse_key}")
        seen_verses.add(verse_key)
        candidates.append(candidate)

    if not candidates:
        raise QuranLabImportError("the selected rows contain no timed Hafs ayahs")
    return {
        "schemaVersion": "quranlab-timing-candidate-set-v1",
        "datasetId": DATASET_ID,
        "datasetRevision": revision,
        "config": config,
        "license": TIMING_LICENSE,
        "audioBytesDownloaded": False,
        "candidateCount": len(candidates),
        "candidates": candidates,
    }


def load_pinned_config(config: str) -> Iterable[dict[str, Any]]:
    """Stream a pinned timing-only HF config; the repository contains no audio bytes."""
    try:
        from datasets import load_dataset  # type: ignore[import-not-found]
    except ImportError as error:
        raise QuranLabImportError(
            "install the optional `datasets` package in a data-preparation environment"
        ) from error

    return load_dataset(
        DATASET_ID,
        name=config,
        split="train",
        revision=PINNED_REVISION,
        streaming=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Export pinned QuranLab timings as untrusted AyahX candidates")
    parser.add_argument("config", help="QuranLab per-recitation config, e.g. husary")
    parser.add_argument("output", help="output JSON candidate bundle")
    args = parser.parse_args()
    try:
        rows = load_pinned_config(args.config)
        bundle = import_rows(rows, config=args.config)
        Path(args.output).write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"exported {bundle['candidateCount']} untrusted timing candidates; audio was not downloaded")
        return 0
    except (QuranLabImportError, OSError, ValueError) as error:
        print(f"quranlab_import_error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
