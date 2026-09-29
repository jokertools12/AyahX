"""Offline tests for importing timing metadata without importing audio."""

from __future__ import annotations

import unittest

from quranlab_catalog import (
    PINNED_REVISION,
    QURANLAB_FORCED_TIMING_SOURCE,
    QuranLabImportError,
    import_rows,
    row_to_candidate,
)


def sample_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "verse_key": "1:2",
        "surah": 1,
        "ayah": 2,
        "recitation_id": "husary",
        "reciter_id": "husary",
        "riwayah": "hafs-asim",
        "style": "murattal",
        "audio_url": "https://everyayah.com/data/Husary_128kbps/001002.mp3",
        "has_word_timing": True,
        "segments": [
            {"word_position": 1, "start_ms": 50, "end_ms": 510},
            {"word_position": 2, "start_ms": 520, "end_ms": 1180},
        ],
        "timing_source": "cpfair/quran-align",
    }
    row.update(overrides)
    return row


class QuranLabCatalogTests(unittest.TestCase):
    def test_exports_cc_by_timing_as_an_unbound_non_renderable_candidate(self) -> None:
        candidate = row_to_candidate(sample_row(), config="husary")
        assert candidate is not None
        self.assertEqual(candidate["dataset"]["revision"], PINNED_REVISION)
        self.assertEqual(candidate["dataset"]["license"], "CC-BY-4.0")
        self.assertEqual(candidate["dataset"]["attribution"], "Collin Fair, cpfair/quran-align; catalogued by QuranLab")
        self.assertEqual(candidate["reference"]["verseKey"], "1:2")
        self.assertEqual(candidate["words"][1]["canonicalWordKey"], "1:2:2")
        self.assertIsNone(candidate["audioBinding"]["sha256"])
        self.assertFalse(candidate["audioBinding"]["byteIdentityVerified"])
        self.assertFalse(candidate["policy"]["providerVerified"])
        self.assertFalse(candidate["policy"]["renderEligible"])
        self.assertFalse(candidate["policy"]["trainingEligible"])

    def test_skips_explicitly_untimed_rows(self) -> None:
        self.assertIsNone(row_to_candidate(sample_row(has_word_timing=False, segments=[]), config="husary"))

    def test_accepts_the_pinned_quranlab_forced_alignment_provenance(self) -> None:
        candidate = row_to_candidate(
            sample_row(timing_source=QURANLAB_FORCED_TIMING_SOURCE), config="husary"
        )
        assert candidate is not None
        self.assertIn(QURANLAB_FORCED_TIMING_SOURCE, candidate["dataset"]["attribution"])
        self.assertFalse(candidate["policy"]["renderEligible"])

    def test_rejects_a_different_or_moving_dataset_revision(self) -> None:
        with self.assertRaisesRegex(QuranLabImportError, "unsupported dataset revision"):
            row_to_candidate(sample_row(), config="husary", revision="main")

    def test_rejects_wrong_config_and_non_hafs_material(self) -> None:
        with self.assertRaisesRegex(QuranLabImportError, "does not match"):
            row_to_candidate(sample_row(), config="mishary-alafasy")
        with self.assertRaisesRegex(QuranLabImportError, "hafs-asim"):
            row_to_candidate(sample_row(riwayah="warsh-nafi"), config="husary")

    def test_rejects_unrecognized_audio_hosts_and_incomplete_word_positions(self) -> None:
        with self.assertRaisesRegex(QuranLabImportError, "EveryAyah"):
            row_to_candidate(sample_row(audio_url="https://example.com/001002.mp3"), config="husary")
        with self.assertRaisesRegex(QuranLabImportError, "complete and contiguous"):
            row_to_candidate(sample_row(segments=[{"word_position": 2, "start_ms": 50, "end_ms": 510}]), config="husary")

    def test_rejects_duplicate_timed_ayah_rows(self) -> None:
        with self.assertRaisesRegex(QuranLabImportError, "duplicate timed verse"):
            import_rows([sample_row(), sample_row()], config="husary")


if __name__ == "__main__":
    unittest.main()
