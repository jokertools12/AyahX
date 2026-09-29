"""Offline tests for the pinned QUA timing-candidate importer."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import unittest
import zipfile
from unittest.mock import patch

import qua_release_catalog as qua


SLUG = "sample_reciter_qdc"
SOURCE_URL = "https://audio.example.org/001.mp3"
SCRIPT_SHA256 = qua.PINNED_HAFS_SCRIPT_SHA256


def sample_catalog(*, offset_ms: int | None = None) -> dict[str, object]:
    audio: dict[str, object] = {
        "chapter_urls": {"1": SOURCE_URL},
    }
    if offset_ms is not None:
        audio["chapter_offsets_ms"] = {"1": offset_ms}
    return {
        "slug": SLUG,
        "reciter_id": "sample_reciter",
        "name_en": "Sample Reciter",
        "riwayah": "hafs_an_asim",
        "style": "murattal",
        "audio_category": "by_surah" if offset_ms is None else "combined",
        "audio": audio,
    }


def sample_word_data(*, rows: list[list[object]] | None = None) -> dict[str, object]:
    return {
        "_meta": {
            "schema_version": 3,
            "slug": SLUG,
            "audio_category": "by_surah",
            "units": "ms",
            "verse_count": 2 if rows is None else len(rows),
            "occurrence_count": 2 if rows is None else len(rows),
            "script": "digital_khatt_v2",
            "script_sha256": SCRIPT_SHA256,
            "riwayah": "hafs",
            "unicode_indexing": "scalar",
            "tier": "word",
        },
        "rows": rows if rows is not None else [
            ["1:1", 100, 200, True, 20, [[1, 110, 150], [2, 150, 190]]],
            ["1:2", 300, 410, True, 0, [[1, 310, 350], [2, 350, 400]]],
        ],
    }


def make_archive(
    catalog: dict[str, object] | None = None,
    word_data: dict[str, object] | None = None,
    *,
    include_letter_tier: bool = True,
) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("catalog.json", json.dumps(catalog or sample_catalog()))
        archive.writestr(
            "word_timestamps.json.gz",
            gzip.compress(json.dumps(word_data or sample_word_data()).encode("utf-8")),
        )
        archive.writestr("verse_timestamps.json.gz", gzip.compress(b"{}"))
        if include_letter_tier:
            archive.writestr("letter_timestamps.json.gz", gzip.compress(b"{}"))
    return buffer.getvalue()


def build_bundle_inputs(
    *,
    slug: str = SLUG,
    catalog: dict[str, object] | None = None,
    word_data: dict[str, object] | None = None,
    archive_bytes: bytes | None = None,
    riwayah: str = "hafs",
    tiers: list[str] | None = None,
) -> tuple[bytes, bytes, bytes]:
    selected_catalog = catalog or sample_catalog()
    selected_archive = archive_bytes or make_archive(selected_catalog, word_data)
    manifest = {
        "release_version": qua.PINNED_RELEASE,
        "license": qua.TIMING_LICENSE,
        "recitation_count": 1,
        "static_refs": {
            "digital_khatt_v2_script.json": {"sha256": SCRIPT_SHA256},
        },
        "recitations": {
            slug: {
                "bytes": len(selected_archive),
                "sha256": hashlib.sha256(selected_archive).hexdigest(),
                "zip": f"{slug}.zip",
                "coverage_ayahs": 2 if word_data is None else len(word_data["rows"]),
                "riwayah": riwayah,
                "tiers": tiers or ["verse", "word", "letter"],
            },
        },
    }
    release_catalog = {
        "schema_version": 3,
        "recitations": [selected_catalog],
    }
    return (
        json.dumps(manifest).encode("utf-8"),
        json.dumps(release_catalog).encode("utf-8"),
        selected_archive,
    )


def import_fixture(**kwargs: object) -> dict[str, object]:
    manifest_bytes, catalog_bytes, archive_bytes = build_bundle_inputs(**kwargs)
    with (
        patch.object(qua, "PINNED_MANIFEST_SHA256", hashlib.sha256(manifest_bytes).hexdigest()),
        patch.object(
            qua,
            "PINNED_RELEASE_CATALOG_SHA256",
            hashlib.sha256(catalog_bytes).hexdigest(),
        ),
    ):
        return qua.import_release(
            slug=str(kwargs.get("slug", SLUG)),
            manifest_bytes=manifest_bytes,
            release_catalog_bytes=catalog_bytes,
            archive_bytes=archive_bytes,
        )


class QuaReleaseCatalogTests(unittest.TestCase):
    def test_exports_pinned_word_times_as_unbound_untrusted_candidates(self) -> None:
        bundle = import_fixture()
        candidate = bundle["candidates"][0]

        self.assertEqual(bundle["datasetRevision"], "v3.2.0")
        self.assertEqual(bundle["license"], "CC-BY-4.0")
        self.assertEqual(bundle["candidateCount"], 2)
        self.assertFalse(bundle["audioBytesDownloaded"])
        self.assertTrue(bundle["letterTierAvailable"])
        self.assertEqual(candidate["dataset"]["attribution"], qua.ATTRIBUTION)
        self.assertEqual(candidate["reference"]["quranEdition"], "digital-khatt-v2-hafs")
        self.assertEqual(candidate["words"][0]["canonicalWordKey"], "1:1:1")
        self.assertEqual(candidate["words"][0]["occurrenceIndex"], 1)
        self.assertEqual(candidate["words"][0]["sourceWordIndex"], 1)
        self.assertFalse(candidate["sourceWordIndicesNonSequential"])
        self.assertIsNone(candidate["audioBinding"]["sha256"])
        self.assertFalse(candidate["audioBinding"]["byteIdentityVerified"])
        self.assertFalse(candidate["audioBinding"]["upstreamAudioRightsCleared"])
        self.assertFalse(candidate["policy"]["providerVerified"])
        self.assertFalse(candidate["policy"]["renderEligible"])
        self.assertFalse(bundle["policy"]["trainingEligible"])

    def test_applies_explicit_combined_audio_offset_to_candidate_times(self) -> None:
        catalog = sample_catalog(offset_ms=500)
        word_data = sample_word_data()
        word_data["_meta"]["audio_category"] = "combined"
        bundle = import_fixture(catalog=catalog, word_data=word_data)
        candidate = bundle["candidates"][0]

        self.assertEqual(candidate["audioBinding"]["sourceOffsetMs"], 500)
        self.assertEqual(candidate["words"][0]["startMs"], 610)
        self.assertEqual(candidate["words"][0]["endMs"], 650)

    def test_skips_noncanonical_rows_without_claiming_full_coverage(self) -> None:
        rows = sample_word_data()["rows"]
        rows[0][3] = False
        bundle = import_fixture(word_data=sample_word_data(rows=rows))

        self.assertEqual(bundle["candidateCount"], 1)
        self.assertEqual(bundle["skippedNoncanonicalCount"], 1)
        self.assertEqual(bundle["candidates"][0]["reference"]["verseKey"], "1:2")

    def test_preserves_repeated_word_occurrences_in_audio_order(self) -> None:
        rows = sample_word_data()["rows"]
        rows[0][5] = [[1, 110, 125], [1, 130, 145], [2, 150, 190]]
        bundle = import_fixture(word_data=sample_word_data(rows=rows))
        candidate = bundle["candidates"][0]

        self.assertTrue(candidate["sourceWordIndicesRepeat"])
        self.assertTrue(candidate["sourceWordIndicesNonSequential"])
        self.assertEqual(
            [word["canonicalWordKey"] for word in candidate["words"]],
            ["1:1:1", "1:1:1", "1:1:2"],
        )
        self.assertEqual([word["occurrenceIndex"] for word in candidate["words"]], [1, 2, 3])
        self.assertEqual(bundle["sourceWordIndexAnomalyCount"], 1)

    def test_rejects_wrong_pins_archive_bytes_and_manifest_revision(self) -> None:
        manifest_bytes, catalog_bytes, archive_bytes = build_bundle_inputs()
        with (
            patch.object(qua, "PINNED_MANIFEST_SHA256", hashlib.sha256(manifest_bytes).hexdigest()),
            patch.object(
                qua,
                "PINNED_RELEASE_CATALOG_SHA256",
                hashlib.sha256(catalog_bytes).hexdigest(),
            ),
        ):
            with self.assertRaisesRegex(qua.QuaImportError, "manifest does not match"):
                qua.import_release(
                    slug=SLUG,
                    manifest_bytes=manifest_bytes + b" ",
                    release_catalog_bytes=catalog_bytes,
                    archive_bytes=archive_bytes,
                )
            with self.assertRaisesRegex(qua.QuaImportError, "archive SHA-256"):
                qua.import_release(
                    slug=SLUG,
                    manifest_bytes=manifest_bytes,
                    release_catalog_bytes=catalog_bytes,
                    archive_bytes=archive_bytes[:-1] + bytes([archive_bytes[-1] ^ 1]),
                )

    def test_rejects_non_hafs_and_unpinned_word_projection(self) -> None:
        with self.assertRaisesRegex(qua.QuaImportError, "Hafs timing candidates only"):
            import_fixture(riwayah="warsh")

        word_data = sample_word_data()
        word_data["_meta"]["script_sha256"] = "0" * 64
        with self.assertRaisesRegex(qua.QuaImportError, "unreviewed Quran script projection"):
            import_fixture(word_data=word_data)

    def test_rejects_malformed_or_out_of_order_word_spans(self) -> None:
        word_data = sample_word_data()
        word_data["rows"][0][5][1][1] = 140
        with self.assertRaisesRegex(qua.QuaImportError, "ordered, and inside the verse"):
            import_fixture(word_data=word_data)

    def test_rejects_catalog_mismatch_and_missing_combined_offset(self) -> None:
        manifest_bytes, release_catalog_bytes, archive_bytes = build_bundle_inputs()
        release_catalog = json.loads(release_catalog_bytes)
        release_catalog["recitations"][0]["style"] = "mujawwad"
        release_catalog_bytes = json.dumps(release_catalog).encode("utf-8")
        with (
            patch.object(qua, "PINNED_MANIFEST_SHA256", hashlib.sha256(manifest_bytes).hexdigest()),
            patch.object(
                qua,
                "PINNED_RELEASE_CATALOG_SHA256",
                hashlib.sha256(release_catalog_bytes).hexdigest(),
            ),
        ):
            with self.assertRaisesRegex(qua.QuaImportError, "catalogs disagree on style"):
                qua.import_release(
                    slug=SLUG,
                    manifest_bytes=manifest_bytes,
                    release_catalog_bytes=release_catalog_bytes,
                    archive_bytes=archive_bytes,
                )

        catalog = sample_catalog()
        catalog["audio_category"] = "combined"
        word_data = sample_word_data()
        word_data["_meta"]["audio_category"] = "combined"
        with self.assertRaisesRegex(qua.QuaImportError, "explicit chapter offset"):
            import_fixture(catalog=catalog, word_data=word_data)

    def test_rejects_non_https_audio_references(self) -> None:
        catalog = sample_catalog()
        catalog["audio"]["chapter_urls"]["1"] = "http://audio.example.org/001.mp3"
        with self.assertRaisesRegex(qua.QuaImportError, "plain HTTPS URL"):
            import_fixture(catalog=catalog)

    def test_rejects_missing_archive_tier_claimed_by_manifest(self) -> None:
        archive_bytes = make_archive(include_letter_tier=False)
        manifest_bytes, catalog_bytes, archive_bytes = build_bundle_inputs(
            archive_bytes=archive_bytes,
        )
        with (
            patch.object(qua, "PINNED_MANIFEST_SHA256", hashlib.sha256(manifest_bytes).hexdigest()),
            patch.object(
                qua,
                "PINNED_RELEASE_CATALOG_SHA256",
                hashlib.sha256(catalog_bytes).hexdigest(),
            ),
        ):
            with self.assertRaisesRegex(qua.QuaImportError, "letter timestamp member"):
                qua.import_release(
                    slug=SLUG,
                    manifest_bytes=manifest_bytes,
                    release_catalog_bytes=catalog_bytes,
                    archive_bytes=archive_bytes,
                )


if __name__ == "__main__":
    unittest.main()
