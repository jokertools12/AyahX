"""Optional Modal GPU entry point for the same FastAPI worker contract.

Deploy only after an approved model checkpoint and a Modal secret containing
ALIGNMENT_WORKER_SHARED_TOKEN are available:

    modal deploy services/alignment-worker/modal_app.py

The web endpoint remains the same `/v1/align` contract used by the Node API;
Modal is only the execution host for the explicitly configured CTC engine.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import modal


ROOT = Path(__file__).resolve().parent
secret_name = os.getenv("MODAL_ALIGNMENT_SECRET_NAME", "ayahx-alignment-worker")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install_from_requirements(str(ROOT / "requirements-ctc.txt"))
    .pip_install("fastapi>=0.115,<1", "uvicorn[standard]>=0.34,<1", "pydantic>=2.10,<3", "httpx>=0.28,<1")
    .add_local_dir(str(ROOT), remote_path="/root/ayahx-alignment")
)

app = modal.App("ayahx-alignment-worker")


@app.function(
    image=image,
    gpu=os.getenv("MODAL_ALIGNMENT_GPU", "A10G"),
    timeout=900,
    scaledown_window=300,
    secrets=[modal.Secret.from_name(secret_name)],
)
@modal.asgi_app()
def web():
    sys.path.insert(0, "/root/ayahx-alignment")
    os.environ.setdefault("ALIGNMENT_ENGINE_MODULE", "ctc_engine:align")
    from app import app as fastapi_app

    return fastapi_app
