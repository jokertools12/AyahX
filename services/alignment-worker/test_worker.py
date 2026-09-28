"""Fast, dependency-light contract checks for the alignment worker.

Run with the worker's development environment:
    python -m pytest -q test_worker.py
"""

from __future__ import annotations

import unittest
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

from contract import AlignmentRequest, AlignmentResult, ReferenceSnapshot, WordSpan, expected_word_keys
from dataset_tools import DatasetError, _main, build_manifest, evaluate_predictions, validate_record
from train_ctc import load_manifest


def fake_engine(request: AlignmentRequest, audio_path: str | None = None) -> dict[str, object]:
    """Test-only explicit engine; it is never enabled by the production image."""
    words = []
    cursor = 100.0
    for ayah in sorted(request.reference.ayahs, key=lambda item: item.numberInSurah):
        for index, token in enumerate(ayah.text.split(), start=1):
            words.append({
                "canonicalWordKey": f"{request.reference.surahNumber}:{ayah.numberInSurah}:{index}",
                "ayahNumber": ayah.numberInSurah,
                "wordIndex1Based": index,
                "displayToken": token,
                "startMs": cursor,
                "endMs": cursor + 100,
                "confidence": 0.9,
            })
            cursor += 120
    return {
        "providerId": "internal_ctc",
        "providerVersion": "test-engine",
        "sourceMethod": "test-explicit-engine",
        "words": words,
    }


def valid_request() -> AlignmentRequest:
    return AlignmentRequest.model_validate({
        "providerId": "internal_ctc",
        "reciterId": "test-reciter",
        "audio": {
            "contentHash": "a" * 64,
            "durationMs": 2_000,
            "sourceUrlOrAssetId": "asset:test.mp3",
        },
        "reference": {
            "surahNumber": 1,
            "startAyah": 1,
            "endAyah": 1,
            "ayahs": [{"numberInSurah": 1, "text": "قُلْ هُوَ اللَّهُ"}],
        },
    })


class ContractTests(unittest.TestCase):
    @staticmethod
    def dataset_record(
        record_id: str,
        reciter_id: str,
        audio_hash: str,
        *,
        split: str | None = None,
        mode: str = "murattal",
        with_spans: bool = False,
    ) -> dict[str, object]:
        record: dict[str, object] = {
            "id": record_id,
            "reciterId": reciter_id,
            "mode": mode,
            "audio": {"sha256": audio_hash, "durationMs": 1_000},
            "reference": {
                "surahNumber": 1,
                "startAyah": 1,
                "endAyah": 1,
                "ayahs": [{"numberInSurah": 1, "text": "قُلْ هُوَ"}],
            },
            "provenance": {
                "sourceId": "licensed-source",
                "license": "approved-for-research",
                "usageApproved": True,
                "transcriptionReviewed": True,
            },
        }
        if split:
            record["split"] = split
        if with_spans:
            record["provenance"]["wordTimingReviewed"] = True  # type: ignore[index]
            record["words"] = [
                {"canonicalWordKey": "1:1:1", "startMs": 100, "endMs": 300, "confidence": 1.0},
                {"canonicalWordKey": "1:1:2", "startMs": 350, "endMs": 600, "confidence": 1.0},
            ]
        return record

    def test_reference_keys_are_canonical_and_contiguous(self) -> None:
        request = valid_request()
        self.assertEqual(expected_word_keys(request.reference), ["1:1:1", "1:1:2", "1:1:3"])
        with self.assertRaises(ValueError):
            ReferenceSnapshot.model_validate({
                "surahNumber": 1,
                "startAyah": 1,
                "endAyah": 2,
                "ayahs": [{"numberInSurah": 1, "text": "قُلْ"}],
            })

    def test_result_requires_explicit_spans(self) -> None:
        result = AlignmentResult.model_validate({
            "providerId": "internal_ctc",
            "providerVersion": "test",
            "sourceMethod": "test",
            "words": [{
                "canonicalWordKey": "1:1:1",
                "ayahNumber": 1,
                "wordIndex1Based": 1,
                "startMs": 10,
                "endMs": 20,
                "confidence": 0.9,
            }],
        })
        self.assertEqual(result.words[0].endMs, 20)
        with self.assertRaises(ValueError):
            WordSpan.model_validate({
                "canonicalWordKey": "1:1:1",
                "ayahNumber": 1,
                "wordIndex1Based": 1,
                "startMs": 10,
                "endMs": 10,
                "confidence": 0.9,
            })

    def test_dataset_requires_usage_approval_and_exact_coverage(self) -> None:
        record = {
            "id": "sample-1",
            "reciterId": "reciter-a",
            "mode": "murattal",
            "audio": {"sha256": "b" * 64, "durationMs": 1_000},
            "reference": {"surahNumber": 1, "startAyah": 1, "endAyah": 1, "ayahs": [{"numberInSurah": 1, "text": "قُلْ هُوَ"}]},
            "provenance": {
                "sourceId": "licensed-source",
                "license": "internal-approval-1",
                "usageApproved": True,
                "transcriptionReviewed": True,
                "wordTimingReviewed": True,
            },
            "words": [
                {"canonicalWordKey": "1:1:1", "startMs": 100, "endMs": 300, "confidence": 0.9},
                {"canonicalWordKey": "1:1:2", "startMs": 350, "endMs": 600, "confidence": 0.9},
            ],
        }
        self.assertEqual(validate_record(record)["id"], "sample-1")
        self.assertEqual(build_manifest([record])["recordCount"], 1)
        record["provenance"]["usageApproved"] = False
        with self.assertRaises(DatasetError):
            validate_record(record)

    def test_training_manifest_allows_reviewed_transcript_without_timing_labels(self) -> None:
        record = self.dataset_record("train-a", "reciter-a", "a" * 64)
        self.assertEqual(validate_record(record)["id"], "train-a")
        manifest = build_manifest([record])
        self.assertEqual(manifest["recordCount"], 1)

    def test_split_groups_reciter_and_duplicate_audio_and_rejects_conflicts(self) -> None:
        records = [
            self.dataset_record("a", "reciter-a", "a" * 64, split="train"),
            self.dataset_record("b", "RECITER-A", "b" * 64),
            self.dataset_record("c", "reciter-c", "b" * 64),
        ]
        manifest = build_manifest(records)
        self.assertEqual({row["split"] for row in manifest["records"]}, {"train"})

        conflicting = [
            self.dataset_record("a", "same-reciter", "c" * 64, split="train"),
            self.dataset_record("b", "same-reciter", "d" * 64, split="test"),
        ]
        with self.assertRaisesRegex(DatasetError, "multiple dataset splits"):
            build_manifest(conflicting)

    def test_boundary_evaluation_counts_missing_predictions_and_stratifies(self) -> None:
        references = [
            self.dataset_record("one", "reciter-one", "e" * 64, split="test", with_spans=True),
            self.dataset_record("two", "reciter-two", "f" * 64, split="test", mode="tajweed", with_spans=True),
        ]
        predictions = {
            "one": {
                "id": "one",
                "words": [
                    {"canonicalWordKey": "1:1:1", "startMs": 100, "endMs": 300, "confidence": 0.9},
                    {"canonicalWordKey": "1:1:2", "startMs": 350, "endMs": 600, "confidence": 0.9},
                ],
            }
        }
        result = evaluate_predictions(references, predictions)
        self.assertEqual(result["evaluatedRecords"], 1)
        self.assertEqual(result["referenceRecords"], 2)
        self.assertEqual(result["coverageMean"], 0.5)
        self.assertEqual(result["byMode"]["tajweed"]["coverage"], 0.0)
        self.assertEqual(result["byReciter"]["reciter-two"]["predictedRecords"], 0)

        result_with_extra = evaluate_predictions(references, {**predictions, "extra": {"id": "extra", "words": []}})
        self.assertEqual(result_with_extra["unexpectedRecords"], 1)

    def test_evaluation_scores_only_test_rows_and_rejects_tampered_manifest(self) -> None:
        records = [
            self.dataset_record("train", "train-reciter", "1" * 64, split="train"),
            self.dataset_record("validation", "validation-reciter", "2" * 64, split="validation"),
            self.dataset_record("test", "test-reciter", "3" * 64, split="test", with_spans=True),
        ]
        manifest = build_manifest(records)
        prediction = {
            "id": "test",
            "words": [
                {"canonicalWordKey": "1:1:1", "startMs": 100, "endMs": 300, "confidence": 0.9},
                {"canonicalWordKey": "1:1:2", "startMs": 350, "endMs": 600, "confidence": 0.9},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "manifest.json"
            predictions_path = root / "predictions.jsonl"
            result_path = root / "evaluation.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            predictions_path.write_text(json.dumps(prediction, ensure_ascii=False) + "\n", encoding="utf-8")

            with patch.object(sys, "argv", ["dataset_tools.py", "evaluate", str(manifest_path), str(predictions_path), str(result_path)]):
                self.assertEqual(_main(), 0)
            result = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertEqual(result["referenceRecords"], 1)
            self.assertTrue(result["passed"])

            tampered = dict(manifest, datasetSha256="0" * 64)
            manifest_path.write_text(json.dumps(tampered, ensure_ascii=False), encoding="utf-8")
            with patch.object(sys, "argv", ["dataset_tools.py", "evaluate", str(manifest_path), str(predictions_path), str(result_path)]):
                self.assertEqual(_main(), 2)

    def test_training_rejects_a_manifest_whose_content_no_longer_matches_its_digest(self) -> None:
        manifest = build_manifest([self.dataset_record("train", "reciter", "4" * 64, split="train")])
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(load_manifest(manifest_path)["recordCount"], 1)
            changed = dict(manifest)
            changed["records"] = [dict(manifest["records"][0], mode="tajweed")]
            manifest_path.write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(DatasetError, "datasetSha256"):
                load_manifest(manifest_path)

    def test_http_worker_is_fail_closed_without_model(self) -> None:
        from fastapi.testclient import TestClient
        from app import app

        old = {key: os.environ.get(key) for key in ("ALIGNMENT_WORKER_SHARED_TOKEN", "ALIGNMENT_ENGINE_MODULE", "ALIGNMENT_ENGINE_COMMAND", "ALIGNMENT_CTC_MODEL_ID")}
        try:
            os.environ["ALIGNMENT_WORKER_SHARED_TOKEN"] = "test-token"
            for key in ("ALIGNMENT_ENGINE_MODULE", "ALIGNMENT_ENGINE_COMMAND", "ALIGNMENT_CTC_MODEL_ID"):
                os.environ.pop(key, None)
            with TestClient(app) as client:
                self.assertEqual(client.get("/health/live").status_code, 200)
                ready = client.get("/health/ready")
                self.assertEqual(ready.status_code, 503)
                self.assertEqual(ready.json()["code"], "MODEL_NOT_CONFIGURED")
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_http_worker_verifies_asset_hash_before_explicit_engine(self) -> None:
        from fastapi.testclient import TestClient
        from app import app

        old = {key: os.environ.get(key) for key in ("ALIGNMENT_WORKER_SHARED_TOKEN", "ALIGNMENT_ENGINE_MODULE", "ALIGNMENT_AUDIO_ASSET_ROOT")}
        with tempfile.TemporaryDirectory() as directory:
            try:
                payload = b"audio fixture bytes"
                Path(directory, "sample.bin").write_bytes(payload)
                os.environ["ALIGNMENT_WORKER_SHARED_TOKEN"] = "test-token"
                os.environ["ALIGNMENT_ENGINE_MODULE"] = "test_worker:fake_engine"
                os.environ["ALIGNMENT_AUDIO_ASSET_ROOT"] = directory
                request = valid_request().model_dump(mode="json")
                request["audio"]["sourceUrlOrAssetId"] = "asset:sample.bin"
                request["audio"]["contentHash"] = hashlib.sha256(payload).hexdigest()
                with TestClient(app) as client:
                    response = client.post("/v1/align", headers={"Authorization": "Bearer test-token"}, json=request)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(len(response.json()["result"]["words"]), 3)
                    request["audio"]["contentHash"] = "c" * 64
                    mismatch = client.post("/v1/align", headers={"Authorization": "Bearer test-token"}, json=request)
                    self.assertEqual(mismatch.status_code, 400)
                    self.assertEqual(mismatch.json()["code"], "AUDIO_CONTENT_HASH_MISMATCH")
            finally:
                for key, value in old.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
