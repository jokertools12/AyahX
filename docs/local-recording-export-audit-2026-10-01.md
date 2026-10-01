# Local recording and MP4 export verification

The recording hook previously uploaded the finished recording to
`/api/videos/process-mp4` before trying on-device encoding. It now encodes
entirely in the browser. The progress message explicitly says the MP4 is
prepared on the device; no cloud transcoding fallback remains in this path.

The WASM encoder uses an ES module core compatible with its module worker.
Vite preserves the worker module path in development and emits an ES worker
in production. Loading has a timeout and releases temporary blob URLs.
Encoding is serialized, progress listeners belong to each conversion, exit
codes and output size are checked, and temporary files are removed on errors
as well as success. H.264/AAC output is required rather than silently returning
a different codec. Download URLs remain valid for 60 seconds and the status
says download started, rather than claiming it has finished.

Real Chrome verification used the actual recording hook, moving canvas and
an audio stream. Both development and production builds produced downloaded
720x1280 MP4 files at 30 and 60 fps. Native FFmpeg independently decoded both
files without errors and confirmed H.264 High, AAC stereo, 192 kb/s at 30 fps
and approximately 319 kb/s at 60 fps (requested 320 kb/s). Neither run sent an
API request. Clips were two seconds; this does not certify every device or
long 4K recording. Twenty-six focused regression tests, app type-check and
production build passed. Local detailed evidence is in qa-output.
