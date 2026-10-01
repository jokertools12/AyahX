# Preview studio and MP4 verification — 2026-10-01

## Delivered
- MP4 is the only downloadable export format. Internal browser WebM capture is converted to H.264/AAC MP4.
- Advanced motion, typography, shadow/glow, verse layout, and ayah number controls are consolidated below visible elements in Preview > Display.
- Presets use complete modern display defaults and preserve the user's watermark identity.
- Premium audio presets, preview compressor routing, volume controls, and repeated recording audio are corrected.
- Cloud jobs save once to Library. Discover publishing updates that same record, supports a title and immediate revocation, and serves public media without exposing private jobs.
- Browser Library saves retain project metadata only. MP4 stays on the device; Discover requires cloud output.
- Platform sharing uses the device's native share sheet where file sharing is supported, otherwise downloads MP4 with manual upload instructions. Posting into third-party accounts is not automatic.

## Practical evidence
- 18 actual engine outputs: FFmpeg ASS, Skia, and Browser Cloud × 720p/1080p/4K × 30/60 FPS. FFprobe dimensions, frame counts, H.264/AAC, and complete decode verified.
- 119 display choices across 19 option groups: actual scene frames rendered at four timestamps, with distinct output for every choice in its applicable mode.
- 9 native audio variants: decoded PCM comparison, volume multiplier checks, unclipped samples, and sound effects verified.
- 6 browser recordings: portrait dimensions at 30/60 FPS with AAC audio; selected duration and CFR conversion verified against actual recorded sources.
- 83 regression tests passed in 12 files; follow-up export/UI tests also passed. Production build and application TypeScript checks passed.

## Limits
- Cost policy keeps production cloud rendering on Skia: free 720p30; paid up to 1080p30. The other two workers remain stopped. Local paid export supports 4K60.
- A CFR 60 FPS file does not guarantee 60 unique captured frames. This machine dropped frames at higher resolutions, especially 4K. Conversion repeats the final frame to preserve the chosen duration; it cannot reconstruct missed motion.
- Preview and cloud use different audio processing implementations for reverb and normalization; exact sample parity is not claimed.
- No feature promises to evade audio attribution, fingerprinting, or rights enforcement.
- Third-party platform posting and external AI logo generation were not verified with real accounts/provider purchases.

Local detailed artifacts are in ignored qa-output/: settings-matrix.json, display-options/results.json, audio-options/results.json, local-recordings/results.json, and studio-final-tests.log.
