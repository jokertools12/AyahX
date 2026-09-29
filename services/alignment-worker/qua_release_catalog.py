"""Export pinned Quranic Universal Audio word timings as untrusted candidates.

This is an offline, metadata-only importer. It reads a pinned release manifest,
catalog, and timestamp archive; it never fetches, stores, trains on, or
redistributes recitation audio. Candidates remain non-renderable until AyahX
binds them to the exact source audio and a reviewer approves the timeline.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
import re
import sys
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


DATASET_ID = "QUD-Technologies/quranic-universal-audio"
PINNED_RELEASE = "v3.2.0"
PINNED_RELEASE_URL = (
    "https://github.com/QUD-Technologies/quranic-universal-audio/releases/tag/v3.2.0"
)
TIMING_LICENSE = "CC-BY-4.0"
ATTRIBUTION = "QUD Technologies, Quranic Universal Audio v3.2.0"
PINNED_MANIFEST_SHA256 = "04a7e9c06e4c414bbf16a163d9c9ea7cc279d4d5e752dcdb6db36e2446db880a"
PINNED_RELEASE_CATALOG_SHA256 = "e87ce3ec7fca6fff07a126837442578e334f603ae87fa0dde6bebd3e952f335a"
PINNED_HAFS_SCRIPT_SHA256 = "19d5694b057dc68c3811e28f3ad1d58c0f07021a0c67a85cd25619ece7a9bf86"

MAX_MANIFEST_BYTES = 1_000_000
MAX_CATALOG_BYTES = 2_000_000
MAX_ARCHIVE_BYTES = 20_000_000
MAX_ARCHIVE_MEMBER_BYTES = 100_000_000
MAX_TIMING_JSON_BYTES = 64_000_000
ALLOWED_ARCHIVE_MEMBERS = {
    "catalog.json",
    "verse_timestamps.json.gz",
    "word_timestamps.json.gz",
    "letter_timestamps.json.gz",
}


class QuaImportError(ValueError):
    """Raised when release metadata or timings fail the import contract."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_document(data: bytes, *, field: str, max_bytes: int) -> dict[str, Any]:
    if not isinstance(data, bytes) or not data or len(data) > max_bytes:
        raise QuaImportError(f"{field} must be non-empty and within the size limit")
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise QuaImportError(f"{field} must be valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise QuaImportError(f"{field} must be a JSON object")
    return value


def _record(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise QuaImportError(f"{field} must be an object")
    return value


def _finite_ms(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise QuaImportError(f"{field} must be finite milliseconds")
    result = float(value)
    if not math.isfinite(result):
        raise QuaImportError(f"{field} must be finite milliseconds")
    return result


def _safe_audio_reference(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise QuaImportError("chapter audio reference is missing or too long")
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise QuaImportError("chapter audio reference has an invalid port") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
    ):
        raise QuaImportError("chapter audio reference must be a plain HTTPS URL")
    return value


def _read_gzip_json(data: bytes, *, tier: str) -> dict[str, Any]:
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb") as stream:
            decoded = stream.read(MAX_TIMING_JSON_BYTES + 1)
    except (OSError, EOFError) as error:
        raise QuaImportError(f"{tier} timestamp archive is not valid gzip data") from error
    if len(decoded) > MAX_TIMING_JSON_BYTES:
        raise QuaImportError(f"{tier} timestamp JSON exceeds the decompressed size limit")
    return _json_document(
        decoded,
        field=f"{tier} timestamp JSON",
        max_bytes=MAX_TIMING_JSON_BYTES,
    )


def _release_recitation(catalog: dict[str, Any], slug: str) -> dict[str, Any]:
    recitations = catalog.get("recitations")
    if not isinstance(recitations, list):
        raise QuaImportError("release catalog recitations must be an array")
    matches = [
        item for item in recitations
        if isinstance(item, dict) and item.get("slug") == slug
    ]
    if len(matches) != 1:
        raise QuaImportError("selected recitation must occur exactly once in the release catalog")
    return matches[0]


def _chapter_audio(catalog_entry: dict[str, Any], surah: int) -> tuple[str, float]:
    audio = _record(catalog_entry.get("audio"), "recitation audio")
    chapter_urls = _record(audio.get("chapter_urls"), "chapter_urls")
    chapter = str(surah)
    source_url = _safe_audio_reference(chapter_urls.get(chapter))

    offsets = audio.get("chapter_offsets_ms", {})
    if not isinstance(offsets, dict):
        raise QuaImportError("chapter_offsets_ms must be an object when present")
    category = catalog_entry.get("audio_category")
    if chapter in offsets:
        offset_ms = _finite_ms(offsets[chapter], "chapter offset")
    elif category == "by_surah":
        offset_ms = 0.0
    else:
        raise QuaImportError("combined audio requires an explicit chapter offset")
    if offset_ms < 0:
        raise QuaImportError("chapter offset cannot be negative")
    return source_url, offset_ms


def _validate_letter_row_alignment(word_row: list[Any], letter_row: Any) -> None:
    if not isinstance(letter_row, list) or len(letter_row) != 8:
        raise QuaImportError("each QUA letter row must have eight fields")
    if (
        letter_row[0] != word_row[0]
        or letter_row[1] != word_row[1]
        or letter_row[2] != word_row[2]
        or letter_row[3] is not word_row[3]
        or letter_row[5] != word_row[5]
    ):
        raise QuaImportError("letter row does not align with its word timing row")
    if not isinstance(letter_row[6], str) or not letter_row[6] or len(letter_row[6]) > 4096:
        raise QuaImportError("letter row text must be non-empty and within the verse limit")
    if not isinstance(letter_row[7], list):
        raise QuaImportError("letter row tokens must be an array")


def _candidate_for_row(
    row: Any,
    *,
    letter_row: Any | None,
    slug: str,
    catalog_entry: dict[str, Any],
    script_sha256: str,
    archive_sha256: str,
    available_tiers: list[str],
) -> dict[str, Any] | None:
    if not isinstance(row, list) or len(row) != 6:
        raise QuaImportError("each QUA word row must have six fields")
    verse_key, verse_start, verse_end, canonical, _silence_after, raw_words = row
    if not isinstance(verse_key, str) or not re.fullmatch(r"[1-9][0-9]{0,2}:[1-9][0-9]{0,2}", verse_key):
        raise QuaImportError("verse reference must use canonical surah:ayah coordinates")
    surah_text, ayah_text = verse_key.split(":", maxsplit=1)
    surah = int(surah_text)
    ayah = int(ayah_text)
    if surah > 114:
        raise QuaImportError("surah number is outside the Quran")
    if not isinstance(canonical, bool):
        raise QuaImportError("word row canonical flag must be a boolean")
    if letter_row is not None:
        _validate_letter_row_alignment(row, letter_row)
    if canonical is not True:
        return None

    local_verse_start = _finite_ms(verse_start, "verse start")
    local_verse_end = _finite_ms(verse_end, "verse end")
    if local_verse_start < 0 or local_verse_end <= local_verse_start:
        raise QuaImportError("verse interval must be positive and ordered")
    if not isinstance(raw_words, list) or not raw_words:
        raise QuaImportError("canonical verse row must contain words")

    source_url, source_offset_ms = _chapter_audio(catalog_entry, surah)
    words: list[dict[str, Any]] = []
    source_word_indices: list[int] = []
    previous_end = local_verse_start
    for occurrence_index, word in enumerate(raw_words, start=1):
        if not isinstance(word, list) or len(word) != 3:
            raise QuaImportError(f"word occurrence {occurrence_index} must have position/start/end fields")
        source_word_index, local_start, local_end = word
        if (
            isinstance(source_word_index, bool)
            or not isinstance(source_word_index, int)
            or source_word_index <= 0
        ):
            raise QuaImportError("source word indices must be positive integers")
        start_ms = _finite_ms(local_start, f"word occurrence {occurrence_index} start")
        end_ms = _finite_ms(local_end, f"word occurrence {occurrence_index} end")
        if (
            start_ms < local_verse_start
            or end_ms > local_verse_end
            or end_ms <= start_ms
            or start_ms < previous_end
        ):
            raise QuaImportError("word intervals must be positive, ordered, and inside the verse")
        previous_end = end_ms
        source_word_indices.append(source_word_index)
        words.append({
            # QUA's source index maps the word to the pinned Quran script;
            # occurrenceIndex preserves repeated recitations in audio order.
            "canonicalWordKey": f"{verse_key}:{source_word_index}",
            "wordPosition": source_word_index,
            "sourceWordIndex": source_word_index,
            "occurrenceIndex": occurrence_index,
            "startMs": start_ms + source_offset_ms,
            "endMs": end_ms + source_offset_ms,
        })

    letter_timing = None
    if letter_row is not None:
        (
            letter_verse_key,
            letter_verse_start,
            letter_verse_end,
            letter_canonical,
            _letter_silence_after,
            letter_words,
            letter_text,
            raw_tokens,
        ) = letter_row
        # These fields were checked before canonical-row filtering as well.
        assert letter_verse_key == verse_key
        assert letter_verse_start == verse_start
        assert letter_verse_end == verse_end
        assert letter_canonical is canonical
        assert letter_words == raw_words

        paint_events: list[dict[str, Any]] = []
        previous_token_start = local_verse_start
        for token_index, token in enumerate(raw_tokens):
            if not isinstance(token, list) or len(token) != 5:
                raise QuaImportError(f"letter token {token_index} must have five fields")
            word_occurrence, local_start, local_end, owns_sound, raw_paint_ranges = token
            if (
                isinstance(word_occurrence, bool)
                or not isinstance(word_occurrence, int)
                or not 0 <= word_occurrence < len(words)
            ):
                raise QuaImportError("letter token word occurrence is outside the verse word list")
            start_ms = _finite_ms(local_start, f"letter token {token_index} start")
            end_ms = _finite_ms(local_end, f"letter token {token_index} end")
            if (
                start_ms < local_verse_start
                or end_ms > local_verse_end
                or end_ms < start_ms
                or start_ms < previous_token_start
            ):
                raise QuaImportError("letter token intervals must be non-negative, ordered, and inside the verse")
            if not isinstance(owns_sound, bool):
                raise QuaImportError("letter token owns_sound must be a boolean")
            if not isinstance(raw_paint_ranges, list):
                raise QuaImportError("letter token paint ranges must be an array")

            paint_ranges: list[list[int]] = []
            previous_paint_end = 0
            for range_index, paint_range in enumerate(raw_paint_ranges):
                if not isinstance(paint_range, list) or len(paint_range) != 2:
                    raise QuaImportError(f"letter paint range {range_index} must have two scalar offsets")
                scalar_start, scalar_end = paint_range
                if (
                    isinstance(scalar_start, bool)
                    or isinstance(scalar_end, bool)
                    or not isinstance(scalar_start, int)
                    or not isinstance(scalar_end, int)
                    or scalar_start < previous_paint_end
                    or scalar_end <= scalar_start
                    or scalar_end > len(letter_text)
                ):
                    raise QuaImportError("letter paint ranges must be ordered, non-empty Unicode scalar spans in the verse text")
                paint_ranges.append([scalar_start, scalar_end])
                previous_paint_end = scalar_end

            previous_token_start = start_ms
            paint_events.append({
                # The source indexes tokens by zero-based word occurrence, not
                # canonical Quran word number; retain both meanings explicitly.
                "wordOccurrenceIndex": word_occurrence,
                "occurrenceIndex": word_occurrence + 1,
                "sourceWordIndex": words[word_occurrence]["sourceWordIndex"],
                "startMs": start_ms + source_offset_ms,
                "endMs": end_ms + source_offset_ms,
                "ownsSound": owns_sound,
                "paintRanges": paint_ranges,
            })
        letter_timing = {
            "schema": "qua-v3-letter-paint-candidate-v1",
            "unicodeIndexing": "scalar",
            "text": letter_text,
            "events": paint_events,
        }

    return {
        "schemaVersion": "qua-timing-candidate-v1",
        "id": f"qua:{PINNED_RELEASE}:{slug}:{verse_key}",
        "status": "needs_review",
        "dataset": {
            "id": DATASET_ID,
            "revision": PINNED_RELEASE,
            "releaseUrl": PINNED_RELEASE_URL,
            "license": TIMING_LICENSE,
            "attribution": ATTRIBUTION,
            "archiveSha256": archive_sha256,
            "script": "digital_khatt_v2",
            "scriptSha256": script_sha256,
            "timingTier": "word",
            "availableTiers": available_tiers,
        },
        "reference": {
            "verseKey": verse_key,
            "surahNumber": surah,
            "ayahNumber": ayah,
            "quranEdition": "digital-khatt-v2-hafs",
            "riwayah": "hafs-an-asim",
        },
        "reciterId": catalog_entry.get("reciter_id"),
        "reciterName": catalog_entry.get("name_en"),
        "style": catalog_entry.get("style"),
        "sourceWordIndicesRepeat": len(set(source_word_indices)) != len(source_word_indices),
        "sourceWordIndicesNonSequential": source_word_indices != list(range(1, len(source_word_indices) + 1)),
        "audioBinding": {
            "sourceUrl": source_url,
            "sourceOffsetMs": source_offset_ms,
            "sha256": None,
            "durationMs": None,
            "byteIdentityVerified": False,
            "upstreamAudioRightsCleared": False,
        },
        "words": words,
        "letterTiming": letter_timing,
        "policy": {
            "providerVerified": False,
            "renderEligible": False,
            "trainingEligible": False,
        },
    }


def import_release(
    *,
    slug: str,
    manifest_bytes: bytes,
    release_catalog_bytes: bytes,
    archive_bytes: bytes,
) -> dict[str, Any]:
    """Validate a local pinned release bundle and export word/letter candidates."""
    if not re.fullmatch(r"[a-z0-9]+(?:_[a-z0-9]+)*", slug):
        raise QuaImportError("slug must be a lowercase QUA recitation id")
    if len(archive_bytes) > MAX_ARCHIVE_BYTES:
        raise QuaImportError("recitation archive exceeds the compressed size limit")
    if _sha256(manifest_bytes) != PINNED_MANIFEST_SHA256:
        raise QuaImportError("manifest does not match the reviewed v3.2.0 checksum")
    if _sha256(release_catalog_bytes) != PINNED_RELEASE_CATALOG_SHA256:
        raise QuaImportError("release catalog does not match the reviewed v3.2.0 checksum")

    manifest = _json_document(manifest_bytes, field="release manifest", max_bytes=MAX_MANIFEST_BYTES)
    release_catalog = _json_document(
        release_catalog_bytes,
        field="release catalog",
        max_bytes=MAX_CATALOG_BYTES,
    )
    if manifest.get("release_version") != PINNED_RELEASE:
        raise QuaImportError("release manifest version is not the pinned v3.2.0")
    if manifest.get("license") != TIMING_LICENSE:
        raise QuaImportError("release timing license is not the reviewed CC-BY-4.0 license")
    if release_catalog.get("schema_version") != 3:
        raise QuaImportError("release catalog schema is not the reviewed v3 schema")

    manifest_recitations = _record(manifest.get("recitations"), "manifest recitations")
    asset = _record(manifest_recitations.get(slug), "selected manifest recitation")
    if asset.get("zip") != f"{slug}.zip":
        raise QuaImportError("selected archive name does not match its pinned recitation slug")
    if isinstance(asset.get("bytes"), bool) or asset.get("bytes") != len(archive_bytes):
        raise QuaImportError("archive byte length does not match the pinned release manifest")
    archive_sha256 = _sha256(archive_bytes)
    if asset.get("sha256") != archive_sha256:
        raise QuaImportError("archive SHA-256 does not match the pinned release manifest")
    asset_tiers = asset.get("tiers")
    if (
        not isinstance(asset_tiers, list)
        or any(tier not in {"verse", "word", "letter"} for tier in asset_tiers)
        or "word" not in asset_tiers
    ):
        raise QuaImportError("selected release archive does not contain word timings")
    if asset.get("riwayah") != "hafs":
        raise QuaImportError("this importer currently supports Hafs timing candidates only")

    release_entry = _release_recitation(release_catalog, slug)
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes), mode="r") as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(names) != len(set(names)) or any(name not in ALLOWED_ARCHIVE_MEMBERS for name in names):
                raise QuaImportError("archive contains duplicate or unsupported members")
            if "catalog.json" not in names:
                raise QuaImportError("archive must contain catalog.json")
            for tier in asset_tiers:
                if f"{tier}_timestamps.json.gz" not in names:
                    raise QuaImportError(f"{tier} timestamp member is missing from the archive")
            if any(item.file_size > MAX_ARCHIVE_MEMBER_BYTES for item in infos):
                raise QuaImportError("archive member exceeds the decompressed size limit")
            archive_catalog = _json_document(
                archive.read("catalog.json"),
                field="recitation catalog",
                max_bytes=MAX_CATALOG_BYTES,
            )
            word_data = _read_gzip_json(archive.read("word_timestamps.json.gz"), tier="word")
            letter_data = (
                _read_gzip_json(archive.read("letter_timestamps.json.gz"), tier="letter")
                if "letter" in asset_tiers
                else None
            )
    except zipfile.BadZipFile as error:
        raise QuaImportError("recitation archive is not a valid ZIP file") from error

    for field in ("slug", "reciter_id", "riwayah", "style", "audio_category", "audio"):
        if archive_catalog.get(field) != release_entry.get(field):
            raise QuaImportError(f"archive and release catalogs disagree on {field}")
    if archive_catalog.get("slug") != slug:
        raise QuaImportError("recitation archive slug does not match the selected config")

    timing_meta = _record(word_data.get("_meta"), "word timing metadata")
    if (
        timing_meta.get("schema_version") != 3
        or timing_meta.get("slug") != slug
        or timing_meta.get("units") != "ms"
        or timing_meta.get("tier") != "word"
        or timing_meta.get("script") != "digital_khatt_v2"
        or timing_meta.get("riwayah") != "hafs"
        or timing_meta.get("audio_category") != archive_catalog.get("audio_category")
    ):
        raise QuaImportError("word timestamp metadata does not match the pinned Hafs word schema")
    script_sha256 = timing_meta.get("script_sha256")
    if script_sha256 != PINNED_HAFS_SCRIPT_SHA256:
        raise QuaImportError("word timestamps use an unreviewed Quran script projection")
    static_refs = _record(manifest.get("static_refs"), "manifest static_refs")
    script_asset = _record(static_refs.get("digital_khatt_v2_script.json"), "pinned Hafs script")
    if script_asset.get("sha256") != script_sha256:
        raise QuaImportError("word timestamp projection does not match the release script asset")

    rows = word_data.get("rows")
    if not isinstance(rows, list) or not rows:
        raise QuaImportError("word timestamp rows must be a non-empty array")
    if timing_meta.get("verse_count") != len(rows):
        raise QuaImportError("word timestamp verse count does not match the row count")
    if asset.get("coverage_ayahs") != len(rows):
        raise QuaImportError("word timestamp coverage does not match the pinned release manifest")

    letter_rows: list[Any] | None = None
    if letter_data is not None:
        letter_meta = _record(letter_data.get("_meta"), "letter timing metadata")
        if (
            letter_meta.get("schema_version") != 3
            or letter_meta.get("slug") != slug
            or letter_meta.get("units") != "ms"
            or letter_meta.get("tier") != "letter"
            or letter_meta.get("script") != timing_meta.get("script")
            or letter_meta.get("script_sha256") != script_sha256
            or letter_meta.get("riwayah") != timing_meta.get("riwayah")
            or letter_meta.get("audio_category") != timing_meta.get("audio_category")
            or letter_meta.get("unicode_indexing") != "scalar"
            or letter_meta.get("verse_count") != len(rows)
        ):
            raise QuaImportError("letter timestamp metadata does not match the pinned Hafs letter schema")
        letter_rows_value = letter_data.get("rows")
        if not isinstance(letter_rows_value, list) or len(letter_rows_value) != len(rows):
            raise QuaImportError("letter timestamp rows do not match the word row count")
        letter_rows = letter_rows_value

    candidates: list[dict[str, Any]] = []
    skipped_noncanonical = 0
    source_word_index_anomalies = 0
    seen_verses: set[str] = set()
    last_end_by_source: dict[str, float] = {}
    tiers = list(asset_tiers)
    for index, row in enumerate(rows):
        try:
            candidate = _candidate_for_row(
                row,
                letter_row=letter_rows[index] if letter_rows is not None else None,
                slug=slug,
                catalog_entry=archive_catalog,
                script_sha256=script_sha256,
                archive_sha256=archive_sha256,
                available_tiers=tiers,
            )
        except QuaImportError as error:
            raise QuaImportError(f"rows[{index}]: {error}") from error
        if candidate is None:
            skipped_noncanonical += 1
            continue

        verse_key = candidate["reference"]["verseKey"]
        if verse_key in seen_verses:
            raise QuaImportError(f"duplicate canonical verse row: {verse_key}")
        seen_verses.add(verse_key)
        if candidate["sourceWordIndicesNonSequential"]:
            source_word_index_anomalies += 1
        source = candidate["audioBinding"]["sourceUrl"]
        first_start = candidate["words"][0]["startMs"]
        last_end = candidate["words"][-1]["endMs"]
        if first_start < last_end_by_source.get(source, 0.0):
            raise QuaImportError(f"verse timeline moves backwards within source audio: {verse_key}")
        last_end_by_source[source] = last_end
        candidates.append(candidate)

    if not candidates:
        raise QuaImportError("selected archive contains no canonical Hafs word candidates")
    return {
        "schemaVersion": "qua-timing-candidate-set-v1",
        "datasetId": DATASET_ID,
        "datasetRevision": PINNED_RELEASE,
        "releaseUrl": PINNED_RELEASE_URL,
        "license": TIMING_LICENSE,
        "attribution": ATTRIBUTION,
        "manifestSha256": PINNED_MANIFEST_SHA256,
        "releaseCatalogSha256": PINNED_RELEASE_CATALOG_SHA256,
        "recitationSlug": slug,
        "reciterId": archive_catalog.get("reciter_id"),
        "style": archive_catalog.get("style"),
        "riwayah": "hafs-an-asim",
        "audioBytesDownloaded": False,
        "candidateCount": len(candidates),
        "skippedNoncanonicalCount": skipped_noncanonical,
        "sourceWordIndexAnomalyCount": source_word_index_anomalies,
        "letterTierAvailable": "letter" in tiers,
        "letterTierImported": letter_rows is not None,
        "candidates": candidates,
        "policy": {
            "providerVerified": False,
            "renderEligible": False,
            "trainingEligible": False,
            "requiresExactAudioBinding": True,
            "requiresHumanReview": True,
            "upstreamAudioRightsCleared": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export pinned QUA v3.2.0 word and letter-paint annotations as untrusted candidates"
    )
    parser.add_argument("slug", help="pinned QUA recitation slug")
    parser.add_argument("archive", type=Path, help="local <slug>.zip from the pinned release")
    parser.add_argument("output", type=Path, help="output JSON candidate bundle (.json or .json.gz)")
    parser.add_argument("--manifest", required=True, type=Path, help="local pinned manifest.json")
    parser.add_argument("--catalog", required=True, type=Path, help="local pinned catalog.json")
    args = parser.parse_args()

    try:
        bundle = import_release(
            slug=args.slug,
            manifest_bytes=args.manifest.read_bytes(),
            release_catalog_bytes=args.catalog.read_bytes(),
            archive_bytes=args.archive.read_bytes(),
        )
        if args.output.suffix.lower() == ".gz":
            with gzip.open(args.output, mode="wt", encoding="utf-8", newline="\n") as output:
                json.dump(bundle, output, ensure_ascii=False, separators=(",", ":"))
                output.write("\n")
        else:
            args.output.write_text(
                json.dumps(bundle, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        letter_status = (
            "with letter-paint candidates"
            if bundle["letterTierImported"]
            else "without a letter tier"
        )
        print(
            f"exported {bundle['candidateCount']} untrusted word candidates "
            f"{letter_status}; "
            "audio was not downloaded and none are render-eligible"
        )
        return 0
    except (OSError, QuaImportError, ValueError) as error:
        print(f"qua_import_error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
