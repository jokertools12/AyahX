"""Fine-tune an Arabic CTC model on the governed AyahX alignment manifest.

This is an opt-in GPU job, not part of the web worker image. It consumes only
local, already-approved records emitted by ``dataset_tools.py`` and refuses to
start when required recitation modes are absent. The resulting checkpoint is
still an inference provider (`providerVerified=false`) until held-out review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any

from dataset_tools import DatasetError, MODES, dataset_digest, read_jsonl, validate_record


def normalize_transcript(text: str) -> str:
    """Normalize only the training transcript; display Quran text is untouched."""
    text = re.sub(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]", "", text)
    return text.replace("ٱ", "ا").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")


def load_manifest(path: str | Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != "alignment-dataset-v1" or not isinstance(payload.get("records"), list):
        raise DatasetError("training input must be an alignment-dataset-v1 manifest")
    for index, record in enumerate(payload["records"]):
        validate_record(record, index)
    if payload.get("recordCount") != len(payload["records"]):
        raise DatasetError("manifest recordCount does not match records")
    if payload.get("datasetSha256") != dataset_digest(payload["records"]):
        raise DatasetError("manifest datasetSha256 does not match records")
    return payload


def training_rows(manifest: dict[str, Any], required_modes: set[str]) -> list[dict[str, Any]]:
    rows = [row for row in manifest["records"] if row.get("split") == "train"]
    if not rows:
        raise DatasetError("training split is empty")
    available = {str(row.get("mode")) for row in rows}
    missing = sorted(required_modes - available)
    if missing:
        raise DatasetError(f"training split is missing required modes: {', '.join(missing)}")
    counts = Counter(str(row["mode"]) for row in rows)
    target = max(counts.values())
    balanced: list[dict[str, Any]] = []
    for mode in sorted(counts):
        mode_rows = [row for row in rows if row["mode"] == mode]
        # Deterministic oversampling balances recitation styles without
        # duplicating bytes into the validation/test split.
        for index in range(target):
            balanced.append(mode_rows[index % len(mode_rows)])
    return balanced


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _audio_path(record: dict[str, Any]) -> Path:
    raw = record.get("audio", {}).get("path")
    if not isinstance(raw, str) or not raw.strip():
        raise DatasetError(f"{record.get('id', 'record')}: audio.path is required for training")
    path = Path(raw).resolve()
    if not path.is_file():
        raise DatasetError(f"{record.get('id', 'record')}: audio file is missing")
    expected = str(record["audio"]["sha256"]).lower()
    if sha256_file(path) != expected:
        raise DatasetError(f"{record.get('id', 'record')}: audio hash mismatch")
    return path


def _transcript(record: dict[str, Any]) -> str:
    return " ".join(normalize_transcript(str(ayah["text"])) for ayah in sorted(record["reference"]["ayahs"], key=lambda item: int(item["numberInSurah"])))


def run_training(args: argparse.Namespace) -> dict[str, Any]:
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from transformers import AutoModelForCTC, AutoProcessor, Trainer, TrainingArguments
    except ImportError as exc:  # pragma: no cover - GPU image only
        raise RuntimeError("CTC_TRAINING_DEPENDENCIES_NOT_INSTALLED") from exc

    manifest = load_manifest(args.manifest)
    required_modes = {value for value in args.required_modes.split(",") if value}
    unknown_modes = required_modes - MODES
    if unknown_modes:
        raise DatasetError(f"unknown required modes: {', '.join(sorted(unknown_modes))}")
    train_records = training_rows(manifest, required_modes)
    validation_records = [row for row in manifest["records"] if row.get("split") == "validation"]
    if not validation_records:
        raise DatasetError("validation split is empty")

    processor = AutoProcessor.from_pretrained(args.model_id, revision=args.revision)
    model = AutoModelForCTC.from_pretrained(args.model_id, revision=args.revision)
    feature_rate = int(getattr(getattr(processor, "feature_extractor", None), "sampling_rate", None) or 16_000)

    class AudioTextDataset(torch.utils.data.Dataset):
        def __init__(self, records: list[dict[str, Any]]) -> None:
            self.records = records

        def __len__(self) -> int:
            return len(self.records)

        def __getitem__(self, index: int) -> dict[str, Any]:
            record = self.records[index]
            audio, sample_rate = sf.read(_audio_path(record), dtype="float32", always_2d=False)
            audio = np.asarray(audio, dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sample_rate != feature_rate:
                try:
                    import torchaudio
                    audio = torchaudio.functional.resample(torch.from_numpy(audio), sample_rate, feature_rate).numpy()
                except ImportError as exc:
                    raise RuntimeError("CTC_RESAMPLER_NOT_INSTALLED") from exc
            inputs = processor(audio, sampling_rate=feature_rate)
            with processor.as_target_processor():
                labels = processor(_transcript(record)).input_ids
            return {
                "input_values": inputs["input_values"][0],
                "labels": labels,
                "mode": record["mode"],
                "id": record["id"],
            }

    class Collator:
        def __call__(self, features: list[dict[str, Any]]) -> dict[str, Any]:
            inputs = [{"input_values": feature["input_values"]} for feature in features]
            batch = processor.pad(inputs, padding=True, return_tensors="pt")
            with processor.as_target_processor():
                labels = processor.pad([{"input_ids": feature["labels"]} for feature in features], padding=True, return_tensors="pt")
            batch["labels"] = labels["input_ids"].masked_fill(labels.attention_mask.ne(1), -100)
            return batch

    model.config.ctc_loss_reduction = "mean"
    if processor.tokenizer.pad_token_id is None:
        raise RuntimeError("CTC_PAD_TOKEN_NOT_CONFIGURED")
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    if args.freeze_feature_encoder and hasattr(model, "freeze_feature_encoder"):
        model.freeze_feature_encoder()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    training_kwargs: dict[str, Any] = dict(
        output_dir=str(output_dir),
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        num_train_epochs=args.epochs,
        save_strategy="epoch",
        logging_strategy="steps",
        logging_steps=10,
        report_to=[],
        fp16=bool(args.fp16 and torch.cuda.is_available()),
        remove_unused_columns=False,
    )
    # Transformers renamed this argument; support both versions without
    # silently dropping evaluation.
    import inspect
    if "eval_strategy" in inspect.signature(TrainingArguments).parameters:
        training_kwargs["eval_strategy"] = "epoch"
    else:
        training_kwargs["evaluation_strategy"] = "epoch"
    train_args = TrainingArguments(**training_kwargs)
    trainer = Trainer(
        model=model,
        args=train_args,
        train_dataset=AudioTextDataset(train_records),
        eval_dataset=AudioTextDataset(validation_records),
        data_collator=Collator(),
        processing_class=processor,
    )
    trainer.train(resume_from_checkpoint=args.resume_from_checkpoint or None)
    trainer.save_model(str(output_dir))
    processor.save_pretrained(str(output_dir))
    checkpoint_digest = hashlib.sha256()
    for checkpoint_file in sorted(path for path in output_dir.rglob("*") if path.is_file()):
        checkpoint_digest.update(str(checkpoint_file.relative_to(output_dir)).encode("utf-8"))
        checkpoint_digest.update(checkpoint_file.read_bytes())
    metadata = {
        "schemaVersion": "alignment-training-run-v1",
        "datasetSha256": manifest.get("datasetSha256"),
        "modelId": args.model_id,
        "modelRevision": args.revision,
        "requiredModes": sorted(required_modes),
        "balancedTrainCounts": dict(Counter(row["mode"] for row in train_records)),
        "validationCount": len(validation_records),
        "providerVerified": False,
        "checkpointSha256": checkpoint_digest.hexdigest(),
    }
    (output_dir / "training-run.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description="Train the governed AyahX CTC adapter")
    parser.add_argument("manifest")
    parser.add_argument("output_dir")
    parser.add_argument("--model-id", default=os.getenv("ALIGNMENT_CTC_MODEL_ID", ""))
    parser.add_argument("--revision", default=os.getenv("ALIGNMENT_CTC_MODEL_REVISION", "main"))
    parser.add_argument("--required-modes", default="murattal,mujawwad,tarteel,tajweed")
    parser.add_argument("--epochs", type=float, default=5.0)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--eval-batch-size", type=int, default=4)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--no-freeze-feature-encoder", dest="freeze_feature_encoder", action="store_false", default=True)
    parser.add_argument("--resume-from-checkpoint", default="")
    args = parser.parse_args()
    if not args.model_id:
        parser.error("--model-id or ALIGNMENT_CTC_MODEL_ID is required")
    try:
        print(json.dumps(run_training(args), ensure_ascii=False, indent=2))
        return 0
    except (DatasetError, RuntimeError, OSError, ValueError) as exc:
        print(f"training_error: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
