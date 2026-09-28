"""FastAPI control plane for AyahX internal CTC alignment.

This service is intentionally an adapter, not a fake aligner. It only emits a
result when an explicitly configured engine (module, command, or CTC model) has
returned every word interval. With no real engine it responds with a stable
503 code, so the Node API cannot silently fall back to proportional timing.
"""

from __future__ import annotations

import hmac
import importlib
import inspect
import json
import os
import shlex
import subprocess
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse

try:
    from .audio import AudioMaterializationError, materialize_audio
    from .contract import AlignmentRequest, AlignmentResult, expected_word_keys
except ImportError:  # pragma: no cover - supports `uvicorn app:app`
    from audio import AudioMaterializationError, materialize_audio
    from contract import AlignmentRequest, AlignmentResult, expected_word_keys


MAX_REQUEST_BYTES = int(os.getenv("ALIGNMENT_MAX_REQUEST_BYTES", str(12 * 1024 * 1024)))
Engine = Callable[..., Any]


class WorkerError(RuntimeError):
    def __init__(self, code: str, message: str | None = None, status: int = 503) -> None:
        self.code = code
        self.status = status
        super().__init__(message or code)


@dataclass
class WorkerState:
    engine: Engine | None = None
    engine_name: str = "none"
    configuration_error: str | None = None

    @property
    def configured(self) -> bool:
        return self.engine is not None and self.configuration_error is None


state = WorkerState()


def _load_callable(spec: str) -> Engine:
    module_name, separator, attribute = spec.partition(":")
    if not separator or not module_name or not attribute:
        raise WorkerError("ENGINE_MODULE_SPEC_INVALID", status=500)
    module = importlib.import_module(module_name)
    value = getattr(module, attribute, None)
    if not callable(value):
        raise WorkerError("ENGINE_CALLABLE_NOT_FOUND", status=500)
    return value


class CommandEngine:
    def __init__(self, command: str) -> None:
        try:
            self.argv = shlex.split(command, posix=os.name != "nt")
        except ValueError as exc:
            raise WorkerError("ENGINE_COMMAND_INVALID", str(exc), 500) from exc
        if not self.argv:
            raise WorkerError("ENGINE_COMMAND_INVALID", status=500)

    def __call__(self, request: AlignmentRequest, audio_path: str) -> dict[str, Any]:
        payload = request.model_dump(mode="json")
        payload["providerInput"] = {**payload.get("providerInput", {}), "workerAudioPath": audio_path}
        timeout = float(os.getenv("ALIGNMENT_ENGINE_TIMEOUT_SECONDS", "300"))
        try:
            completed = subprocess.run(
                self.argv,
                input=json.dumps(payload, ensure_ascii=False),
                text=True,
                capture_output=True,
                timeout=timeout,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise WorkerError("ENGINE_TIMEOUT") from exc
        except OSError as exc:
            raise WorkerError("ENGINE_EXECUTION_FAILED", str(exc)) from exc
        if completed.returncode != 0:
            raise WorkerError("ENGINE_PROCESS_FAILED", status=502)
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise WorkerError("ENGINE_OUTPUT_NOT_JSON", status=502) from exc
        return value.get("result", value) if isinstance(value, dict) else value


def configure_engine() -> None:
    """Resolve an explicit engine without downloading model weights at import time."""

    state.engine = None
    state.engine_name = "none"
    state.configuration_error = None
    module_spec = os.getenv("ALIGNMENT_ENGINE_MODULE", "").strip()
    command = os.getenv("ALIGNMENT_ENGINE_COMMAND", "").strip()
    model_id = os.getenv("ALIGNMENT_CTC_MODEL_ID", "").strip()
    try:
        if module_spec:
            state.engine = _load_callable(module_spec)
            state.engine_name = module_spec
        elif command:
            state.engine = CommandEngine(command)
            state.engine_name = "command"
        elif model_id:
            try:
                from .ctc_engine import align as ctc_align
            except ImportError:  # pragma: no cover
                from ctc_engine import align as ctc_align
            state.engine = ctc_align
            state.engine_name = f"ctc:{model_id}"
        else:
            state.configuration_error = "MODEL_NOT_CONFIGURED"
    except WorkerError as exc:
        state.configuration_error = exc.code
    except Exception:
        state.configuration_error = "ENGINE_IMPORT_FAILED"


def _token_configured() -> bool:
    token = os.getenv("ALIGNMENT_WORKER_SHARED_TOKEN", "").strip()
    if token:
        return True
    return os.getenv("ALIGNMENT_ALLOW_UNAUTHENTICATED", "false").lower() == "true" and os.getenv("NODE_ENV", "development") != "production"


def _authorized(authorization: str | None) -> bool:
    expected = os.getenv("ALIGNMENT_WORKER_SHARED_TOKEN", "").strip()
    if not expected:
        return os.getenv("ALIGNMENT_ALLOW_UNAUTHENTICATED", "false").lower() == "true" and os.getenv("NODE_ENV", "development") != "production"
    if not authorization or not authorization.lower().startswith("bearer "):
        return False
    return hmac.compare_digest(authorization[7:].strip(), expected)


def _error(error: WorkerError, status: int | None = None) -> JSONResponse:
    return JSONResponse(status_code=status or error.status, content={"error": error.code, "code": error.code, "message": str(error)})


def _validate_result(result: Any, request: AlignmentRequest) -> AlignmentResult:
    try:
        parsed = AlignmentResult.model_validate(result)
    except Exception as exc:
        raise WorkerError("ENGINE_RESULT_INVALID", status=502) from exc
    if parsed.providerId != "internal_ctc":
        raise WorkerError("ENGINE_PROVIDER_ID_MISMATCH", status=502)
    expected = expected_word_keys(request.reference)
    expected_set = set(expected)
    actual = [word.canonicalWordKey for word in parsed.words]
    if len(actual) != len(expected) or actual != expected or len(set(actual)) != len(actual) or set(actual) != expected_set:
        raise WorkerError("ENGINE_WORD_COVERAGE_INCOMPLETE", status=502)
    previous_end = -1.0
    for word in parsed.words:
        if word.endMs > request.audio.durationMs + 150:
            raise WorkerError("ENGINE_INTERVAL_OUT_OF_BOUNDS", status=502)
        if word.startMs < previous_end:
            raise WorkerError("ENGINE_INTERVALS_NOT_MONOTONIC", status=502)
        if word.ayahNumber != int(word.canonicalWordKey.split(":")[1]) or word.wordIndex1Based != int(word.canonicalWordKey.split(":")[2]):
            raise WorkerError("ENGINE_CANONICAL_KEY_MISMATCH", status=502)
        previous_end = word.endMs
    occurrences = {word.occurrenceId for word in parsed.words if word.occurrenceId}
    for span in [*parsed.letters, *parsed.phonemes]:
        if span.parentOccurrenceId not in occurrences:
            raise WorkerError("ENGINE_SUBSPAN_PARENT_MISSING", status=502)
    # Internal CTC is an inference provider; human review or a separate
    # attested dataset is required before it can drive a word animation.
    parsed.providerVerified = False
    parsed.diagnostics = {
        **parsed.diagnostics,
        "workerContract": "internal-ctc-v1",
        "audioContentHashVerified": True,
        "wordCoverageVerified": True,
    }
    return parsed


async def _run_engine(request: AlignmentRequest, audio_path: str) -> AlignmentResult:
    if not state.configured or state.engine is None:
        raise WorkerError(state.configuration_error or "MODEL_NOT_CONFIGURED")
    engine = state.engine
    engine_request = request.model_copy(update={
        "providerInput": {**request.providerInput, "workerAudioPath": audio_path},
    })
    try:
        if "audio_path" in inspect.signature(engine).parameters:
            value = engine(engine_request, audio_path=audio_path)
        else:
            # The module contract receives a model plus the temporary path in
            # providerInput.workerAudioPath; no hidden fallback is attempted.
            value = engine(engine_request)
        if inspect.isawaitable(value):
            value = await value
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError("ENGINE_RUNTIME_FAILED", str(exc), 502) from exc
    return _validate_result(value, request)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_engine()
    yield


app = FastAPI(title="AyahX Internal Alignment Worker", version="1.0.0", lifespan=lifespan)


@app.exception_handler(WorkerError)
async def worker_error_handler(_request: Request, error: WorkerError) -> JSONResponse:
    return _error(error, error.status)


async def require_worker_auth(authorization: str | None = Header(default=None)) -> None:
    if not _token_configured():
        raise WorkerError("WORKER_AUTH_NOT_CONFIGURED", status=503)
    if not _authorized(authorization):
        raise WorkerError("WORKER_UNAUTHORIZED", status=401)


@app.get("/health/live")
async def health_live() -> dict[str, Any]:
    return {"status": "alive", "service": "ayahx-alignment-worker"}


@app.get("/health/ready")
async def health_ready() -> JSONResponse:
    if not _token_configured():
        return _error(WorkerError("WORKER_AUTH_NOT_CONFIGURED"), 503)
    if not state.configured:
        return _error(WorkerError(state.configuration_error or "MODEL_NOT_CONFIGURED"), 503)
    return JSONResponse(status_code=200, content={"status": "ready", "engine": state.engine_name})


@app.post("/v1/align")
async def align(request: Request, _auth: None = Depends(require_worker_auth)) -> JSONResponse:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_REQUEST_BYTES:
        return _error(WorkerError("ALIGNMENT_REQUEST_TOO_LARGE", status=413), 413)
    try:
        raw = await request.json()
        if len(json.dumps(raw, ensure_ascii=False).encode("utf-8")) > MAX_REQUEST_BYTES:
            raise WorkerError("ALIGNMENT_REQUEST_TOO_LARGE", status=413)
        parsed_request = AlignmentRequest.model_validate(raw)
        async with materialize_audio(parsed_request) as audio_path:
            result = await _run_engine(parsed_request, str(audio_path))
        return JSONResponse(status_code=200, content={"result": result.model_dump(mode="json")})
    except AudioMaterializationError as exc:
        return _error(WorkerError(exc.code, status=400), 400)
    except WorkerError as exc:
        return _error(exc, exc.status)
    except Exception as exc:
        # Do not echo Pydantic input or provider data to the caller.
        return _error(WorkerError("ALIGNMENT_REQUEST_INVALID", status=400), 400)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host=os.getenv("ALIGNMENT_WORKER_HOST", "0.0.0.0"), port=int(os.getenv("ALIGNMENT_WORKER_PORT", "8080")))
