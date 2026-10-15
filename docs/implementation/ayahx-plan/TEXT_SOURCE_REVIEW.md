# Quran text and font source review (Task 0.1)

Read-only review of the official QUL/Tarteel materials and the exact requested QUD repository URL on 2026-10-15. This records published claims; it is not legal approval, canonical-text certification, font QA, or source activation. No API writes, private-file access, downloads, or audio access were performed.

## QUL / Tarteel

Official entry points: [QUL resource library](https://qul.tarteel.ai/resources), [QUL Quran text guide](https://qul.tarteel.ai/docs/quran-text), [QUL downloading guide](https://qul.tarteel.ai/docs/downloading-data), [QUL FAQ](https://qul.tarteel.ai/docs/faq), [QUL data model](https://qul.tarteel.ai/docs/data-model), and the [TarteelAI/quranic-universal-library repository](https://github.com/TarteelAI/quranic-universal-library).

- The repository identifies QUL as a CMS for Quran data, scripts and Mushaf layouts, and GitHub labels the repository license MIT. That is evidence about repository code; it does not establish a license for each text/font/audio resource. QUL's FAQ explicitly directs production users to check repository and dataset-specific license terms.
- QUL documents downloadable JSON/SQLite resources and says integrators commonly package datasets into their own API/database. This is technical workflow guidance, not an affirmative rights grant. No resource-specific storage, redistribution, commercial-use permission, required attribution wording, or license was displayed on the reviewed Quran script/font pages. These remain pending per selected resource and rights holder.
- The official [QPC Hafs script page](https://qul.tarteel.ai/resources/quran-script/86) describes a Unicode script attributed there to King Fahd Complex, identifies Hafs in its title/tags, and requires the matching QPC Hafs font. The [Quran text guide](https://qul.tarteel.ai/docs/quran-text) also lists Uthmani, IndoPak, glyph-based versions, and named Warsh/Qaloon resources. These are source-published labels, not this project's approval of Quran identity.
- The official [Warsh ayah-by-ayah script page](https://qul.tarteel.ai/resources/quran-script/581) labels the resource Warsh and associates it with `qpc-warsh`; its sample schema has `verse_key` (`surah:ayah`), `script_type`, `font_family`, `page_number`, `juz_number`, and `hizb_number`. The [QPC Warsh font page](https://qul.tarteel.ai/resources/font/583) says the font needs its matching script and gives a CDN filename containing `v21`. No downloadable content hash, immutable data release, formal numbering-system definition, or explicit edition-to-riwayah approval was found in these pages.
- QUL data-model docs define shared join fields as `surah_id`/`ayah_number`/`word_position`; that is a schema, not proof that two different script resources have interchangeable numbering or identical text.
- The QUL FAQ says QUL primarily provides downloadable datasets and labels its API as coming soon. CORS and request-rate rules were not found in the reviewed sources. The downloadable guide's cache/serve advice is not a license grant.
- The [QUL font tutorial](https://qul.tarteel.ai/docs/tutorial-font-end-to-end) says a script-specific font should be tested with its matching script. Font metadata/license terms were not exposed in the reviewed QPC Warsh page; do not infer OFL or other rights from the font name, file extension, or page's download instruction.

## QUD-Technologies/quranic-universal-ayahs

The exact official URL requested, [QUD-Technologies/quranic-universal-ayahs](https://github.com/QUD-Technologies/quranic-universal-ayahs), returned 404 when opened. Exact-name searches did not locate an official repository or release. Therefore no text/font version, riwayah or numbering scope, license, attribution, storage permission, checksum, CORS, or rate policy can be asserted for this source. Do not substitute another similarly named QUD repository without a corrected source identity.

## Existing AyahX font candidates (inventory only)

Earlier local SHA-256 inventory; these are candidates, not approved bindings. `public/fonts/README.md` records OFL 1.1 and links Google Fonts as the source for its families; the adjacent `*-OFL.txt` files are the bundled notices. That local evidence does not bind any font to a canonical text/script or establish rendering QA.

| Local asset | SHA-256 | Inventory note |
|---|---|---|
| `public/fonts/amiriquran.ttf` | `e2a47644762d16bdfb6d33e0d8db8c6ff30beae84150ef5a705316bbd829455c` | Quran-oriented family; OFL notice present |
| `public/fonts/amiri.ttf` | `ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7` | Arabic family; OFL notice present |
| `server/assets/fonts/Amiri-Regular.ttf` | `ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7` | Byte-identical to public Amiri |
| `public/fonts/notonaskharabic.ttf` | `67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f` | Arabic family; OFL notice present |
| `server/assets/fonts/NotoNaskhArabic-Regular.ttf` | `67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f` | Byte-identical to public Noto Naskh Arabic |

## Gate / next action

QUL resource pages provide useful source-published script/font labels and coordinates, but per-resource rights, immutable revision/hash, and an approved profile binding are still missing. Obtain the exact dataset and font terms/provenance, verify matching text/font revisions and hashes, then route canonical Hafs/Warsh and numbering decisions to the designated Quran-identity reviewer. Resolve the requested QUD URL with Sol before assessing any alternate source. No adapter or content has been activated by this review.
