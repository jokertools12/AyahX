"""Shared JSON contract for the AyahX internal alignment worker.

The worker is intentionally stricter than a generic speech-to-text service:
every emitted word must have an explicit acoustic interval and a canonical
Quran key.  Missing words, guessed proportional offsets, and ambiguous
occurrences are rejected before the result can reach a renderer.
"""

from __future__ import annotations

import math
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Granularity = Literal["word", "letter", "phoneme"]
ProviderId = Literal["internal_ctc"]


def _finite(value: float) -> bool:
    return math.isfinite(value)


def _safe_text(value: str, max_length: int) -> str:
    value = value.strip()
    if not value or len(value) > max_length:
        raise ValueError("text is empty or too long")
    return value


class AudioRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contentHash: str = Field(min_length=8, max_length=128)
    durationMs: float = Field(gt=0, le=3_600_000)
    sampleRate: int | None = Field(default=None, ge=8_000, le=384_000)
    channels: int | None = Field(default=None, ge=1, le=8)
    sourceUrlOrAssetId: str = Field(min_length=1, max_length=2_048)

    @field_validator("contentHash")
    @classmethod
    def content_hash_is_safe(cls, value: str) -> str:
        # Test fixtures may use an asset label; production manifests should use
        # a lowercase SHA-256.  The Node boundary enforces the same distinction.
        if value.startswith("asset:"):
            return value
        if not re.fullmatch(r"[A-Fa-f0-9]{32,128}", value):
            raise ValueError("contentHash must be a hexadecimal digest or asset id")
        return value.lower()

    @field_validator("sourceUrlOrAssetId")
    @classmethod
    def source_is_not_executable(cls, value: str) -> str:
        if re.match(r"^(blob:|data:|javascript:|file:)", value, re.IGNORECASE):
            raise ValueError("unsafe audio source")
        if value.lower().startswith("http://"):
            raise ValueError("audio source must use HTTPS")
        if not (value.lower().startswith("https://") or value.lower().startswith("asset:")):
            raise ValueError("audio source must be HTTPS or asset:")
        return value


class ReferenceAyah(BaseModel):
    model_config = ConfigDict(extra="forbid")

    numberInSurah: int = Field(ge=1, le=300)
    text: str = Field(min_length=1, max_length=4_000)

    @field_validator("text")
    @classmethod
    def text_is_safe(cls, value: str) -> str:
        return _safe_text(value, 4_000)


class ReferenceSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surahNumber: int = Field(ge=1, le=114)
    startAyah: int = Field(ge=1, le=300)
    endAyah: int = Field(ge=1, le=300)
    ayahs: list[ReferenceAyah] = Field(min_length=1, max_length=300)
    quranTextVersion: str | None = Field(default=None, max_length=128)
    riwayah: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def contiguous_snapshot(self) -> "ReferenceSnapshot":
        if self.endAyah < self.startAyah:
            raise ValueError("invalid ayah range")
        expected = list(range(self.startAyah, self.endAyah + 1))
        actual = sorted(ayah.numberInSurah for ayah in self.ayahs)
        if actual != expected:
            raise ValueError("reference snapshot must cover every ayah exactly once")
        return self


class AlignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    providerId: ProviderId
    reciterId: str = Field(min_length=1, max_length=128)
    audio: AudioRef
    reference: ReferenceSnapshot
    granularity: Granularity = "word"
    providerInput: dict[str, Any] = Field(default_factory=dict)
    jobId: str | None = Field(default=None, max_length=128)


class WordSpan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonicalWordKey: str
    occurrenceId: str | None = None
    ayahNumber: int = Field(ge=1, le=300)
    wordIndex1Based: int = Field(ge=1, le=20_000)
    displayToken: str = ""
    normalizedAlignmentToken: str = ""
    startMs: float = Field(ge=0)
    endMs: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)
    flags: list[str] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def interval_is_valid(self) -> "WordSpan":
        if not (_finite(self.startMs) and _finite(self.endMs) and self.endMs > self.startMs):
            raise ValueError("word interval must be finite and increasing")
        if not re.fullmatch(r"\d+:\d+:\d+", self.canonicalWordKey):
            raise ValueError("invalid canonical Quran word key")
        return self


class Subspan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parentOccurrenceId: str
    label: str = Field(default="", max_length=120)
    startMs: float = Field(ge=0)
    endMs: float = Field(gt=0)
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def interval_is_valid(self) -> "Subspan":
        if not (_finite(self.startMs) and _finite(self.endMs) and self.endMs > self.startMs):
            raise ValueError("subspan interval must be finite and increasing")
        return self


class Gap(BaseModel):
    model_config = ConfigDict(extra="forbid")

    startMs: float = Field(ge=0)
    endMs: float = Field(gt=0)
    type: Literal["silence", "waqf", "breath", "intro", "outro"]

    @model_validator(mode="after")
    def interval_is_valid(self) -> "Gap":
        if self.endMs <= self.startMs:
            raise ValueError("gap interval must be increasing")
        return self


class AlignmentResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    providerId: ProviderId
    providerVersion: str = Field(min_length=1, max_length=128)
    sourceMethod: str = Field(min_length=1, max_length=128)
    providerVerified: bool = False
    words: list[WordSpan] = Field(min_length=1, max_length=20_000)
    letters: list[Subspan] = Field(default_factory=list)
    phonemes: list[Subspan] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


def expected_word_keys(reference: ReferenceSnapshot) -> list[str]:
    keys: list[str] = []
    for ayah in sorted(reference.ayahs, key=lambda item: item.numberInSurah):
        for index, _token in enumerate(ayah.text.split(), start=1):
            keys.append(f"{reference.surahNumber}:{ayah.numberInSurah}:{index}")
    return keys
