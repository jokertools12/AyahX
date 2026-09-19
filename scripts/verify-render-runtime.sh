#!/bin/sh
set -eu

command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
command -v fc-match >/dev/null
ffmpeg -hide_banner -filters 2>/dev/null | grep -Eq '[[:space:]]ass[[:space:]]|subtitles' \
  || { echo 'FFmpeg was built without libass/subtitles support' >&2; exit 1; }
ffmpeg -hide_banner -buildconf 2>/dev/null | grep -q -- '--enable-libass' \
  || { echo 'FFmpeg build does not advertise libass support' >&2; exit 1; }
fc-match 'Amiri' | grep -qi 'amiri' \
  || { echo 'Arabic Amiri font is not discoverable by fontconfig' >&2; exit 1; }
# Debian's libass package links HarfBuzz for Arabic shaping. Keep this check
# tolerant of architecture-specific library paths.
if command -v ldconfig >/dev/null 2>&1; then
  ldconfig -p 2>/dev/null | grep -q 'libass' \
    || { echo 'libass shared library is not installed' >&2; exit 1; }
fi
echo 'render runtime verified: ffmpeg+libass+Arabic fonts+ffprobe'
