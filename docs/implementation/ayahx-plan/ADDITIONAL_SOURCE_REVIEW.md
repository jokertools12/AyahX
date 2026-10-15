# Additional Quran source review

Scope: official public material for fawazahmed0/quran-api and AlQuran Cloud / Islamic Network. Reviewed 2026-10-15. This is source due diligence only; neither source is activated or approved as an AyahX canonical profile.

## fawazahmed0/quran-api

- Official repository: [README](https://github.com/fawazahmed0/quran-api/blob/1/README.md), [repository license](https://github.com/fawazahmed0/quran-api/blob/1/LICENSE), [references](https://github.com/fawazahmed0/quran-api/blob/1/References.md), [translation inventory](https://github.com/fawazahmed0/quran-api/blob/1/Translations.md).
- The README describes a REST collection of Quran translations (90+ languages, 440+ translations), with edition metadata and chapter/verse/juz/ruku/page/manzil/maqra routes. It documents Arabic font resources too. It warns that some translation data was OCRed and may contain spelling errors; see its named OCR language list.
- README documents versioned jsDelivr URLs using repository tag/path `@{apiVersion}` (example `@1`) and JSON/minified JSON endpoints. This versions the served repository path, but no immutable release manifest, canonical text revision, or text/font/audio checksum was found in the reviewed docs.
- Repository LICENSE is Unlicense/public-domain dedication for the repository software. It does not establish rights for each bundled translation, Quran text, or font. References.md says references helped directly or indirectly and that data was not sourced from every listed site. Per-edition provenance, terms, attribution, and redistribution permission remain unverified.
- The repository describes translation/edition data and fonts; the reviewed README does not document audio endpoints or audio rights. No documented global CORS policy, API rate policy, or cache/redistribution policy for each dataset was found. README’s “no rate limits” claim is an operational statement, not a rights grant.
- Numbered chapter/verse and auxiliary divisions are exposed, but the reviewed docs do not guarantee a specific riwayah, canonical numbering standard, or equivalence to AyahX’s approved identity. No use as canonical Quran text is approved by this review.
- AyahX source inventory currently lists `fawazahmed0` only as a text/translation candidate in `server/services/quranSourceRegistry.ts:47`; no active integration was found in the targeted source search.

## AlQuran Cloud / Islamic Network

- Official [terms](https://alquran.cloud/terms-and-conditions), [API reference landing page](https://alquran.cloud/api), and [CDN guide](https://alquran.cloud/cdn) were reviewed. Terms say they were last updated 2026-06-14 and apply to the site, API, and Islamic Network media CDN.
- Terms permit non-commercial reproduction/storage/display of the served Arabic text. For commercial use, AlQuran Cloud says its own permission is unnecessary and asks for acknowledgement. Preserve Uthmani orthography/diacritics; this provider statement does not prove upstream rights.
- Translation rights are edition-specific. Retain edition identifiers and credit named translators; no blanket translation license is established.
- Terms describe licensed non-commercial recitation redistribution at published bitrates and personal/educational streaming/downloads. Commercial bundling is discussed, but reciters retain copyright and removal rights. AyahX recording-specific clearance remains unresolved.
- CDN docs describe ayah audio editions, audio-by-surah, and ayah images. Ayah audio uses global number 1–6236, surah audio uses 1–114, and editions have identifiers (examples include `ar.alafasy`, `ar.husary`). Published bitrates are 32, 40, 48, 64, 128, and 192 kbps. No recording checksums or immutable audio release/version were found. The API reference is rendered from a canonical OpenAPI YAML link, but the browser could not parse that YAML; detailed endpoint/version guarantees remain unverified.
- Terms describe keyless API access with a soft per-IP rate limit and an unthrottled audio CDN, encouraging caching. The linked rate-limit page failed extraction; numeric thresholds and CORS remain unknown.
- Terms describe the served Arabic text as Uthmani and CDN/API numbering counts, but do not guarantee a named riwayah, a particular mushaf edition, or a fingerprint suitable for AyahX canonical binding. No text/translation/audio checksums were published in the reviewed pages. No source activation or profile approval follows from this review.

## AyahX status and unresolved gates

- AyahX’s current Quran route requests Quran Foundation `text_uthmani`; `fawazahmed0` appears only as a registry candidate. This review did not change routing or source configuration.
- Before either source could be considered for a profile: resolve item-level upstream rights and required attribution; establish exact text/script/riwayah/numbering identity and immutable fingerprints; check source edition identifiers against the intended content; document CORS/rate/cache behavior for the actual endpoints; and separately clear any selected translation, font, image, or recording. Parent-owned source identity and activation decisions remain pending.
