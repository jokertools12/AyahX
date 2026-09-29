# quran-align integration

AyahX ships the timing metadata from the pinned `cpfair/quran-align`
`release-2016-11-24` archive for the twelve EveryAyah folders that the release
names. The metadata is CC BY 4.0; the original recitation recordings remain
owned by their upstream hosts. See `server/data/quran-align/LICENSE` and the
upstream [repository](https://github.com/cpfair/quran-align).

The server imports the compressed JSON files through
`server/services/quranAlignService.ts`. A request is accepted only when:

* the reciter's EveryAyah folder is an exact pinned release key;
* the requested range is contiguous and has an audio offset for every ayah;
* every source segment covers exactly one Quran word; and
* the resulting map passes the normal monotonic, non-overlap, duration and
  coverage checks.

The importer scales the source timestamps to the decoded duration of the same
EveryAyah clips after the browser's deterministic WAV concatenation. This is a
whole-clip clock calibration, not per-word proportional timing. Multi-word
segments are rejected and the UI remains in verse-only mode for that range.
No audio is copied into the repository, no Quran Foundation credentials or
endpoint are used, and OpenRouter is not involved in alignment.
