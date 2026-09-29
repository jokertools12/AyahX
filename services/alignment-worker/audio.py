"""Authenticated audio materialization for the internal alignment worker.

The Node API already validates provider inputs, but the worker is a separate
trust boundary. It therefore resolves the source itself, follows only
allowlisted HTTPS redirects, streams a bounded number of bytes, and compares
the resulting SHA-256 with the request before a model can run.
"""

from __future__ import annotations

import hashlib
import ipaddress
import os
import re
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import urljoin, urlparse

import httpx

try:
    from .contract import AlignmentRequest
except ImportError:  # pragma: no cover - supports `uvicorn app:app`
    from contract import AlignmentRequest


MAX_AUDIO_BYTES = int(os.getenv("ALIGNMENT_MAX_AUDIO_BYTES", str(96 * 1024 * 1024)))
DEFAULT_ALLOWED_HOSTS = {
    "audio.qurancdn.com",
    "verses.quran.com",
    "download.quranicaudio.com",
    "everyayah.com",
    "www.everyayah.com",
}


class AudioMaterializationError(RuntimeError):
    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


def allowed_hosts() -> set[str]:
    configured = os.getenv("ALIGNMENT_AUDIO_ALLOWED_HOSTS", "")
    values = {part.strip().lower().rstrip(".") for part in configured.split(",") if part.strip()}
    return values or DEFAULT_ALLOWED_HOSTS


def _host_allowed(hostname: str) -> bool:
    host = hostname.lower().rstrip(".")
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in allowed_hosts())


def _is_private_host(hostname: str) -> bool:
    host = hostname.lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain", "0.0.0.0", "::1"}:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)


def _checked_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise AudioMaterializationError("AUDIO_SOURCE_HTTPS_REQUIRED")
    if _is_private_host(parsed.hostname) or not _host_allowed(parsed.hostname):
        raise AudioMaterializationError("AUDIO_SOURCE_HOST_NOT_ALLOWED")
    if parsed.username or parsed.password:
        raise AudioMaterializationError("AUDIO_SOURCE_CREDENTIALS_NOT_ALLOWED")
    return value


def _asset_path(source: str) -> Path:
    raw = source[len("asset:"):]
    if not raw or "\x00" in raw:
        raise AudioMaterializationError("AUDIO_ASSET_ID_INVALID")
    root = Path(os.getenv("ALIGNMENT_AUDIO_ASSET_ROOT", "/data/audio")).resolve()
    candidate = (root / raw).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise AudioMaterializationError("AUDIO_ASSET_PATH_TRAVERSAL") from exc
    if not candidate.is_file():
        raise AudioMaterializationError("AUDIO_ASSET_NOT_FOUND")
    return candidate


def _expected_sha256(value: str) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{64}", value or ""):
        raise AudioMaterializationError("AUDIO_CONTENT_HASH_REQUIRED")
    return value.lower()


async def _download(url: str, target: Path) -> int:
    current = _checked_url(url)
    timeout = httpx.Timeout(float(os.getenv("ALIGNMENT_AUDIO_TIMEOUT_SECONDS", "90")), connect=15.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, headers={"Accept": "audio/*,application/octet-stream;q=0.8,*/*;q=0.1", "User-Agent": "AyahX alignment worker"}) as client:
        for _ in range(4):
            async with client.stream("GET", current) as response:
                if 300 <= response.status_code < 400:
                    location = response.headers.get("location")
                    if not location:
                        raise AudioMaterializationError("AUDIO_REDIRECT_INVALID")
                    current = _checked_url(urljoin(current, location))
                    continue
                if response.status_code < 200 or response.status_code >= 300:
                    raise AudioMaterializationError(f"AUDIO_FETCH_HTTP_{response.status_code}")
                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
                    raise AudioMaterializationError("AUDIO_TOO_LARGE")
                size = 0
                with target.open("wb") as handle:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_AUDIO_BYTES:
                            raise AudioMaterializationError("AUDIO_TOO_LARGE")
                        handle.write(chunk)
                if size == 0:
                    raise AudioMaterializationError("AUDIO_EMPTY")
                return size
        raise AudioMaterializationError("AUDIO_TOO_MANY_REDIRECTS")


def _copy_asset(source: Path, target: Path) -> int:
    size = source.stat().st_size
    if size <= 0:
        raise AudioMaterializationError("AUDIO_EMPTY")
    if size > MAX_AUDIO_BYTES:
        raise AudioMaterializationError("AUDIO_TOO_LARGE")
    with source.open("rb") as src, target.open("wb") as dst:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            dst.write(chunk)
    return size


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


@asynccontextmanager
async def materialize_audio(request: AlignmentRequest) -> AsyncIterator[Path]:
    """Yield a private temporary audio path whose bytes match the request hash."""

    expected = _expected_sha256(request.audio.contentHash)
    with tempfile.TemporaryDirectory(prefix="ayahx-alignment-") as directory:
        target = Path(directory) / "audio.bin"
        source = request.audio.sourceUrlOrAssetId
        if source.lower().startswith("asset:"):
            _copy_asset(_asset_path(source), target)
        else:
            await _download(source, target)
        actual = _hash_file(target)
        if actual != expected:
            raise AudioMaterializationError("AUDIO_CONTENT_HASH_MISMATCH")
        yield target
