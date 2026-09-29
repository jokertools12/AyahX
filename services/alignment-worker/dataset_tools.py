"""Dataset governance and deterministic split/evaluation helpers.

Training records require reviewed Quran transcriptions and documented usage
approval. Boundary-evaluation records additionally require reviewed word
spans. The helpers are standard-library-only so CI can run before optional
GPU dependencies are installed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path
from typing import Any, Iterable


MODES = {"murattal", "mujawwad", "tarteel", "tajweed", "mixed"}


class DatasetError(ValueError):
    pass


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def _required(mapping: dict[str, Any], key: str, context: str) -> Any:
    if key not in mapping:
        raise DatasetError(f"{context}: missing {key}")
    return mapping[key]


def expected_keys(record: dict[str, Any]) -> list[str]:
    reference = record["reference"]
    surah = int(reference["surahNumber"])
    return [
        f"{surah}:{ayah['numberInSurah']}:{index}"
        for ayah in sorted(reference["ayahs"], key=lambda value: int(value["numberInSurah"]))
        for index, _token in enumerate(str(ayah["text"]).split(), start=1)
    ]


def validate_record(
    record: dict[str, Any],
    index: int = 0,
    require_word_spans: bool = False,
) -> dict[str, Any]:
    context = f"record[{index}]"
    if not isinstance(record, dict):
        raise DatasetError(f"{context}: expected an object")
    record_id = str(_required(record, "id", context)).strip()
    if not record_id or len(record_id) > 191:
        raise DatasetError(f"{context}: invalid id")
    audio = _required(record, "audio", context)
    if not isinstance(audio, dict):
        raise DatasetError(f"{context}: audio must be an object")
    audio_hash = str(_required(audio, "sha256", context)).lower()
    if len(audio_hash) != 64 or any(character not in "0123456789abcdef" for character in audio_hash):
        raise DatasetError(f"{context}: audio.sha256 must be a SHA-256 digest")
    duration = float(_required(audio, "durationMs", context))
    if not _finite(duration) or duration <= 0:
        raise DatasetError(f"{context}: audio.durationMs must be positive")
    reference = _required(record, "reference", context)
    if not isinstance(reference, dict):
        raise DatasetError(f"{context}: reference must be an object")
    ayahs = reference.get("ayahs")
    if not isinstance(ayahs, list) or not ayahs:
        raise DatasetError(f"{context}: reference.ayahs is required")
    numbers = sorted(int(ayah["numberInSurah"]) for ayah in ayahs)
    start = int(reference["startAyah"])
    end = int(reference["endAyah"])
    if numbers != list(range(start, end + 1)):
        raise DatasetError(f"{context}: reference ayahs must be contiguous")
    mode = str(_required(record, "mode", context)).lower()
    if mode not in MODES:
        raise DatasetError(f"{context}: mode must be one of {sorted(MODES)}")
    reciter = str(_required(record, "reciterId", context)).strip()
    if not reciter:
        raise DatasetError(f"{context}: reciterId is required")
    provenance = _required(record, "provenance", context)
    if (
        not isinstance(provenance, dict)
        or not str(provenance.get("sourceId", "")).strip()
        or not str(provenance.get("license", "")).strip()
        or provenance.get("usageApproved") is not True
        or provenance.get("transcriptionReviewed") is not True
    ):
        raise DatasetError(
            f"{context}: provenance.sourceId/license/usageApproved/transcriptionReviewed are required"
        )
    words = record.get("words")
    if words is None:
        if require_word_spans:
            raise DatasetError(f"{context}: reviewed word spans are required for boundary evaluation")
    else:
        if not isinstance(words, list) or not words:
            raise DatasetError(f"{context}: words must be a non-empty list when supplied")
        if provenance.get("wordTimingReviewed") is not True:
            raise DatasetError(f"{context}: provenance.wordTimingReviewed must be true when word spans are supplied")
        expected = expected_keys(record)
        actual = [str(word.get("canonicalWordKey", "")) for word in words if isinstance(word, dict)]
        if actual != expected:
            raise DatasetError(f"{context}: words must cover the exact reference in order")
        previous_end = -1.0
        for word_index, word in enumerate(words):
            if not isinstance(word, dict):
                raise DatasetError(f"{context}.words[{word_index}]: expected object")
            start_ms = float(_required(word, "startMs", f"{context}.words[{word_index}]"))
            end_ms = float(_required(word, "endMs", f"{context}.words[{word_index}]"))
            confidence = float(word.get("confidence", 0))
            if not _finite(start_ms) or not _finite(end_ms) or end_ms <= start_ms or start_ms < previous_end:
                raise DatasetError(f"{context}.words[{word_index}]: invalid or overlapping interval")
            if end_ms > duration + 150:
                raise DatasetError(f"{context}.words[{word_index}]: interval exceeds audio duration")
            if not _finite(confidence) or confidence < 0 or confidence > 1:
                raise DatasetError(f"{context}.words[{word_index}]: confidence must be in [0,1]")
            previous_end = end_ms
    if "split" in record and record["split"] not in {"train", "validation", "test"}:
        raise DatasetError(f"{context}: split must be train, validation, or test")
    return record


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetError(f"record[{index}]: invalid JSON") from exc
        validated = validate_record(record, index)
        if validated["id"] in seen_ids:
            raise DatasetError(f"duplicate record id: {validated['id']}")
        seen_ids.add(validated["id"])
        records.append(validated)
    if not records:
        raise DatasetError("dataset is empty")
    return records


def read_predictions(path: str | Path) -> list[dict[str, Any]]:
    """Read model predictions without treating them as licensed source data."""
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetError(f"prediction[{index}]: invalid JSON") from exc
        if not isinstance(record, dict) or not str(record.get("id", "")).strip() or not isinstance(record.get("words"), list):
            raise DatasetError(f"prediction[{index}]: id and words are required")
        record_id = str(record["id"])
        if record_id in seen_ids:
            raise DatasetError(f"duplicate prediction id: {record_id}")
        seen_ids.add(record_id)
        previous_end = -1.0
        seen_word_keys: set[str] = set()
        for word_index, word in enumerate(record["words"]):
            if not isinstance(word, dict) or not str(word.get("canonicalWordKey", "")):
                raise DatasetError(f"prediction[{index}].words[{word_index}]: canonicalWordKey is required")
            word_key = str(word["canonicalWordKey"])
            if word_key in seen_word_keys:
                raise DatasetError(f"prediction[{index}].words[{word_index}]: duplicate canonicalWordKey")
            seen_word_keys.add(word_key)
            start_ms = word.get("startMs")
            end_ms = word.get("endMs")
            if (
                not _finite(start_ms)
                or not _finite(end_ms)
                or float(end_ms) <= float(start_ms)
                or float(start_ms) < previous_end
            ):
                raise DatasetError(f"prediction[{index}].words[{word_index}]: invalid or overlapping interval")
            previous_end = float(end_ms)
        records.append(record)
    return records


def _split_for_group(group_keys: set[str], train: float, validation: float) -> str:
    group = "\n".join(sorted(group_keys))
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
    if bucket < train:
        return "train"
    if bucket < train + validation:
        return "validation"
    return "test"


def dataset_digest(records: list[dict[str, Any]]) -> str:
    canonical = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_manifest(records: Iterable[dict[str, Any]], train: float = 0.8, validation: float = 0.1) -> dict[str, Any]:
    if train <= 0 or validation <= 0 or train + validation >= 1:
        raise DatasetError("train and validation proportions must leave a positive test split")
    rows = []
    for index, record in enumerate(records):
        validated = validate_record(record, index)
        rows.append({**validated})

    # Join rows that share either a reciter or identical audio bytes. This
    # creates held-out voices while also preventing duplicate recordings from
    # leaking across splits under inconsistent reciter metadata.
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        parent.setdefault(key, key)
        if parent[key] != key:
            parent[key] = find(parent[key])
        return parent[key]

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    row_keys: list[tuple[str, str]] = []
    for row in rows:
        reciter_key = f"reciter:{str(row['reciterId']).strip().casefold()}"
        audio_key = f"audio:{row['audio']['sha256']}"
        union(reciter_key, audio_key)
        row_keys.append((reciter_key, audio_key))

    component_rows: dict[str, list[int]] = {}
    component_keys: dict[str, set[str]] = {}
    for index, (reciter_key, audio_key) in enumerate(row_keys):
        root = find(reciter_key)
        component_rows.setdefault(root, []).append(index)
        component_keys.setdefault(root, set()).update((reciter_key, audio_key))

    for root, indexes in component_rows.items():
        explicit_splits = {str(rows[index]["split"]) for index in indexes if rows[index].get("split")}
        if len(explicit_splits) > 1:
            raise DatasetError("a reciter/audio group was explicitly assigned to multiple dataset splits")
        split = next(iter(explicit_splits)) if explicit_splits else _split_for_group(component_keys[root], train, validation)
        for index in indexes:
            rows[index]["split"] = split
    return {
        "schemaVersion": "alignment-dataset-v1",
        "datasetSha256": dataset_digest(rows),
        "recordCount": len(rows),
        "counts": {split: sum(1 for row in rows if row["split"] == split) for split in ("train", "validation", "test")},
        "records": rows,
    }


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def evaluate_predictions(references: Iterable[dict[str, Any]], predictions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    boundary_errors: list[float] = []
    confidences: list[float] = []
    expected_word_count = 0
    matched_word_count = 0
    unexpected_word_count = 0
    evaluated = 0
    by_mode: dict[str, dict[str, Any]] = {}
    by_reciter: dict[str, dict[str, Any]] = {}

    def add_to_stratum(strata: dict[str, dict[str, Any]], key: str, expected_count: int, matched_count: int, errors: list[float], has_prediction: bool) -> None:
        stratum = strata.setdefault(key, {
            "referenceRecords": 0,
            "predictedRecords": 0,
            "expectedWords": 0,
            "matchedWords": 0,
            "boundaryErrorsMs": [],
        })
        stratum["referenceRecords"] += 1
        stratum["predictedRecords"] += int(has_prediction)
        stratum["expectedWords"] += expected_count
        stratum["matchedWords"] += matched_count
        stratum["boundaryErrorsMs"].extend(errors)

    references = list(references)
    if not references:
        raise DatasetError("boundary evaluation references are empty")
    for index, reference in enumerate(references):
        validate_record(reference, index, require_word_spans=True)
    reference_ids = {str(reference["id"]) for reference in references}
    unexpected_record_ids = set(predictions) - reference_ids
    for reference in references:
        prediction = predictions.get(str(reference["id"]))
        expected = {word["canonicalWordKey"]: word for word in reference["words"]}
        actual = {word.get("canonicalWordKey"): word for word in (prediction or {}).get("words", [])}
        matched = [key for key in expected if key in actual]
        errors: list[float] = []
        expected_word_count += len(expected)
        matched_word_count += len(matched)
        unexpected_word_count += len(set(actual) - set(expected))
        evaluated += int(prediction is not None)
        for key in matched:
            errors.extend([
                abs(float(actual[key]["startMs"]) - float(expected[key]["startMs"])),
                abs(float(actual[key]["endMs"]) - float(expected[key]["endMs"])),
            ])
            if _finite(actual[key].get("confidence")):
                confidences.append(float(actual[key]["confidence"]))

        boundary_errors.extend(errors)
        add_to_stratum(by_mode, str(reference["mode"]), len(expected), len(matched), errors, prediction is not None)
        add_to_stratum(by_reciter, str(reference["reciterId"]), len(expected), len(matched), errors, prediction is not None)

    def finish_strata(strata: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for key, stratum in strata.items():
            errors = stratum.pop("boundaryErrorsMs")
            result[key] = {
                **stratum,
                "coverage": stratum["matchedWords"] / max(stratum["expectedWords"], 1),
                "boundaryMaeMs": statistics.mean(errors) if errors else None,
                "boundaryP50Ms": _percentile(errors, 0.50),
                "boundaryP95Ms": _percentile(errors, 0.95),
            }
        return result

    return {
        "evaluatedRecords": evaluated,
        "referenceRecords": len(references),
        "unexpectedRecords": len(unexpected_record_ids),
        "coverageMean": matched_word_count / max(expected_word_count, 1),
        "expectedWords": expected_word_count,
        "matchedWords": matched_word_count,
        "unexpectedWords": unexpected_word_count,
        "boundaryMaeMs": statistics.mean(boundary_errors) if boundary_errors else None,
        "boundaryP50Ms": _percentile(boundary_errors, 0.50),
        "boundaryP95Ms": _percentile(boundary_errors, 0.95),
        "confidenceMean": statistics.mean(confidences) if confidences else 0.0,
        "matchedBoundaries": len(boundary_errors),
        "byMode": finish_strata(by_mode),
        "byReciter": finish_strata(by_reciter),
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Validate and split AyahX alignment data")
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("input")
    prepare.add_argument("output")
    prepare.add_argument("--train", type=float, default=0.8)
    prepare.add_argument("--validation", type=float, default=0.1)
    evaluate = subparsers.add_parser("evaluate")
    evaluate.add_argument("manifest")
    evaluate.add_argument("predictions")
    evaluate.add_argument("output")
    evaluate.add_argument("--min-coverage", type=float, default=0.98)
    evaluate.add_argument("--max-boundary-mae-ms", type=float, default=120.0)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            result = build_manifest(read_jsonl(args.input), args.train, args.validation)
        else:
            manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
            if (
                not isinstance(manifest, dict)
                or manifest.get("schemaVersion") != "alignment-dataset-v1"
                or not isinstance(manifest.get("records"), list)
            ):
                raise DatasetError("evaluation input must be an alignment-dataset-v1 manifest")
            if manifest.get("recordCount") != len(manifest["records"]):
                raise DatasetError("manifest recordCount does not match records")
            for index, row in enumerate(manifest["records"]):
                validate_record(row, index)
            if manifest.get("datasetSha256") != dataset_digest(manifest["records"]):
                raise DatasetError("manifest datasetSha256 does not match records")
            test_records = [row for row in manifest["records"] if row.get("split") == "test"]
            if not test_records:
                raise DatasetError("manifest has no held-out test records")
            predictions = {str(row["id"]): row for row in read_predictions(args.predictions)}
            result = evaluate_predictions(test_records, predictions)
            result["passed"] = bool(
                result["evaluatedRecords"] == result["referenceRecords"]
                and result["unexpectedRecords"] == 0
                and result["coverageMean"] >= args.min_coverage
                and result["unexpectedWords"] == 0
                and result["boundaryMaeMs"] is not None
                and result["boundaryMaeMs"] <= args.max_boundary_mae_ms
            )
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 0 if args.command == "prepare" or result.get("passed") else 2
    except (DatasetError, OSError, json.JSONDecodeError) as exc:
        print(f"dataset_error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(_main())
