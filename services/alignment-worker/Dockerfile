FROM python:3.12-slim

ARG INSTALL_CTC=0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ALIGNMENT_WORKER_HOST=0.0.0.0 \
    ALIGNMENT_WORKER_PORT=8080

WORKDIR /app
COPY requirements.txt requirements-ctc.txt ./
RUN pip install --no-cache-dir -r requirements.txt
RUN if [ "$INSTALL_CTC" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 && \
      rm -rf /var/lib/apt/lists/* && \
      pip install --no-cache-dir -r requirements-ctc.txt; \
    fi
COPY . ./

EXPOSE 8080
# Railway injects PORT; keeping 8080 as a local default makes the same image
# useful in a laptop smoke test and prevents a platform port mismatch.
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]
