"""Optional Hugging Face CTC forced-alignment engine.

The engine is deliberately opt-in (`ALIGNMENT_CTC_MODEL_ID`). It performs
Viterbi alignment against the supplied Quran reference; it never divides a
verse duration by word count and it fails closed when the tokenizer/model
cannot represent the complete reference.
"""

from __future__ import annotations

import math
import os
import re
import threading
from typing import Any

try:
    from .contract import AlignmentRequest
except ImportError:  # pragma: no cover
    from contract import AlignmentRequest


_MODEL_LOCK = threading.Lock()
_MODEL_CACHE: tuple[Any, Any, Any, str] | None = None


def _arabic_for_alignment(value: str) -> str:
    # Keep the Quran text used for display untouched in the request. This
    # normalization is only for a model vocabulary that normally emits Arabic
    # letters without Uthmani marks.
    value = re.sub(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]", "", value)
    return value.replace("ٱ", "ا").replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ى", "ي")


def _load_model() -> tuple[Any, Any, Any, str]:
    global _MODEL_CACHE
    model_id = os.getenv("ALIGNMENT_CTC_MODEL_ID", "").strip()
    if not model_id:
        raise RuntimeError("MODEL_NOT_CONFIGURED")
    revision = os.getenv("ALIGNMENT_CTC_MODEL_REVISION", "").strip()
    if not revision:
        revision = "main" if os.getenv("NODE_ENV", "development") != "production" else ""
    if not revision:
        raise RuntimeError("CTC_MODEL_REVISION_REQUIRED")
    if os.getenv("NODE_ENV", "development") == "production" and revision.lower() in {"main", "master", "latest"}:
        raise RuntimeError("CTC_MODEL_REVISION_MUST_BE_PINNED")
    model_key = f"{model_id}@{revision}"
    with _MODEL_LOCK:
        if _MODEL_CACHE is not None and _MODEL_CACHE[3] == model_key:
            return _MODEL_CACHE
        try:
            import torch
            from transformers import AutoModelForCTC, AutoProcessor
        except ImportError as exc:  # pragma: no cover - base image is intentionally small
            raise RuntimeError("CTC_RUNTIME_DEPENDENCIES_NOT_INSTALLED") from exc
        processor = AutoProcessor.from_pretrained(model_id, revision=revision)
        model = AutoModelForCTC.from_pretrained(model_id, revision=revision)
        requested = os.getenv("ALIGNMENT_CTC_DEVICE", "auto").lower()
        if requested == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            device = requested
        model.to(device)
        model.eval()
        _MODEL_CACHE = (processor, model, torch, model_key)
        return _MODEL_CACHE


def _decode_audio(path: str) -> tuple[Any, int]:
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("CTC_AUDIO_DEPENDENCIES_NOT_INSTALLED") from exc
    try:
        audio, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    except Exception as exc:
        raise RuntimeError("MODEL_AUDIO_DECODE_FAILED") from exc
    if audio is None or len(audio) == 0:
        raise RuntimeError("MODEL_AUDIO_EMPTY")
    array = np.asarray(audio, dtype="float32")
    if array.ndim > 1:
        array = array.mean(axis=1)
    peak = float(np.max(np.abs(array))) if array.size else 0.0
    if not math.isfinite(peak) or peak <= 0:
        raise RuntimeError("MODEL_AUDIO_SILENT")
    return array, int(sample_rate)


def _resample(audio: Any, source_rate: int, target_rate: int) -> Any:
    if source_rate == target_rate:
        return audio
    try:
        import torch
        import torchaudio

        return torchaudio.functional.resample(torch.from_numpy(audio), source_rate, target_rate).numpy()
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("CTC_RESAMPLER_NOT_INSTALLED") from exc


def _token_groups(processor: Any, request: AlignmentRequest) -> tuple[list[int], list[tuple[int, int, str, int, int]]]:
    target_ids: list[int] = []
    groups: list[tuple[int, int, str, int, int]] = []
    tokenizer = getattr(processor, "tokenizer", None)
    if tokenizer is None:
        raise RuntimeError("CTC_TOKENIZER_REQUIRED")
    special_ids = set(getattr(tokenizer, "all_special_ids", []) or [])
    word_index = 0
    for ayah in sorted(request.reference.ayahs, key=lambda item: item.numberInSurah):
        for index, display_token in enumerate(ayah.text.split(), start=1):
            token = _arabic_for_alignment(display_token)
            encoded = tokenizer(token, add_special_tokens=False, return_attention_mask=False)
            ids = encoded.get("input_ids") if isinstance(encoded, dict) else getattr(encoded, "input_ids", None)
            if ids and isinstance(ids[0], list):
                ids = ids[0]
            ids = [int(value) for value in (ids or []) if int(value) not in special_ids]
            if not ids or any(token_id < 0 for token_id in ids):
                raise RuntimeError(f"CTC_TOKENIZATION_EMPTY:{ayah.numberInSurah}:{index}")
            start = len(target_ids)
            target_ids.extend(ids)
            groups.append((start, len(target_ids), f"{request.reference.surahNumber}:{ayah.numberInSurah}:{index}", ayah.numberInSurah, index))
            word_index += 1
    if not target_ids:
        raise RuntimeError("CTC_REFERENCE_EMPTY")
    return target_ids, groups


def _viterbi(logits: Any, target_ids: list[int], blank_id: int) -> tuple[list[int], list[float]]:
    import torch

    log_probs = torch.log_softmax(logits, dim=-1)
    extended = [blank_id]
    for token_id in target_ids:
        extended.extend([token_id, blank_id])
    states = len(extended)
    frames = int(log_probs.shape[0])
    if frames < len(target_ids):
        raise RuntimeError("CTC_AUDIO_TOO_SHORT_FOR_REFERENCE")
    max_cells = int(os.getenv("ALIGNMENT_CTC_MAX_TRELLIS_CELLS", str(20_000_000)))
    if max_cells < 1 or frames * states > max_cells:
        raise RuntimeError("CTC_ALIGNMENT_TOO_LARGE")
    neg_inf = torch.tensor(float("-inf"), device=log_probs.device)
    trellis = torch.full((frames, states), neg_inf, device=log_probs.device)
    trellis[0, 0] = log_probs[0, blank_id]
    if states > 1:
        trellis[0, 1] = log_probs[0, extended[1]]
    for frame in range(1, frames):
        previous = trellis[frame - 1]
        for state in range(states):
            best = previous[state]
            if state > 0:
                best = torch.maximum(best, previous[state - 1])
            if state > 1 and extended[state] != blank_id and extended[state] != extended[state - 2]:
                best = torch.maximum(best, previous[state - 2])
            trellis[frame, state] = best + log_probs[frame, extended[state]]
    final_state = states - 1
    if states > 1 and trellis[-1, states - 2] > trellis[-1, final_state]:
        final_state = states - 2
    if not torch.isfinite(trellis[-1, final_state]):
        raise RuntimeError("CTC_ALIGNMENT_PATH_NOT_FOUND")
    path = [0] * frames
    confidences = [0.0] * frames
    state = final_state
    for frame in range(frames - 1, -1, -1):
        path[frame] = state
        confidences[frame] = float(log_probs[frame, extended[state]].exp().detach().cpu())
        if frame == 0:
            break
        candidates = [(trellis[frame - 1, state], state)]
        if state > 0:
            candidates.append((trellis[frame - 1, state - 1], state - 1))
        if state > 1 and extended[state] != blank_id and extended[state] != extended[state - 2]:
            candidates.append((trellis[frame - 1, state - 2], state - 2))
        state = max(candidates, key=lambda item: float(item[0].detach().cpu()))[1]
    return path, confidences


def align(request: AlignmentRequest, audio_path: str | None = None) -> dict[str, Any]:
    if request.granularity != "word":
        raise RuntimeError("CTC_GRANULARITY_WORD_ONLY")
    processor, model, torch, model_id = _load_model()
    if not audio_path:
        audio_path = request.providerInput.get("workerAudioPath") if request.providerInput else None
    if not audio_path:
        raise RuntimeError("CTC_AUDIO_PATH_REQUIRED")
    audio, sample_rate = _decode_audio(audio_path)
    feature_extractor = getattr(processor, "feature_extractor", None)
    target_rate = int(getattr(feature_extractor, "sampling_rate", None) or 16_000)
    audio = _resample(audio, sample_rate, target_rate)
    target_ids, groups = _token_groups(processor, request)
    inputs = processor(audio, sampling_rate=target_rate, return_tensors="pt")
    input_values = getattr(inputs, "input_values", None)
    if input_values is None:
        raise RuntimeError("CTC_PROCESSOR_INPUT_VALUES_REQUIRED")
    input_values = input_values.to(next(model.parameters()).device)
    attention_mask = getattr(inputs, "attention_mask", None)
    if attention_mask is not None:
        attention_mask = attention_mask.to(input_values.device)
    with torch.no_grad():
        output = model(input_values=input_values, attention_mask=attention_mask)
    logits = output.logits[0]
    blank_id = getattr(getattr(processor, "tokenizer", None), "pad_token_id", None)
    if blank_id is None:
        blank_id = getattr(getattr(model, "config", None), "pad_token_id", None)
    if blank_id is None:
        raise RuntimeError("CTC_BLANK_TOKEN_NOT_CONFIGURED")
    path, frame_confidences = _viterbi(logits, target_ids, int(blank_id))
    frame_ms = (len(audio) / target_rate * 1000.0) / max(len(path), 1)
    words: list[dict[str, Any]] = []
    for start_token, end_token, key, ayah_number, word_index in groups:
        states = {2 * token_index + 1 for token_index in range(start_token, end_token)}
        frame_indices = [index for index, state in enumerate(path) if state in states]
        if not frame_indices:
            raise RuntimeError(f"CTC_WORD_PATH_MISSING:{key}")
        start_ms = frame_indices[0] * frame_ms
        end_ms = min((frame_indices[-1] + 1) * frame_ms, request.audio.durationMs)
        confidence = sum(frame_confidences[index] for index in frame_indices) / len(frame_indices)
        words.append({
            "canonicalWordKey": key,
            "ayahNumber": ayah_number,
            "wordIndex1Based": word_index,
            "displayToken": next(ayah.text.split()[word_index - 1] for ayah in request.reference.ayahs if ayah.numberInSurah == ayah_number),
            "normalizedAlignmentToken": _arabic_for_alignment(next(ayah.text.split()[word_index - 1] for ayah in request.reference.ayahs if ayah.numberInSurah == ayah_number)),
            "startMs": round(max(0.0, start_ms), 3),
            "endMs": round(max(start_ms + 1.0, end_ms), 3),
            "confidence": max(0.0, min(1.0, confidence)),
        })
    gaps: list[dict[str, Any]] = []
    if words and words[0]["startMs"] > 80:
        gaps.append({"startMs": 0.0, "endMs": words[0]["startMs"], "type": "intro"})
    for previous, current in zip(words, words[1:]):
        if current["startMs"] - previous["endMs"] >= 80:
            gaps.append({"startMs": previous["endMs"], "endMs": current["startMs"], "type": "waqf"})
    if words and request.audio.durationMs - words[-1]["endMs"] >= 80:
        gaps.append({"startMs": words[-1]["endMs"], "endMs": request.audio.durationMs, "type": "outro"})
    return {
        "providerId": "internal_ctc",
        "providerVersion": f"internal-ctc-v1:{model_id}"[:128],
        "sourceMethod": "ctc_forced_alignment",
        "providerVerified": False,
        "words": words,
        "gaps": gaps,
        "diagnostics": {
            "modelId": model_id,
            "modelRevision": os.getenv("ALIGNMENT_CTC_MODEL_REVISION", "main"),
            "sampleRate": target_rate,
            "frameCount": len(path),
            "frameDurationMs": frame_ms,
            "audioIdentity": "verified_by_worker",
        },
    }
