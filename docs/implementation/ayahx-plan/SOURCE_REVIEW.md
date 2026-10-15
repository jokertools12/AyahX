# Task 0.1 source due diligence

Read-only review of official source repositories/documentation on 2026-10-15. This records claims found in those sources; it is not legal approval, live endpoint testing, or adapter authorization. No API calls or audio downloads were made.

## QUD Universal Audio (QUA) `v3.2.0`

- **Official release:** [v3.2.0 release](https://github.com/QUD-Technologies/quranic-universal-audio/releases/tag/v3.2.0), released 2026-09-26, commit `3647d0a`. Release notes identify manifest/catalog, checksums, coverage and direct per-recitation ZIP assets. Current repository [README](https://github.com/QUD-Technologies/quranic-universal-audio/blob/main/README.md) says GitHub releases carry timestamps/metadata while audio is not bundled there; `catalog.json` points to original audio URLs.
- **Revision:** v3.2.0 is explicitly pinned in AyahX `server/services/quranUniversalAudioService.ts` (`RELEASE`, `RELEASE_BASE`). Release manifest includes per-recitation SHA-256 and coverage; retain/check those hashes when staging cached packages. The project says recitation timestamp revisions can change in later releases, so keep the version pin.
- **License distinction:** Release notes identify `LICENSE` as CC-BY-4.0; the repository README limits its own licensed work to timestamps, segmentation, alignment, catalog metadata and code. It states recordings remain property of reciters and original upstream sources. CC-BY on QUA metadata does **not** establish permission to copy, cache, host or redistribute recordings. DigitalKhatt V2 font is separately identified as OFL 1.1; other fonts/editions need their own review.
- **Storage:** Release artifacts may be vendored subject to the release's CC-BY attribution/terms. Audio URLs point to external original sources; persistent copies or redistribution remain unapproved pending each recording's rights.
- **Endpoint/CORS/rate limits:** This is a versioned release-download path, not a documented production API/SDK (the README lists a unified API/SDK as roadmap). GitHub release downloads are documented. No QUA CORS or request-rate policy was found. CORS is irrelevant to server-side package download; browser playback/fetch CORS must be checked against each audio host.
- **Unresolved:** Confirm attribution format for bundled copies; source-specific recording rights/retention and per-host CORS/rate constraints; validate manifest checksum and coverage against the selected recording before use.

## cpfair `quran-align` `release-2016-11-24`

- **Official tagged source:** [README at `release-2016-11-24`](https://github.com/cpfair/quran-align/blob/release-2016-11-24/README.md). The release page is [here](https://github.com/cpfair/quran-align/releases/tag/release-2016-11-24); its details could not be retrieved in this review. AyahX `server/services/quranAlignService.ts` pins `quran-align@release-2016-11-24` and uses local timing data.
- **Revision/data:** The README describes generated JSON word timing data and acknowledges possible omitted/ambiguous words and limited human-reviewed reference data. AyahX additionally enforces an exact EveryAyah folder match and rejects multi-word segments; this protects source matching but does not prove timing accuracy.
- **License distinction:** The tagged README states the generated **data files** are CC BY 4.0. This supports storage of timing data with attribution and license terms. It does not grant rights to underlying recitation audio used to generate timings or to EveryAyah-hosted recordings.
- **Storage/endpoint:** Local vendoring of the licensed timing data is supported with attribution. The project is a tool/data release, not a documented hosted API. Its README expects EveryAyah-style input; no audio-hosting or redistribution permission is supplied.
- **CORS/rate limits:** Not applicable to the pinned local data lookup. No upstream EveryAyah CORS policy or request-rate limit is documented in this source; browser-direct audio use requires separate host verification.
- **Unresolved:** Verify attribution notice in product/storage; confirm exact per-recitation dataset/audio pairing and rights for each audio recording. Treat timing omissions as possible and validate requested ranges.

## MP3Quran API v3

- **Official documentation:** [MP3Quran developer API docs](https://www.mp3quran.net/es/api), checked 2026-10-15. The docs list v3 endpoints including `reciters`, `riwayat`, `moshaf`, `ayat_timing`, and recitation URLs. The documented reciter response includes `surah_total` and `surah_list`, so coverage must be taken per moshaf/recording rather than inferred from reciter identity. Ayah timing is a separate endpoint and is verse-level.
- **Revision:** API family is v3; no immutable dataset release/snapshot or stable revision contract was found. Responses include update-date fields for some resources, but that is not a general revision guarantee.
- **License/storage:** The reviewed API documentation does not state a license for API metadata or audio recordings and does not grant audio download caching, local storage, or redistribution rights. Audio server URLs in API responses are pointers, not a rights grant. Keep metadata/audio storage pending explicit terms/permission.
- **CORS/rate limits:** The docs reviewed do not state CORS support or request limits. Unknown; do not rely on browser calls or assume unlimited requests. Ask the provider for supported origins, quotas, cache rules and usage terms before activation.
- **Unresolved:** Obtain rights/retention terms for audio and metadata; obtain CORS and rate-limit policy; determine refresh/version semantics; validate per-moshaf surah coverage and timing availability against current API responses before building an adapter.

## Gate

All three remain candidate sources pending the unresolved items above. QUA and cpfair timing/metadata licenses must remain separate from audio-recording rights. This review authorizes no adapter activation, upload, or live use.
