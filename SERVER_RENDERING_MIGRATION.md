# Server-Side Deterministic Video Rendering Migration Guide

This document specifies the operational, configuration, and architectural details of the deterministic server-side video rendering pipeline in **Ayah Clip Maker**.

---

## 1. System Overview

The deterministic server-side rendering pipeline replaces client-side real-time screen/canvas recording (`canvas.captureStream()` + `MediaRecorder`) with a server-orchestrated offline rendering worker:

1. **Client Submission:** The frontend sends a versioned, strictly typed `RenderManifest` (`schemaVersion: "1.0.0"`) to `POST /api/render-jobs`.
2. **Catalog & Security Resolution:** The server resolves trusted Quran recitation audio, fonts, and backgrounds, validating against SSRF and path traversal allowlists.
3. **Deterministic Canvas Compositor:** Headless Chromium renders visual frames mathematically at exact intervals:
   $$\text{frameTimeSeconds} = \frac{\text{frameIndex}}{\text{fps}}$$
4. **Native FFmpeg Muxing:** Frames are piped directly via Node.js stream (`-f image2pipe -vcodec mjpeg`) into native FFmpeg, which encodes an H.264/AAC MP4 with `-movflags +faststart`.
5. **Quality Probe & Verification:** Every output artifact is validated with `ffprobe` to ensure compliance with container, CFR framerate, and audio/video synchronization specifications.
6. **Delivery:** The client polls job progress and streams the validated MP4 upon completion.

---

## 2. Environment Variables

Configure these environment variables in `.env` (or via container environment configuration):

| Variable | Type | Default | Description |
|---|---|---|---|
| `CHROME_BIN` | String (Path) | Auto-discovered | Path to Chrome/Chromium executable (e.g. `/usr/bin/google-chrome` or `C:\Program Files\Google\Chrome\Application\chrome.exe`). |
| `PUPPETEER_EXECUTABLE_PATH` | String (Path) | Auto-discovered | Fallback executable path used by Puppeteer if `CHROME_BIN` is unset. |
| `MAX_CONCURRENT_RENDERS` | Number | `1` (dev) / `2-4` (prod) | Maximum number of render jobs processed concurrently per server process to protect CPU and memory. |
| `RENDER_STORAGE_DIR` | String (Path) | `uploads/renders` | Root directory for storing rendered MP4 artifacts. |
| `FFMPEG_PATH` | String (Path) | `ffmpeg-static` | Optional override for the native FFmpeg executable. |
| `FFPROBE_PATH` | String (Path) | `ffprobe-static` | Optional override for the native ffprobe executable. |

---

## 3. Local Development Setup

### Prerequisites
- Node.js >= 20.x
- MySQL 8.x
- Google Chrome or Microsoft Edge installed on the local operating system

### Setup Steps
1. Install dependencies:
   ```bash
   npm install
   ```
2. Verify that Chrome is detectable:
   - On Windows, Chrome in standard paths (`C:\Program Files\Google\Chrome\Application\chrome.exe`) or Edge is detected automatically.
   - If installed in a non-standard directory, set `CHROME_BIN` in `.env`:
     ```env
     CHROME_BIN="C:\\Custom\\Chrome\\chrome.exe"
     ```
3. Verify database migration:
   - On server boot (`npm run dev:server` or `npm start`), `ensureRenderJobsTable()` automatically checks and provisions the `render_jobs` table and indexes.
4. Run deterministic rendering tests:
   ```bash
   npx vitest run src/test/deterministicRenderer.test.ts
   ```

---

## 4. Production Deployment & Worker Operation

### Hardware Sizing Guidelines
Headless Chromium + FFmpeg encoding is a compute- and memory-intensive workload:
- **Per Worker Instance:** ~1.5 to 2.0 vCPUs and ~1.5 GB RAM per concurrent render stream.
- **Recommended Node Size:** Minimum 4 vCPUs / 8 GB RAM (recommended: `MAX_CONCURRENT_RENDERS=2`).
- **Container Sandbox:** In Docker containers, ensure the container has:
  ```dockerfile
  RUN apt-get update && apt-get install -y \
      chromium \
      fonts-noto-core \
      fonts-noto-extra \
      ca-certificates
  ENV CHROME_BIN=/usr/bin/chromium
  ```
  And configure shared memory: `--shm-size=2gb` or use Puppeteer's `--disable-dev-shm-usage` (enabled by default in our renderer).

### Worker Lifecycle & Crash Recovery
- **Leasing:** Workers lease queued jobs with an atomic MySQL update:
  ```sql
  UPDATE render_jobs
  SET status = 'running', stage = 'بدء العرض والتوليد...', progress = 0.00, updated_at = NOW()
  WHERE id = ? AND status = 'queued';
  ```
- **Stale Job Recovery:** On server startup, `renderJobQueue.recoverStaleJobs()` inspects all jobs left in `'running'` status. If `retry_count < max_retries`, they are automatically re-queued for processing; otherwise, they are marked as `'failed'`.
- **Cancellation:** If a user cancels a job via `POST /api/render-jobs/:id/cancel`, the server aborts the render controller `AbortSignal`, terminates headless Chromium, kills the FFmpeg child process, and unlinks the partial output file.

---

## 5. Storage Configuration

### Local Storage Adapter (Current)
Rendered MP4 files are saved to:
```
uploads/renders/{userId}/{jobId}.mp4
```
- Access is gated behind `GET /api/render-jobs/:id/download`, which validates user authentication and ownership before streaming the file.
- Direct static file execution and path traversal outside `uploads/renders` are strictly forbidden.

### Production Object Storage (S3 / Cloudflare R2 / GCS)
For multi-instance deployments behind a load balancer:
1. Replace local file write in `deterministicVideoRenderer.ts` with a multipart upload to S3/R2.
2. `GET /api/render-jobs/:id/download` will issue an authenticated 302 redirect to a short-lived (15-minute) presigned S3/R2 download URL.

---

## 6. Operational Limits & Quotas

To protect infrastructure from exhaustion, the following invariants are enforced:

| Constraint | Limit | Enforced At |
|---|---|---|
| **Max Render Duration** | 600 seconds (10 minutes) | `validateRenderManifest()` & resolver |
| **Max Frame Count** | 18,000 frames (600s × 30fps) | `validateRenderManifest()` |
| **Output Dimensions** | Min: 360×360 px, Max: 3840×3840 px | `validateRenderManifest()` |
| **Allowed Aspect Ratios** | `9:16` (Vertical Reel) or `16:9` (Widescreen) | `validateRenderManifest()` |
| **Recitation Audio Source** | Must belong to allowlisted CDNs or authenticated user uploads | `resolveAudioTrack()` |
| **Track E Glow Requirement** | Glow highlights require `validationStatus === "approved"` TimingMap | `validateRenderManifest()` |

---

## 7. Rollback & Feature Flag Strategy

The migration is non-breaking and preserves the client-side recorder as an explicit fallback:

1. **Default Path:** All users clicking "Export" use the server deterministic render pipeline (`handleServerExport`).
2. **Client Fallback Feature Flag:** If an operator needs to temporarily revert an individual user or staging environment:
   - In the frontend Quality tab, check the **"الوضع التجريبي: استخدام مسجل المتصفح المحلي (MediaRecorder)"** checkbox (`useLegacyRecorder`).
   - This routes the export to the legacy `useVideoRecorder` browser capture hook.
3. **Server Route Rollback:** The previous endpoint `POST /api/videos/render-mp4` remains registered and backward-compatible for legacy client-recorded WebM buffers.
