# AyahX architecture context

Maintainer-authored snapshot, 2026-10-07. This is not LLM-generated Terrain
output. Cross-check live source and refresh the source pack before decisions.

- UI: `src/App.tsx`, `src/pages/`, `src/components/`; React 18/Vite,
  Tailwind/shadcn, Arabic and English. Create/Preview pages drive video editing.
- API: `server/index.ts`, `server/routes/`, `server/middleware/auth.ts`;
  Express, authenticated operations and server-managed provider settings.
- Persistence: `server/db.ts`, `server/db/`, `database/`; MySQL. Do not
  assume migrations from the separate admin-rebuild worktree are installed.
- Render workers: `server/worker.ts`, `server/renderControl.ts`,
  `server/services/renderJobQueue.ts`, `renderQueueBroker.ts`,
  `videoRenderingService.ts`, `server/renderer/`; BullMQ/Redis, FFmpeg and
  native/browser rendering engines, object storage for delivered media.
- Quran/audio: `server/services/quranFoundationService.ts`,
  `quranAlignService.ts`, `alignmentService.ts`, `src/lib/wordTimingEngine.ts`,
  `src/lib/timingMap.ts`; optional `services/alignment-worker/` Python service.
- AI boundary: `server/services/aiService.ts`, `openRouterService.ts`,
  `settingsService.ts`. Explicit provider choice and server-held keys.
- Optional engineering toolkit: `tooling/` is an independent npm package,
  not imported by the application. SDK and Comfy clients are CLI development
  integrations. AutoGPT templates do not start autonomous agents.

Exact Quran text and verified timing must retain provenance. Generated
backgrounds must not contain Quran lettering; trusted fonts overlay it later.
Builds and mocked tests do not establish live deployment or provider success.
