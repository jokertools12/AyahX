# جرد البيانات وخط الأساس — D0

تاريخ الجرد: 2026-10-09 (Africa/Cairo)
المستودع: `C:\Users\cpazi\Downloads\ayahX`
المرجع التنفيذي: `docs/plan/00_MASTER_PROMPT.md` ثم `docs/plan/01_DATA_PLAN.md`
الحالة: قراءة فقط؛ لم تُعدّل جداول أو كود المنتج، ولم تُشغّل خدمة إنتاج.

## تقرير المرحلة D0 — جرد البيانات وخط الأساس

### 1. ما الذي تغيّر (ملفات/جداول/endpoints)

- أُضيف هذا الملف فقط لتسجيل جرد D0 والدليل القابل لإعادة الفحص.
- لم تُطبّق migration، ولم تُنشأ قاعدة بيانات، ولم تُعدّل أي endpoint أو مكوّن.
- ثبّت الفحص أن الفرع الحالي هو `main` عند commit `456d1da8b682dc907471e114743ae0983b1e2ca8`، مع ملفات الخطة المرفقة غير متتبعة أصلًا تحت `docs/plan/`.

### 2. ما الذي تحققت منه فعلياً (أوامر + مخرجات/لقطات)

#### جرد التنفيذ الحالي

| المجال | الموجود فعلياً | الفجوة بالنسبة إلى الخطة |
|---|---|---|
| السور | `src/data/surahs.ts` قائمة ثابتة؛ واجهة الخادم `server/routes/quran.ts` تستدعي Quran Foundation | لا يوجد catalog محلي أو جدول `quran_surahs`/`quran_ayahs` |
| القراء | `src/data/reciters.ts` قائمة ثابتة وروابط EveryAyah/QUA؛ خدمة QUA مثبتة على `v3.2.0` | لا توجد جداول القراء/الروايات/التسجيلات المقترحة |
| النص | `src/hooks/useQuranApi.ts` يجلب Quran Foundation ثم AlQuran.cloud؛ يزيل بسملة افتتاحية في مسار fallback لبعض السور | لا توجد نسخة نصية canonical مخزنة أو سياسة basmala صريحة |
| الصوت | `getAudioUrl` وEveryAyah في الواجهة، و`server/services/quranUniversalAudioService.ts` وQuran routes | لا توجد طبقة import موحدة لملفات الآيات أو manifest قابل للتدقيق |
| التوقيت | `src/lib/timingMap.ts` و`server/services/quranAlignService.ts`؛ `wordTimingEngine.ts` مسار تقديري قديم وموسوم deprecated/diagnostic | لا توجد جداول `ayah_timings`/`alignment_jobs` أو بوابة اعتماد موحدة |
| الريندر | مسارات FFmpeg/Skia/Browser الحالية تستقبل manifest والتوقيت؛ لا تغيير في D0 | ربط catalog/aligner/database الذي تصفه الخطة غير منفذ |
| قاعدة البيانات | `database/schema.sql` يحوي الجداول الحالية، و`server/db/migrations` يحوي migrations للرندر/المحاذاة/الاشتراكات | لا توجد جداول catalog المقترحة في خطة البيانات |

#### أدلة QUD الحية

الأوامر المستخدمة:

```text
curl.exe -L https://api.github.com/repos/QUD-Technologies/quranic-universal-audio/releases/latest
curl.exe -L https://github.com/QUD-Technologies/quranic-universal-audio/releases/download/v3.2.0/catalog.json -o %TEMP%\qud-catalog-v3.2.0.json
```

النتيجة الفعلية:

- أحدث Release هو `v3.2.0`، منشور في 2026-09-26، بعنوان `v3.2.0 — 69 Recitations`.
- `catalog.json`: `schema_version=3` و`recitations=69`.
- المفاتيح الفعلية لكل سجل: `audio`, `audio_category`, `channel`, `country`, `coverage`, `name_ar`, `name_en`, `reciter_id`, `recording_context`, `recording_year`, `riwayah`, `schema_version`, `slug`, `style`, `variant_label`.
- سجل Maher (`maher_al_muaiqly_qdc`) يعلن `coverage.ayahs=6236`, `surahs=114`، وملف السورة 2 من QuranicAudio.
- سجل Abdul Hamid (`abdul_hamid_ghraio_2025_yt`) يعلن 6235 آية و`missing_verses=["1:1"]`، ويحتوي `chapter_offsets_ms`؛ هذا يثبت أن الإزاحات ليست موجودة بنفس الشكل لكل سجل.
- سجل Abdulbasit Tarteel يعلن 6236 آية ورابط chapter مباشر.

#### أدلة Hugging Face والـ schema

```text
https://datasets-server.huggingface.co/info?dataset=QUD-Technologies%2Fquranic-universal-ayahs
https://datasets-server.huggingface.co/rows?dataset=QUD-Technologies%2Fquranic-universal-ayahs&config=<slug>&split=train&offset=0&length=100
```

- الاستجابة الحالية: `configs=94`, `partial=false`, `pending=0`, `failed=0`؛ الخطة تذكر 86 subset، وهو تعارض زمني يجب تحديثه قبل D1.
- أعمدة الصف الفعلية: `audio`, `surah`, `ayah`, `duration_ms`, `text_uthmani`, `segments`, `word_timestamps`, `source_url`, `source_offset_ms`.
- صف Abdul Hamid 2025 للآية 1:2: `duration_ms=3328`, النص `ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ`، segment واحد `[1,4,6,3328]`، و`source_offset_ms=3004`.
- صف 1:1 مفقود في هذا config، بينما 1:1 موجود عند Abdulaziz (`duration_ms=5236`, offset 5904) وMaher (`duration_ms=6514`, offset 7523).

#### النص المكرر والمرجع canonical

تمت مقارنة صفوف حقيقية مع Quran.com API (`fields=text_uthmani`):

- Abdul Hamid 2:22: 25 token مقابل 24 canonical؛ تكرارات فعلية لـ `فَأَخْرَجَ`, `بِهِۦ`, `مِنَ`.
- Abdul Hamid 2:31: 17 token مقابل 15 canonical؛ تكرار `فَقَالَ` و`أَنۢبِـُٔونِي`.
- Maher 2:22 و2:31 لا يحملان التكرار نفسه في الصف المفحوص.

النتيجة: `text_uthmani` في dataset قد يمثل النص/التقطيع المنطوق للتسجيل، وليس مرجعاً canonical تلقائياً. لا يجوز استبداله بنص مولد أو تطبيق تصحيح صامت؛ يلزم policy صريحة للمصدر والـ review.

#### تجربة `source_offset_ms` (3 قراءات × 3 آيات)

اُستخدمت ملفات MP3 الأصلية وclips الآيات من ثلاث configs (`maher_al_muaiqly_qdc`, `mishary_rashid_al_afasy_mp3quran`, `abdulbasit_abdulsamad_tarteel`) مع فك الصوت إلى mono 16 kHz بواسطة FFmpeg محلي. لكل الأزواج التسعة كان `orig_samples == clip_samples` و`length_delta_ms=0`، لكن الارتباط Pearson اختلف:

| القراءة | 1:1 | 1:2 | 2:22 |
|---|---:|---:|---:|
| Maher | 0.4271 | 0.5302 | 0.8348 |
| Mishary | 0.9965 | 0.6827 | 0.6194 |
| Abdulbasit | 0.3362 | 0.9417 | 0.1868 |

الاستنتاج: تطابق المدة وحده لا يثبت أن القص من السورة الأصلية هو نفس clip الآية. لا تعتمد الخطة `source_offset_ms` عالمياً؛ استخدم clips الآيات أو تحققاً صريحاً لكل provider/recitation قبل أي استخدام.

#### البسملة والرموز والخط

- وجود 1:1 يختلف بين القراءات؛ لذلك يجب أن تكون `basmala_mode` صريحة (ولا تفترض بسملة عامة). مسار fallback الحالي يزيل افتتاحية غير الفاتحة/التوبة، وهو سلوك يحتاج policy موثقة قبل catalog import.
- اختُبرت أول 100 صف لكل من ثلاث configs؛ مجموعة 62 code point تضمنت علامات قرآنية مثل U+06D6 وU+06DB وU+06DE وU+08F0..U+08F2. لم يظهر أي نقص في cmap لهذه العينة عند `amiri.ttf`, `amiriquran.ttf`, `notonaskharabic.ttf`, `scheherazadenew.ttf`.
- هذه تغطية عينة cmap وليست إثباتاً لكل corpus؛ DigitalKhatt المرفق في Release ليس bundled في `public/fonts` حالياً، لذا يلزم اختبار corpus كامل بعد الاستيراد.

#### Aligner

```text
GET https://hetchyy-quranic-universal-aligner.hf.space/api/v1/recitations
```

رجع HTTP 200 وسجلات حقيقية تحوي `slug,label,reciter,riwayah,style,channel,source,chapters`. بعض السجلات بها فجوات chapters (مثل Abdulaziz)، لذلك لا يكفي وجود سجل recitation لإثبات تغطية كاملة.

#### خط الأساس الفعلي

| الأمر | النتيجة |
|---|---|
| `npm ci` | تعذر بسبب `EPERM` على `node_modules/@esbuild/win32-x64/esbuild.exe` أثناء وجود عمليات Node؛ لم نغيّر ملفات tracked. |
| `npm install --no-save --ignore-scripts --prefer-offline vite@5.4.19 vitest@3.2.4 typescript@5.8.3 eslint@9.32.0` | نجح لتوفير أدوات الاختبار محلياً؛ التغيير غير متتبع. ثُبّت `ffmpeg-static` binary مؤقتاً محلياً لتفادي ENOENT. |
| `npm test` | `77 passed | 1 skipped` test files؛ `426 passed | 6 skipped` tests؛ exit 0، مدة 48.39s. |
| `npx tsc --noEmit` | exit 0. |
| `npm run lint` | exit 1: إجمالي 1053 مشكلة، منها خطآن و1051 تحذيراً. الخطآن في `tooling/runtime/ayahx-brand-studio/app/page.tsx`: rule غير موجود `@next/next/no-img-element` و`no-empty`. |
| `npm run test:e2e` | نجح محلياً: desktop 5/5 وmobile 5/5، المجموع 10/10 في ملفي public، دون model calls أو production. التقرير في `.e2e/`. |

لم أشغّل `npm run db:setup` أو `npm run dev:all`: الأول ينشئ قاعدة البيانات ويطبق schema/ALTER، والثاني يبدأ server الذي ينفذ ensure migrations عند الإقلاع؛ تشغيلهما يخالف جرد القراءة فقط.

#### migrations وworktrees

- `server/db/migrations`: `addAlignmentTables.ts`, `addRenderJobsTable.ts`, `ensurePlanEntitlementSchema.ts`.
- `database/schema.sql` لا يحتوي جداول catalog المقترحة في الخطة.
- `git worktree list --porcelain`: checkout الحالي فقط؛ الدليل القديم `C:\Users\cpazi\.codex\worktrees\6def\ayahX` فارغ وغير صالح كـ worktree.
- لا يوجد فرع أو worktree إداري فعّال. تاريخ git يثبت أن commit `1d5b42d38a409fc5da264e509c439b052ec52b66` أزال لوحة الأدمن وواجهاتها القديمة؛ الفرع البعيد `origin/codex/openrouter-quran-animate-staging` لا يعيدها.

### 3. نتائج الاختبارات

النتائج أعلاه هي التشغيل الفعلي. اختبارات Vitest وTypeScript وpublic E2E نجحت بعد توفير binary FFmpeg المحلي؛ lint بقي فاشلاً بسبب خطأين حقيقيين و1051 تحذيراً. كل تجارب `[تحقّق]` المطلوبة في D0 نُفذت بعينات حية وسُجلت هنا، مع إبقاء الملفات المؤقتة خارج المستودع.

### 4. ما لم يكتمل أو يحتاج قراري، وسببه

- لم تُستورد بيانات إلى قاعدة البيانات ولم تُنشأ migrations جديدة، لأن D0/A0 قراءة فقط.
- لم تُشغّل خدمة Express أو `db:setup`، لأن startup يكتب إلى قاعدة البيانات.
- اختبار الخط الكامل لكل 69/94 config، واختبار cmap لكل النصوص، واستماع بشري مقارن، مؤجل إلى D1 بعد اعتماد سياسة المصدر.

### 5. المخاطر المعروفة

- اختلاف live Release/HF عن أرقام الخطة (69 recitations و94 configs مقابل أرقام أقدم).
- اختلاف `text_uthmani` والتكرار بين القراءات؛ خطر خلط النص المنطوق بالـ canonical.
- `source_offset_ms` يطابق المدة لكنه لا يثبت التطابق الصوتي.
- basmala والتغطية ناقصتان لبعض القراءات.
- lint غير أخضر، ولا توجد قاعدة catalog/admin في checkout الحالي.

### 6. الخطوة التالية المقترحة

انتظار موافقة صريحة على نتائج D0 قبل D1: اعتماد provider/source policy، `basmala_mode`، سياسة canonical مقابل recited text، وقاعدة قبول `source_offset_ms`؛ ثم تصميم migrations idempotent واختبارات corpus كاملة. لا يبدأ أي تنفيذ D1 قبل هذه الموافقة.


## تقرير المرحلة D1 — النص القانوني والسور والمصاحف

### 1. ما الذي تغيّر (ملفات/جداول/endpoints)

- migration `server/db/migrations/001_addQuranTextTables.ts` تضيف فقط: `riwayat`, `quran_text_versions`, `quran_surahs`, `quran_ayahs`, `quran_words`, `translations`, `translation_ayahs`. جدول نسخة النص يسجل `qud_version`؛ جداول الأدمن/التلاوات لم تُنشأ.
- `scripts/import-quran-text.ts` و`server/services/quranTextImport.ts`: مصدر Release مثبت URL/SHA-256، dry-run افتراضي، import transaction، IDs حتمية، تحقق checksum للبيانات المخزنة قبل commit. لا تغيير في canonical من HF أو AI.
- `scripts/audit-qud-configs.py`: تدقيق كل configs، تخزين recited text منفصل في cache، word diff يفشل مغلقاً عند الاستبدال/الحذف/الربط الغامض؛ يحفظ hamza في NFC ولا يغيّر النص القانوني.
- `scripts/check-quran-fonts.py` وE2E corpus test واختبارات قبول MySQL فعلية.
- حماية backend ضيقة في `/api/services/refine-text` ترفض مراجع `quran_ayahs`/`quran_words` الصريحة قبل استدعاء AI؛ طلبات الابتهالات/النصوص المخصصة بالشكل الحالي مستمرة. لم تُربط جداول النص بالواجهة أو الريندر.
- `docs/dev-environment.md` و`docs/quran-text-import.md` يوثقان البيئة وrollback؛ الخطة أصبحت تذكر أن عدد configs يُحسب من المصدر وتوثق سياسات المستخدم.

### 2. ما الذي تحققت منه فعلياً (أوامر + مخرجات/لقطات)

```powershell
npx tsx scripts/import-quran-text.ts --manifest server/data/quran-text/v3.2.0-source.json --output "$env:TEMP/ayahx-d1/corpus.json"
npx tsx scripts/test-quran-text-db.ts --corpus "$env:TEMP/ayahx-d1/corpus.json" --db-host 127.0.0.1 --db-port 33317 --db-name ayahx_d1_acceptance --out "$env:TEMP/ayahx-d1/db-acceptance.json"
```

- مصدر script SHA-256: `19d5694b057dc68c3811e28f3ad1d58c0f07021a0c67a85cd25619ece7a9bf86`؛ surah_info SHA-256: `e8e1f39b9fe73a121b61f9b4ec8eee4880e0f4333acf9f34671ac15ff581e77b`.
- corpus: **114 سورة، 6236 آية، 77433 كلمة، 70 codepoints**. checksum القانوني: `eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4`.
- MySQL **8.4.11** محلي معزول: up مرتان، import مرتان، نسخة واحدة وبدون صفوف مكررة؛ corruption test رفض النص المعدل؛ rollback ترك **0** من جداول D1؛ إعادة التطبيق والاستيراد نجحت. ملف الدليل: `docs/data/d1-db-acceptance.json`.
- HF: **94 config** = **93 تلاوة** + `mushafs` (ميتاداتا 93 تلاوة). **571557 صفاً** فُحصت؛ أعداد الصفوف وchecksums للـ raw cache تطابقت مع معلومات المصدر. جميع **69** تلاوة في Release المثبّت مشمولة. هذه أرقام لقطة، لا ثوابت كود.
- metadata الفعلية حددت **77 حفص** و**16 رواية أخرى**؛ لا استنتاج من slug. في حفص: رصد تكرار في **52207** صف آية و**1714** صفاً `needs_review` (قد تتداخل الفئتان؛ فشل أي ربط يعطل word highlighting في البيانات المستقبلية). الروايات الأخرى تحتاج مرجعها القانوني الخاص، وفرقها عن حفص تشخيصي فقط.
- basmala: **72 ayah_1_included، 21 absent، 0 separate_clip معلن**. لا صوت يُصنع ولا بديل لـ 1:1 المفقودة.
- عينة اتساق Maher من QUD/HF مقابل script: 1:2 = 4 كلمات/4 indexes، 2:7 = 12/12، 2:31 = 15/15، 2:32 = 12/12، 112:1 = 4/4؛ الربط mapped في الخمس.
- فحص cmap على corpus الكامل: Amiri/Amiri Quran/Noto Naskh Arabic/Scheherazade New/Lateef/Mada تغطي كل الرموز المرئية. U+034F control غير مرئي بقي محفوظاً في النص؛ عدم وجود glyph مرئي له لا يساوي tofu. الخطوط الزخرفية الأخرى لها نقص مسجل في `docs/data/d1-font-coverage.json`.
- E2E فحص **21202 كلمة فريدة** في UI و`render-harness.html`: لا كلمات فارغة الرسم؛ cmap كامل للرموز المرئية، ولقطتان فُحصتا بصرياً. يستخدم الاختبار bundled Amiri داخل fixture فقط، فلا يثبت توافر CDN الخارجي. الدليل الخاص: `tooling/e2e/.e2e/d1-corpus/report.json` وscreenshots داخله.

لإعادة تدقيق configs من أعمدة Parquet دون الصوت:

```text
python scripts/audit-qud-configs.py --corpus <corpus.json> --catalog <catalog.json> --out <private-cache>
python scripts/audit-qud-configs.py --corpus <corpus.json> --catalog <catalog.json> --out <private-cache> --finalize-cache
python scripts/check-quran-fonts.py --corpus <corpus.json> --fonts public/fonts --out <font-coverage.json>
```

تتطلب أدوات التدقيق duckdb/fonttools محلياً، وليست dependency جديدة للمنتج. المصدر الرسمي يتيح القراءة العمودية عبر Parquet: [Hugging Face Parquet documentation](https://huggingface.co/docs/dataset-viewer/en/parquet). نسخة بيانات التقرير: `docs/data/d1-config-audit.json`، بما فيها coverage لكل سورة والتوفر الكامل المشروط.

### 3. نتائج الاختبارات

| الفحص | النتيجة الفعلية |
|---|---|
| `npm test -- --reporter=dot` مع corpus | **81 passed / 1 skipped** files؛ **436 passed / 6 skipped** tests؛ 80.72s |
| اختبارات D1 المستهدفة بعد آخر تعديل | **10/10** في أربعة ملفات |
| اختبارات Python diff/basmala | **3/3** |
| `npx tsc --noEmit` | exit 0؛ كذلك typecheck صريح لكل ملفات D1 server/scripts/tests نجح |
| lint الملفات الجديدة/المتغيرة الجديدة | exit 0، **0 errors / 0 warnings** |
| lint `server/routes/services.ts` قبل/بعد | **0 errors / 15 warnings** في كليهما، ولا رسالة جديدة |
| `npm run build` | exit 0؛ Vite 42.57s + server build |
| E2E corpus desktop | **1/1** (UI + harness)، 15.55s |
| MySQL import/replay/rollback/corruption | نجح على 8.4.11 محلي معزول، الدليل محفوظ |

### 4. ما لم يكتمل أو يحتاج قراري، وسببه

- migration/الاستيراد لم يطبقا على قاعدة التطبيق أو الإنتاج؛ التحقق الفعلي على قاعدة اختبار محلية فقط.
- `recitations` غير موجود حتى D2؛ لذلك basmala/repetition/offset metadata محفوظة في تقرير D1 ولا تُنشأ جداول D2 مبكراً. الحقول والسياسات مُثبتة في الخطة لنقلها عند إنشاء جدول التلاوات.
- لا تقييم offset بخمس آيات ولا نشر تلاوة في D1؛ `offset_verified=false`, score NULL. فحص الصوت الفعلي وقاعدة surah_slice في مرحلة الصوت، وإعادة محاذاة الفاشل في D5 فقط. توصية D0 القديمة باستعمال HF clips لا تنطبق على الإنتاج بعد قرارات المستخدم.
- روايات غير حفص لا تُعتمد مقابل النص القانوني لحفص؛ تحتاج استيراد نسخة قانونية لكل رواية لاحقاً. translations موجودة كمخطط فقط بلا مصدر ترجمة مُخترع.
- الإشعارات للمستخدم ورفض المدى الناقص وربط word highlighting تنتظر D7/D8؛ لا تغيير UI أو ريندر في D1.

### 5. المخاطر المعروفة

- diff آلي محافظ؛ الـ needs_review ليس خطأً نصياً مؤكداً. لا يفتح تظليل كلمات أو نشر التلاوة.
- بعض الخطوط الزخرفية ناقصة التغطية؛ فحص D1 يثبت الخط القانوني Amiri والبدائل المذكورة فقط، ولا يغير خيارات التصميم الحالية.
- HF مصدر تدقيق قابل للتغير؛ row checksums والأرقام هنا لقطة مؤرخة، والقانوني مثبت في Release URL/SHA-256.
- DDL في MySQL له implicit commits؛ rollback الصريح يمس جداول D1 فقط ويحتاج backup للبيانات المراد حفظها.

### 6. الخطوة التالية المقترحة

التوقف عند تقرير D1 وانتظار موافقة صريحة قبل D2 أو A1. الخطوة اللاحقة المقترحة عند الموافقة: جداول التلاوات والمزوّدين مع نقل metadata التدقيق وoffset gates؛ لا استعادة للأدمن القديم ولا نشر.

## جدول كل configs — تدقيق D1 الكامل

هذه أرقام لقطة 2026-10-09، تُحسب من المصدر وليست ثوابت في التطبيق. mushafs ميتاداتا لا صفوف صوت. المقارنة القانونية المعتمدة هنا لحفص فقط؛ الروايات الأخرى فُحصت، لكن فرقها عن مرجع حفص تشخيصي ولا يعد تكراراً معتمداً. جميع التلاوات غير منشورة في D1، وoffset_verified=false حتى الفحص المستقل لاحقاً.

| config | ضمن Release المثبّت | الصفوف | basmala_mode | الرواية | آيات رُصد بها تكرار | needs_review |
|---|---|---:|---|---|---:|---:|
| abdul_hamid_ghraio_2025_yt | نعم | 6235 | absent | hafs_an_asim | 159 | 3 |
| abdul_hamid_ghraio_2026_yt | نعم | 6235 | absent | hafs_an_asim | 153 | 1 |
| abdulaziz_al_turki_yt | نعم | 6115 | ayah_1_included | hafs_an_asim | 420 | 9 |
| abdulbasit_abdulsamad_mujawwad_tarteel | نعم | 6236 | ayah_1_included | hafs_an_asim | 601 | 7 |
| abdulbasit_abdulsamad_tarteel | نعم | 6236 | ayah_1_included | hafs_an_asim | 405 | 2 |
| abdulbasit_abdulsamad_warsh_qdc | نعم | 6178 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| abdullah_al_buaijan_2025_yt | نعم | 6235 | ayah_1_included | hafs_an_asim | 67 | 0 |
| abdullah_al_mattrod_qdc | نعم | 6236 | ayah_1_included | hafs_an_asim | 334 | 2 |
| abdullah_al_qarafi_mp3quran | نعم | 6223 | ayah_1_included | hafs_an_asim | 450 | 8 |
| abdullah_basfar_qdc | لا | 6236 | ayah_1_included | hafs_an_asim | 1466 | 68 |
| abdullah_kamel_way2quran | نعم | 6235 | absent | hafs_an_asim | 1628 | 52 |
| abdulmohsin_al_qasim_qdc | لا | 6235 | absent | hafs_an_asim | 42 | 1 |
| abdulrahman_al_sudais_tarteel | لا | 6235 | absent | hafs_an_asim | 643 | 5 |
| abdulrahman_al_sudais_yt | لا | 6234 | ayah_1_included | hafs_an_asim | 661 | 20 |
| abdulrahman_az_zawawi_way2quran | لا | 6235 | ayah_1_included | hafs_an_asim | 1099 | 21 |
| abdulwadood_haneef_mp3quran | نعم | 6235 | absent | hafs_an_asim | 701 | 21 |
| abdur_rashid_sufi_qdc | نعم | 6236 | ayah_1_included | hafs_an_asim | 239 | 1 |
| abdur_rashid_sufi_shubah_qdc | نعم | 6230 | ayah_1_included | shubah_an_asim | تشخيصي فقط | يتطلب مرجع الرواية |
| abu_bakr_al_shatri_tarteel | نعم | 6236 | ayah_1_included | hafs_an_asim | 1801 | 71 |
| adel_al_karbalaei_archive_v2 | نعم | 6236 | ayah_1_included | hafs_an_asim | 181 | 1 |
| ahmad_naseem_ali_ahmad_2019_yt | نعم | 6236 | ayah_1_included | hafs_an_asim | 751 | 7 |
| ahmed_al_ajmi_qdc | نعم | 6235 | ayah_1_included | hafs_an_asim | 1444 | 21 |
| ahmed_amer_tvquran | نعم | 6236 | ayah_1_included | hafs_an_asim | 340 | 2 |
| ahmed_deban_qalon_mp3quran | نعم | 6190 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| ahmed_issa_al_maasaraawi_mp3quran | نعم | 6234 | ayah_1_included | hafs_an_asim | 252 | 6 |
| ahmed_kaseb_way2quran | نعم | 6235 | ayah_1_included | hafs_an_asim | 305 | 4 |
| ahmed_khader_al_trabulsi_qalon_tvquran | لا | 6179 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| ahmed_nuayna_qdc | نعم | 6236 | ayah_1_included | hafs_an_asim | 162 | 1 |
| ahmed_saleh_rajab_qalon_way2quran | نعم | 6126 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| ahmed_saud_mp3quran | نعم | 327 | absent | hafs_an_asim | 2 | 0 |
| ahmed_shaheen_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 723 | 7 |
| ahmed_talib_bin_humaid_mp3quran | نعم | 5561 | ayah_1_included | hafs_an_asim | 586 | 17 |
| akram_al_alaqmi_qdc | نعم | 6235 | absent | hafs_an_asim | 982 | 25 |
| al_dokali_mohammed_alaalim_qalon_mp3quran | لا | 6214 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| al_hussayni_al_azazy_kids_qdc | لا | 6234 | ayah_1_included | hafs_an_asim | 1461 | 815 |
| ali_al_huthaifi_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 929 | 8 |
| ali_hajjaj_al_souasi_qdc | لا | 6236 | ayah_1_included | hafs_an_asim | 281 | 1 |
| aloyoon_al_koshi_warsh_mp3quran | لا | 6214 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| anas_almiman_yt | لا | 6236 | ayah_1_included | hafs_an_asim | 254 | 2 |
| ayman_swed_muallim_yt | نعم | 6236 | ayah_1_included | hafs_an_asim | 1327 | 14 |
| badr_al_turki_yt | نعم | 6236 | ayah_1_included | hafs_an_asim | 643 | 5 |
| bandar_baleela_qdc | نعم | 6235 | absent | hafs_an_asim | 926 | 14 |
| fatih_seferagic_way2quran | نعم | 6235 | absent | hafs_an_asim | 64 | 0 |
| haitham_al_dukhain_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 1104 | 12 |
| hani_al_rifai_qdc_128k | نعم | 6233 | absent | hafs_an_asim | 517 | 12 |
| hatem_fareed_al_waer_mp3quran | لا | 6235 | absent | hafs_an_asim | 402 | 9 |
| ibrahim_al_akhdar_drive | نعم | 6236 | ayah_1_included | hafs_an_asim | 128 | 3 |
| imad_zuhair_hafez_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 581 | 0 |
| islam_sobhi_mp3quran | نعم | 5275 | ayah_1_included | hafs_an_asim | 643 | 9 |
| kamel_al_bayli_warsh_way2quran | لا | 6213 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| khalid_al_mohana_drive | نعم | 6236 | ayah_1_included | hafs_an_asim | 260 | 2 |
| khalid_al_qahtani_mp3quran | لا | 6234 | absent | hafs_an_asim | 876 | 18 |
| khalifa_al_tunaiji_tarteel | نعم | 6236 | ayah_1_included | hafs_an_asim | 309 | 6 |
| maher_al_muaiqly_qdc | نعم | 6236 | ayah_1_included | hafs_an_asim | 326 | 0 |
| maher_al_muaiqly_tarteel | لا | 6235 | absent | hafs_an_asim | 1478 | 25 |
| mahmoud_abdul_hakam_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 568 | 8 |
| mahmoud_ali_al_banna_qdc | نعم | 6236 | ayah_1_included | hafs_an_asim | 419 | 1 |
| mahmoud_khalil_al_husary_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 327 | 1 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | نعم | 6235 | ayah_1_included | hafs_an_asim | 571 | 9 |
| mahmoud_khalil_al_husary_qdc_128k | نعم | 6236 | ayah_1_included | hafs_an_asim | 305 | 2 |
| majed_al_zamil_yt | لا | 6236 | ayah_1_included | hafs_an_asim | 597 | 8 |
| mishary_rashid_al_afasy_2008_qdc | نعم | 6236 | ayah_1_included | hafs_an_asim | 921 | 25 |
| mishary_rashid_al_afasy_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 817 | 18 |
| moaz_mahmoud_hamed_qalon_way2quran | نعم | 6175 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| mohammed_abdulkareem_qdc | نعم | 6235 | ayah_1_included | hafs_an_asim | 1266 | 9 |
| mohammed_al_luhaidan_mp3quran | نعم | 6234 | absent | hafs_an_asim | 1118 | 25 |
| mohammed_al_tablawi_qdc | لا | 6236 | ayah_1_included | hafs_an_asim | 89 | 1 |
| mohammed_alghazali_archive | نعم | 6236 | ayah_1_included | hafs_an_asim | 1111 | 9 |
| mohammed_ayyub_drive | نعم | 6236 | ayah_1_included | hafs_an_asim | 694 | 4 |
| mohammed_burhaji_yt | نعم | 6236 | ayah_1_included | hafs_an_asim | 1054 | 29 |
| mohammed_saayed_warsh_mp3quran | نعم | 6214 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| mohammed_siddiq_al_minshawi_1967_drive | نعم | 6236 | ayah_1_included | hafs_an_asim | 539 | 8 |
| mohammed_siddiq_al_minshawi_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 467 | 3 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 896 | 12 |
| muammar_zainal_al_sukaini_way2quran | نعم | 6229 | ayah_1_included | hafs_an_asim | 418 | 2 |
| mustafa_ismail_mp3quran | نعم | 6236 | ayah_1_included | hafs_an_asim | 313 | 0 |
| nabil_al_rifai_mp3quran | لا | 6236 | ayah_1_included | hafs_an_asim | 942 | 7 |
| nasser_al_qatami_mp3quran | نعم | 6235 | absent | hafs_an_asim | 1660 | 53 |
| omar_al_qazabri_warsh_mp3quran | لا | 6214 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| saad_al_ghamdi_tarteel | نعم | 6235 | absent | hafs_an_asim | 740 | 15 |
| saber_abdulhakam_qalon_way2quran | نعم | 6194 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| saber_abdulhakam_shubah_way2quran | نعم | 6235 | ayah_1_included | shubah_an_asim | تشخيصي فقط | يتطلب مرجع الرواية |
| saber_abdulhakam_warsh_way2quran | نعم | 6213 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| saber_abdulhakam_yt | نعم | 6236 | ayah_1_included | hafs_an_asim | 603 | 3 |
| salah_al_budair_qdc | لا | 6235 | absent | hafs_an_asim | 741 | 11 |
| saud_al_shuraim_mp3quran | نعم | 6235 | absent | hafs_an_asim | 435 | 4 |
| wadie_al_yamani_tvquran | لا | 6235 | absent | hafs_an_asim | 671 | 9 |
| walid_al_naihi_qalon_mp3quran | نعم | 6195 | ayah_1_included | qalon_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| walid_atef_way2quran | نعم | 6235 | ayah_1_included | hafs_an_asim | 1261 | 11 |
| yasser_al_dosari_archive | نعم | 6235 | absent | hafs_an_asim | 1073 | 12 |
| yasser_al_dosari_yt | لا | 6236 | ayah_1_included | hafs_an_asim | 391 | 2 |
| yassin_al_jazaery_warsh_mp3quran | لا | 6214 | ayah_1_included | warsh_an_nafi | تشخيصي فقط | يتطلب مرجع الرواية |
| yusuf_bin_noah_ahmed_tvquran | لا | 6146 | ayah_1_included | hafs_an_asim | 2094 | 75 |
| mushafs | لا | 93 | ميتاداتا | — | تشخيصي فقط | يتطلب مرجع الرواية |

سبب ayah_1_included: وجود صف 1:1. سبب absent: غياب 1:1 وعدم وجود separate_clip معلن؛ لا يُستنتج محتوى صوت السورة ولا يُصنع مقطع. لم يظهر separate_clip معلن في هذه البيانات. النص المنطوق ومواقع diff محفوظة في cache منفصل خارج Git تحت %TEMP%/ayahx-d1/configs/*.recited.jsonl؛ لا يدخل quran_ayahs ولا production.

التفاصيل حسب كل سورة (تغطية آيات/توقيت كلمات كاملة، مع رفض الربط الفاشل) في docs/data/d1-config-audit.json. غياب 1:1 يبقى عدم توفر لهذه التلاوة.

## تقرير إغلاق D1 — توقف فحص Railway في 2026-10-09

1. **ما تغيّر:** أُضيف `docs/railway-ops-log.md` و`docs/data/d1-railway-preflight.json` لتوثيق فحص الإنتاج للقراءة فقط. لا تغيير جديد في كود التطبيق أو migrations أو البيانات.
2. **ما تحققت منه فعليًا:** CLI مسجل الدخول؛ قراءة SELECT داخل خدمة MySQL عبر SSH أعادت الإصدار **9.7.2** وcollation الخادم والقاعدة **utf8mb4_0900_ai_ci**. الترميز utf8mb4، packet=67108864 bytes، timezone=SYSTEM/system UTC، max_connections=60. لا قيم اتصال أو أسرار في الدليل.
3. **نتائج الاختبارات:** استعلام الفحص نجح، exit 0. محاولة الاتصال المحلي لم تتجاوز حارس غياب MYSQL_PUBLIC_URL، exit 1، ثم نجح المسار الداخلي عبر SSH. لم تُعد اختبارات المرحلة في هذه الجلسة؛ النتائج السابقة في تقرير D1 أعلاه، وليست دليلًا على مطابقة الإنتاج.
4. **ما لم يكتمل:** اختلاف collation يخالف شرط المستخدم، والإصدار الرئيسي يختلف عن اختبار 8.4.11؛ توقف التنفيذ عند البند الأول من بروتوكول Railway. لم يُنفذ جرد الجداول أو backup/restore أو البروفة أو الاستيراد؛ إضافات تدقيق البسملة/needs_review/عدّ الكلمات/الخطوط من الطلب الأخير ما زالت مطلوبة. لا push/PR أو بدء D2 في هذه الجلسة.
5. **المخاطر:** لا يصح تعميم اختبار MySQL 8.4.11 على 9.7.2؛ اختلاف collation قد يغير المقارنات والمفاتيح الفريدة. لا توجد نتيجة بعد تطبيق الإنتاج لأن التطبيق لم يحدث. التلاوات لم تُنشر.
6. **الخطوة التالية:** انتظار قرار المستخدم بشأن استثناء المطابقة: اختبار البروفة على 9.7.2 مع إبقاء collation الجداول الحالية واستخدام utf8mb4_unicode_ci للجداول الجديدة فقط. بعد الموافقة يُستأنف إغلاق D1 قبل D2؛ لا تعديل تلقائي على الإنتاج لمعالجة الفرق.


## إضافات تدقيق D1 — 2026-10-09

### أوائل السور 2–114 عدا 9، لكل تلاوة في Release

الفحص شمل 69 تلاوة × 112 سورة = 7728 موضعًا من صفوف HF الفعلية، مع مقارنة أول كلمة منطوقة وفهرسها بالنص القانوني لحفص فقط. «غائبة من النص المنطوق» تعني أن annotation المقطع لا يحتوي البسملة؛ **المقدمة الصوتية غير الموقّتة لم تُفحص صوتيًا، فلا يُدّعى غيابها من الموجة الصوتية**. لم توجد صفوف ayah=0 تعلن مقطعًا منفصلًا. بيانات كل سورة، first_start_ms وfirst_index، في docs/data/d1-followup-audit.json. للروايات الأخرى لا يوجد مرجع قانوني مستورد، ويظهر ذلك صراحة. basmala_mode لوجود 1:1، وتدقيق أوائل السور حقل مستقل في السبب؛ لا اختلاق لـ1:1 أو مقطع منفصل.

| التلاوة | البسملة داخل النص المنطوق: سور | مقاطع منفصلة معلنة | غائبة من annotation: سور | آية البداية غير متاحة: سور | مرجع أول فهرس كلمة |
|---|---|---:|---|---|---|
| abdul_hamid_ghraio_2025_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdul_hamid_ghraio_2026_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdulaziz_al_turki_yt | — | 0 | 2–8، 10–38، 40–78، 80–114 | 39، 79 | canonical_first_word: 2–8، 10–38، 40–78، 80–114; unavailable: 39، 79 |
| abdulbasit_abdulsamad_mujawwad_tarteel | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdulbasit_abdulsamad_tarteel | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdulbasit_abdulsamad_warsh_qdc | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| abdullah_al_buaijan_2025_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdullah_al_mattrod_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdullah_al_qarafi_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdullah_kamel_way2quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdulwadood_haneef_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdur_rashid_sufi_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| abdur_rashid_sufi_shubah_qdc | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| abu_bakr_al_shatri_tarteel | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| adel_al_karbalaei_archive_v2 | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmad_naseem_ali_ahmad_2019_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_al_ajmi_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_amer_tvquran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_deban_qalon_mp3quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| ahmed_issa_al_maasaraawi_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_kaseb_way2quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_nuayna_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_saleh_rajab_qalon_way2quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| ahmed_saud_mp3quran | — | 0 | 85–114 | 2–8، 10–84 | unavailable: 2–8، 10–84; canonical_first_word: 85–114 |
| ahmed_shaheen_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ahmed_talib_bin_humaid_mp3quran | — | 0 | 2–8، 10–13، 15، 18–22، 25–32، 34–114 | 14، 16–17، 23–24، 33 | canonical_first_word: 2–8، 10–13، 15، 18–22، 25–32، 34–114; unavailable: 14، 16–17، 23–24، 33 |
| akram_al_alaqmi_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ali_al_huthaifi_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ayman_swed_muallim_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| badr_al_turki_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| bandar_baleela_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| fatih_seferagic_way2quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| haitham_al_dukhain_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| hani_al_rifai_qdc_128k | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| ibrahim_al_akhdar_drive | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| imad_zuhair_hafez_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| islam_sobhi_mp3quran | — | 0 | 2–3، 5–6، 8، 10–36، 38، 41–43، 46–64، 66–114 | 4، 7، 37، 39–40، 44–45، 65 | canonical_first_word: 2–3، 5–6، 8، 10–36، 38، 41–43، 46–64، 66–114; unavailable: 4، 7، 37، 39–40، 44–45، 65 |
| khalid_al_mohana_drive | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| khalifa_al_tunaiji_tarteel | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| maher_al_muaiqly_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mahmoud_abdul_hakam_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mahmoud_ali_al_banna_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mahmoud_khalil_al_husary_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mahmoud_khalil_al_husary_qdc_128k | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mishary_rashid_al_afasy_2008_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mishary_rashid_al_afasy_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| moaz_mahmoud_hamed_qalon_way2quran | — | 0 | 2–8، 10–44، 46–114 | 45 | riwayah_canonical_reference_unavailable: 2–8، 10–44، 46–114; unavailable: 45 |
| mohammed_abdulkareem_qdc | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_al_luhaidan_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_alghazali_archive | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_ayyub_drive | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_burhaji_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_saayed_warsh_mp3quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| mohammed_siddiq_al_minshawi_1967_drive | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_siddiq_al_minshawi_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| muammar_zainal_al_sukaini_way2quran | — | 0 | 2–8، 10–76، 78–114 | 77 | canonical_first_word: 2–8، 10–76، 78–114; unavailable: 77 |
| mustafa_ismail_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| nasser_al_qatami_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| saad_al_ghamdi_tarteel | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| saber_abdulhakam_qalon_way2quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| saber_abdulhakam_shubah_way2quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| saber_abdulhakam_warsh_way2quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| saber_abdulhakam_yt | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| saud_al_shuraim_mp3quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| walid_al_naihi_qalon_mp3quran | — | 0 | 2–8، 10–114 | — | riwayah_canonical_reference_unavailable: 2–8، 10–114 |
| walid_atef_way2quran | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |
| yasser_al_dosari_archive | — | 0 | 2–8، 10–114 | — | canonical_first_word: 2–8، 10–114 |

### تصنيف الصفوف الـ1714 السابقة

النتيجة: 1707 تكرار مع اتفاق كل كلمة منطوقة مع الكلمة القانونية ذات الفهرس المعطى من المصدر؛ 0 اختلاف نص/علامات؛ 0 فرق NFC؛ 7 حالات أخرى بقيت needs_review. الأطفال: 808 تكرار +7 حالات لها أحداث كلمة بمدة صفرية. المواضع المتبقية: 5:116، 7:44، 7:57، 9:72، 9:98، 10:104، 33:7. لم تُصحّح مددها ولم يُغيّر القانوني.

كان SequenceMatcher يرفض إدراجًا طويلًا مكوّنًا من تكرارات عبارات متداخلة. الخوارزمية الحتمية الجديدة تتحقق من عدد أحداث المصدر مقابل الكلمات المنطوقة، ومن اتفاق كل token بعد NFC مع قانوني فهرسه، وتغطية جميع الكلمات وترتيب الزمن وصحة المدة. عند تحقق كل ذلك تُستخدم فهارس المصدر المثبتة؛ أي اختلاف يبقى needs_review. مقارنة NFC/إزالة العلامات تخص مفتاح المقارنة فقط، ولا تلمس النص المخزن. هذا تصحيح لحدّ matcher القديم؛ أسلوب التكرار مثبت في البيانات، وليس نصًا قانونيًا إضافيًا. اختبارات حقيقية البيانات لآيتي 2:22 (23 كلمة قانونية، 37 منطوقة/حدثًا) و2:31 (15 قانونية، 23 منطوقة/حدثًا) نجحت، مع رفض الفهرس الذي لا يطابق الكلمة. الأدلة الصغيرة في docs/data/d1-repetition-cases.json؛ لا corpus كامل في Git.

| reciter_id من metadata | التلاوة | needs_review السابق | تكرار بفهرس متحقق | نص/علامات | Unicode | أخرى |
|---|---|---:|---:|---:|---:|---:|
| abdul_hamid_ghraio | abdul_hamid_ghraio_2025_yt | 3 | 3 | 0 | 0 | 0 |
| abdul_hamid_ghraio | abdul_hamid_ghraio_2026_yt | 1 | 1 | 0 | 0 | 0 |
| abdulaziz_al_turki | abdulaziz_al_turki_yt | 9 | 9 | 0 | 0 | 0 |
| abdulbasit_abdulsamad | abdulbasit_abdulsamad_mujawwad_tarteel | 7 | 7 | 0 | 0 | 0 |
| abdulbasit_abdulsamad | abdulbasit_abdulsamad_tarteel | 2 | 2 | 0 | 0 | 0 |
| abdullah_al_mattrod | abdullah_al_mattrod_qdc | 2 | 2 | 0 | 0 | 0 |
| abdullah_al_qarafi | abdullah_al_qarafi_mp3quran | 8 | 8 | 0 | 0 | 0 |
| abdullah_basfar | abdullah_basfar_qdc | 68 | 68 | 0 | 0 | 0 |
| abdullah_kamel | abdullah_kamel_way2quran | 52 | 52 | 0 | 0 | 0 |
| abdulmohsin_al_qasim | abdulmohsin_al_qasim_qdc | 1 | 1 | 0 | 0 | 0 |
| abdulrahman_al_sudais | abdulrahman_al_sudais_tarteel | 5 | 5 | 0 | 0 | 0 |
| abdulrahman_al_sudais | abdulrahman_al_sudais_yt | 20 | 20 | 0 | 0 | 0 |
| abdulrahman_az_zawawi | abdulrahman_az_zawawi_way2quran | 21 | 21 | 0 | 0 | 0 |
| abdulwadood_haneef | abdulwadood_haneef_mp3quran | 21 | 21 | 0 | 0 | 0 |
| abdur_rashid_sufi | abdur_rashid_sufi_qdc | 1 | 1 | 0 | 0 | 0 |
| abu_bakr_al_shatri | abu_bakr_al_shatri_tarteel | 71 | 71 | 0 | 0 | 0 |
| adel_al_karbalaei | adel_al_karbalaei_archive_v2 | 1 | 1 | 0 | 0 | 0 |
| ahmad_naseem_ali_ahmad | ahmad_naseem_ali_ahmad_2019_yt | 7 | 7 | 0 | 0 | 0 |
| ahmed_al_ajmi | ahmed_al_ajmi_qdc | 21 | 21 | 0 | 0 | 0 |
| ahmed_amer | ahmed_amer_tvquran | 2 | 2 | 0 | 0 | 0 |
| ahmed_issa_al_maasaraawi | ahmed_issa_al_maasaraawi_mp3quran | 6 | 6 | 0 | 0 | 0 |
| ahmed_kaseb | ahmed_kaseb_way2quran | 4 | 4 | 0 | 0 | 0 |
| ahmed_nuayna | ahmed_nuayna_qdc | 1 | 1 | 0 | 0 | 0 |
| ahmed_shaheen | ahmed_shaheen_mp3quran | 7 | 7 | 0 | 0 | 0 |
| ahmed_talib_bin_humaid | ahmed_talib_bin_humaid_mp3quran | 17 | 17 | 0 | 0 | 0 |
| akram_al_alaqmi | akram_al_alaqmi_qdc | 25 | 25 | 0 | 0 | 0 |
| al_hussayni_al_azazy | al_hussayni_al_azazy_kids_qdc | 815 | 808 | 0 | 0 | 7 |
| ali_al_huthaifi | ali_al_huthaifi_mp3quran | 8 | 8 | 0 | 0 | 0 |
| ali_hajjaj_al_souasi | ali_hajjaj_al_souasi_qdc | 1 | 1 | 0 | 0 | 0 |
| anas_almiman | anas_almiman_yt | 2 | 2 | 0 | 0 | 0 |
| ayman_swed | ayman_swed_muallim_yt | 14 | 14 | 0 | 0 | 0 |
| badr_al_turki | badr_al_turki_yt | 5 | 5 | 0 | 0 | 0 |
| bandar_baleela | bandar_baleela_qdc | 14 | 14 | 0 | 0 | 0 |
| haitham_al_dukhain | haitham_al_dukhain_mp3quran | 12 | 12 | 0 | 0 | 0 |
| hani_al_rifai | hani_al_rifai_qdc_128k | 12 | 12 | 0 | 0 | 0 |
| hatem_fareed_al_waer | hatem_fareed_al_waer_mp3quran | 9 | 9 | 0 | 0 | 0 |
| ibrahim_al_akhdar | ibrahim_al_akhdar_drive | 3 | 3 | 0 | 0 | 0 |
| islam_sobhi | islam_sobhi_mp3quran | 9 | 9 | 0 | 0 | 0 |
| khalid_al_mohana | khalid_al_mohana_drive | 2 | 2 | 0 | 0 | 0 |
| khalid_al_qahtani | khalid_al_qahtani_mp3quran | 18 | 18 | 0 | 0 | 0 |
| khalifa_al_tunaiji | khalifa_al_tunaiji_tarteel | 6 | 6 | 0 | 0 | 0 |
| maher_al_muaiqly | maher_al_muaiqly_tarteel | 25 | 25 | 0 | 0 | 0 |
| mahmoud_abdul_hakam | mahmoud_abdul_hakam_mp3quran | 8 | 8 | 0 | 0 | 0 |
| mahmoud_ali_al_banna | mahmoud_ali_al_banna_qdc | 1 | 1 | 0 | 0 | 0 |
| mahmoud_khalil_al_husary | mahmoud_khalil_al_husary_mp3quran | 1 | 1 | 0 | 0 | 0 |
| mahmoud_khalil_al_husary | mahmoud_khalil_al_husary_mujawwad_tarteel | 9 | 9 | 0 | 0 | 0 |
| mahmoud_khalil_al_husary | mahmoud_khalil_al_husary_qdc_128k | 2 | 2 | 0 | 0 | 0 |
| majed_al_zamil | majed_al_zamil_yt | 8 | 8 | 0 | 0 | 0 |
| mishary_rashid_al_afasy | mishary_rashid_al_afasy_2008_qdc | 25 | 25 | 0 | 0 | 0 |
| mishary_rashid_al_afasy | mishary_rashid_al_afasy_mp3quran | 18 | 18 | 0 | 0 | 0 |
| mohammed_abdulkareem | mohammed_abdulkareem_qdc | 9 | 9 | 0 | 0 | 0 |
| mohammed_al_luhaidan | mohammed_al_luhaidan_mp3quran | 25 | 25 | 0 | 0 | 0 |
| mohammed_al_tablawi | mohammed_al_tablawi_qdc | 1 | 1 | 0 | 0 | 0 |
| mohammed_alghazali | mohammed_alghazali_archive | 9 | 9 | 0 | 0 | 0 |
| mohammed_ayyub | mohammed_ayyub_drive | 4 | 4 | 0 | 0 | 0 |
| mohammed_burhaji | mohammed_burhaji_yt | 29 | 29 | 0 | 0 | 0 |
| mohammed_siddiq_al_minshawi | mohammed_siddiq_al_minshawi_1967_drive | 8 | 8 | 0 | 0 | 0 |
| mohammed_siddiq_al_minshawi | mohammed_siddiq_al_minshawi_mp3quran | 3 | 3 | 0 | 0 | 0 |
| mohammed_siddiq_al_minshawi | mohammed_siddiq_al_minshawi_mujawwad_mp3quran | 12 | 12 | 0 | 0 | 0 |
| muammar_zainal_al_sukaini | muammar_zainal_al_sukaini_way2quran | 2 | 2 | 0 | 0 | 0 |
| nabil_al_rifai | nabil_al_rifai_mp3quran | 7 | 7 | 0 | 0 | 0 |
| nasser_al_qatami | nasser_al_qatami_mp3quran | 53 | 53 | 0 | 0 | 0 |
| saad_al_ghamdi | saad_al_ghamdi_tarteel | 15 | 15 | 0 | 0 | 0 |
| saber_abdulhakam | saber_abdulhakam_yt | 3 | 3 | 0 | 0 | 0 |
| salah_al_budair | salah_al_budair_qdc | 11 | 11 | 0 | 0 | 0 |
| saud_al_shuraim | saud_al_shuraim_mp3quran | 4 | 4 | 0 | 0 | 0 |
| wadie_al_yamani | wadie_al_yamani_tvquran | 9 | 9 | 0 | 0 | 0 |
| walid_atef | walid_atef_way2quran | 11 | 11 | 0 | 0 | 0 |
| yasser_al_dosari | yasser_al_dosari_archive | 12 | 12 | 0 | 0 | 0 |
| yasser_al_dosari | yasser_al_dosari_yt | 2 | 2 | 0 | 0 | 0 |
| yusuf_bin_noah_ahmed | yusuf_bin_noah_ahmed_tvquran | 75 | 75 | 0 | 0 | 0 |

### مرجع عدّ الكلمات

المرجع digital_khatt_v2_script.json ومقادير num_words في surah_info.json، كلاهما مثبّت بـSHA-256 في source manifest. عدد الكلمات 77433 بعد استبعاد 6236 ornament نهائيًا لرقم الآية. فُحصت الكلمات كلها: 0 token مستقل بلا حرف؛ علامات الوقف والتشكيل الملحقة بالكلمة تبقى داخلها كما وردت. عدد الأحداث قد يزيد بسبب التكرار، وأعلى فهرس لا يمثل عدد الكلمات المنطوقة. لا تعديل للعدّ القانوني.

| التلاوة | الآية | القانوني | كلمات المنطوق | أحداث توقيت | أعلى word index |
|---|---|---:|---:|---:|---:|
| abdul_hamid_ghraio_2025_yt | 2:22 | 23 | 25 | 25 | 23 |
| abdul_hamid_ghraio_2025_yt | 2:31 | 15 | 17 | 17 | 15 |
| abdul_hamid_ghraio_2025_yt | 112:1 | 4 | 4 | 4 | 4 |
| abdul_hamid_ghraio_2026_yt | 2:22 | 23 | 23 | 23 | 23 |
| abdul_hamid_ghraio_2026_yt | 2:31 | 15 | 17 | 17 | 15 |
| abdul_hamid_ghraio_2026_yt | 112:1 | 4 | 4 | 4 | 4 |
| abdulaziz_al_turki_yt | 1:1 | 4 | 4 | 4 | 4 |
| abdulaziz_al_turki_yt | 2:22 | 23 | 24 | 24 | 23 |
| abdulaziz_al_turki_yt | 2:31 | 15 | 17 | 17 | 15 |
| abdulaziz_al_turki_yt | 112:1 | 4 | 4 | 4 | 4 |
| abdulbasit_abdulsamad_mujawwad_tarteel | 1:1 | 4 | 4 | 4 | 4 |
| abdulbasit_abdulsamad_mujawwad_tarteel | 2:22 | 23 | 29 | 29 | 23 |
| abdulbasit_abdulsamad_mujawwad_tarteel | 2:31 | 15 | 19 | 19 | 15 |
| abdulbasit_abdulsamad_mujawwad_tarteel | 112:1 | 4 | 4 | 4 | 4 |
| abdulbasit_abdulsamad_tarteel | 1:1 | 4 | 4 | 4 | 4 |
| abdulbasit_abdulsamad_tarteel | 2:22 | 23 | 23 | 23 | 23 |
| abdulbasit_abdulsamad_tarteel | 2:31 | 15 | 15 | 15 | 15 |
| abdulbasit_abdulsamad_tarteel | 112:1 | 4 | 4 | 4 | 4 |
| abdullah_al_buaijan_2025_yt | 1:1 | 4 | 4 | 4 | 4 |
| abdullah_al_buaijan_2025_yt | 2:22 | 23 | 23 | 23 | 23 |
| abdullah_al_buaijan_2025_yt | 2:31 | 15 | 15 | 15 | 15 |
| abdullah_al_buaijan_2025_yt | 112:1 | 4 | 4 | 4 | 4 |

### الخطوط الناقصة القابلة للاختيار

مصدر الاختيار الفعلي shared/planEntitlements.ts وTextSettingsPanel.tsx؛ القائمة نفسها متاحة لنص القرآن ولا توجد بوابة خاصة بتغطية رموزه. الجدول يعرض نقص cmap في ملفات render الموثوقة على كل رموز corpus المرئية الـ68. Cairo مجاني والبقية Premium. قد يخفي fallback نقص الخط في المتصفح؛ هذا ليس إثبات تغطية للخط المختار. U+034F تحكم غير مطبوع محفوظ في القانوني، ويُسجل منفصلًا. Amiri/Amiri Quran/Lateef/Mada/Noto Naskh Arabic/Scheherazade New تغطي corpus. لم تتغير الواجهة أو خياراتها. بند D8/A4: حصر نص القرآن في الخطوط المعتمدة فقط بعد الموافقة على الربط.

| ملف الخط | قابل للاختيار للقرآن | الرموز المرئية الناقصة |
|---|---|---|
| arefruqaa.ttf | نعم (Premium) | U+065C U+06D6 U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F2 U+08F3 |
| cairo.ttf | نعم (مجاني) | U+065C U+06D6 U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F1 U+08F2 U+08F3 |
| elmessiri.ttf | نعم (Premium) | U+065C U+06D6 U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F1 U+08F2 U+08F3 |
| katibeh.ttf | نعم (Premium) | U+06E5 |
| lalezar.ttf | نعم (Premium) | U+065C U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F1 U+08F2 U+08F3 |
| marhey.ttf | نعم (Premium) | U+065C U+06D6 U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F1 U+08F2 U+08F3 |
| mirza.ttf | نعم (Premium) | U+06E5 |
| rakkas.ttf | نعم (Premium) | U+065C U+06D6 U+06D7 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+08F0 U+08F1 U+08F2 U+08F3 |
| reemkufi.ttf | نعم (Premium) | U+065C U+06D6 U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F1 U+08F2 U+08F3 |
| tajawal.ttf | نعم (Premium) | U+065C U+0671 U+06D6 U+06D7 U+06D8 U+06DA U+06DB U+06DC U+06DE U+06DF U+06E0 U+06E2 U+06E3 U+06E5 U+06E6 U+06E7 U+06E8 U+06E9 U+06EC U+06ED U+08F0 U+08F1 U+08F2 U+08F3 |

## تقرير المرحلة D1 — نتيجة الاستئناف على MySQL 9.7.2

1. **ما تغيّر:** bin صريح لـtext_uthmani القانوني، وunicode_ci صريح لكل metadata/table/column وفق جرد القاعدة الفعلي. SQL حتمي ومشغل Railway مقيّد مستقل عن حارس اختبار loopback. الجداول السبعة طُبقت إضافيًا على staging ثم الإنتاج؛ لا FK إلى جدول قائم ولا ALTER ولا UI/render تغيير. الفرع `phase/d1-quran-text` و[PR #9](https://github.com/jokertools12/AyahX/pull/9)، دون merge/deploy.
2. **ما تحقق فعليًا:** جرد 40 جدولًا و34 FK وصفر triggers/events قبل التطبيق. النسخة المنطقية استعيدت محليًا وتطابقت أعداد وCHECKSUM TABLE للجداول الأربعين. كامل اختبارات up/import مرتين وفساد النص وrollback/reapply نجحت على 9.7.2؛ actual collations وDISTINCT/unique للحركات وjoin مع users نجحت. staging منفصلة بإصدار 9.7.2 مثبت بالـserver_uuid. الإنتاج **114/6236/77433**، checksum القانوني `eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4`، كامل الكلمات مطابق أيضًا. أعداد الجداول الحرجة قبل/بعد متساوية، وhealth/ready=200، ولا errors جديدة في لوج MySQL/app منذ قبل التطبيق. كل الأوامر وSQL SHA في [railway-ops-log.md](railway-ops-log.md)؛ الأدلة المنظّمة في `docs/data/d1-railway-production-verification.json` و`d1-production-schema-check.json` و`d1-service-postcheck.json`.
3. **نتائج الاختبارات:** Vitest 439 passed/6 skipped؛ Python 6/6؛ E2E 1/1 مع لقطتي UI/harness مفحوصتين، 21202 كلمة فريدة وcmap لكل corpus. TypeScript root والتحقق الصريح لملفات السيرفر ناجحان؛ lint الجديد صفر، ولم تزد تحذيرات services.ts الحالية. lint العام غير أخضر وخارج النطاق المعتمد. اختبارات الريندر القائمة شملت FFmpeg وSkia وChromium فعليًا.
4. **ما لم يكتمل:** تصنيف المقدمات الصوتية غير المعلّقة لكل أوائل السور، رغم اكتمال جدول annotation والفهارس. طلب clip حديث من HF ثم فحص ثلاث configs مستقلة أعاد HTTP500: `The server is busier than usual and the response is not ready yet. Please retry later.` لا صوت نُزل، ولا absent صوتي استُنتج من annotation؛ [d1-hf-audio-access.json](data/d1-hf-audio-access.json). لذلك تطبيق بيانات D1 ناجح، لكن **إغلاق D1 الكامل معلق ولا يبدأ D2** قبل استكمال هذا البند. snapshot الجديد لم يتوفر؛ المحاولة الوحيدة أعادت INTERNAL_SERVER_ERROR، والقراءة بعدها أثبتت عدم إنشائه؛ النسخة المنطقية المتحققة متاحة.
5. **المخاطر:** 7 صفوف توقيت معيبة تبقى needs_review؛ 10 خطوط متاحة للاختيار ناقصة رموز قرآنية، والإصلاح في D8/A4 بعد موافقة الربط. لا تلاوة نُشرت ولا بيانات توقيت اعتُمدت، ولا تدقيق annotation يعادل فحص الموجة الصوتية. dump خاص خارج Git/السحابة؛ يبقى حتى إغلاق D1 ثم يُحذف حسب قرار المستخدم، ولا تُحذف نسخة Railway القائمة.
6. **الخطوة التالية:** استكمال فحص البسملة الصوتي عند استجابة المصدر، ثم إعلان إغلاق D1 وبدء D2 بالتصريح الحالي؛ D3/A1 غير مصرّح بهما. لا طلب نشر/دمج جديد ولا تعديل إعدادات مطلوب في هذه الخطوة.

## D2 — كتالوج القراء والتلاوات (توقّف قبل الإنتاج، 2026-10-09)

**قرار المستخدم الأخير يغلب بند التعليق التاريخي في تقرير D1 أعلاه:** D1 مقبول ومغلق وظيفيًا، و`basmala_audio_unverified` مفتوح للنشر/الريندر فقط. التصريح D2 ، لا D3/A1 ، ولا merge/deploy تطبيق.

### المصدر والجداول والسياسات الفعلية

مصدر metadata هو QUD Release v3.2.0 ؛ الملف الحالي SHA256 `b7ee26c2267b086d5758477e21144887c28c6ba884a6ff5157a55cf17df4eed4`. هو الإصدار نفسه، لكن الناشر صحح chapter_urls لتلاوة saber من مسارات scratch إلى روابط YouTube ؛ البصمة القديمة والجديدة والفروق مثبتة في [d2-catalog-source.json](data/d2-catalog-source.json). لا يُستنتج رابط من مسار غير صالح، ولا fallback إلى HF كصوت إنتاج.

الجداول الأربع: reciters ، audio_providers ، recitations ، recitation_chapters. بيانات الملف تحسب 69 تلاوة، 57 قارئًا بالـ reciter_id ، 10 مزوّدين توثيقيين (بما فيهم EveryAyah/QDC القائمان)، 7765 رابط سورة فعليًا. لا دمج بالأسماء ولا تخمين بلد؛ فحص الأسماء/البلدان عبر مصادر reciter_id المشتركة وجد صفر تعارض، [d2-reciter-metadata.json](data/d2-reciter-metadata.json). metadata بـ utf8mb4_unicode_ci صريح، و 3 FKs داخل الجديدة فقط. riwayah_id VARCHAR(36) دون FK قائم. الاستثناء القائم الوحيد INSERT الثلاثة غير حفص inactive في riwayat ، دون تعديل صف حفص أو النص.

التغطية من catalog ومقارنتها بآيات snapshot D1 الفعلية. فحص مجموعات معرّفات الآيات كلها في حفص: صفر معرّف غير قانوني؛ قائمة السور المكتملة والمفقود في [d2-ayah-coverage.json](data/d2-ayah-coverage.json). الروايات غير حفص imported/canonical_text_available=false ، و expected_ayahs و coverage_mismatch=NULL لغياب مرجعها، دون إسقاط عدّ حفص. timing_complete/coverage_words=NULL و timing_level=none ، و is_complete مولد false حتى D3. وجود audio URL لا يعني اكتمال تغطية أو توقيت.

basmala_mode يخص وجود 1:1 فقط، وتفصل عنه حالة نص افتتاحات السور من annotation وحالة الصوت. كل حالة صوتية unverified ؛ تحليل prefix (طول/RMS/صمت) دليل للمراجعة وليس تفريغًا أو ادعاء absence. importer يمنع published ، وقيد DB يرفض النشر دون مراجعة صوت البسملة بدليل ومرجع قانوني و offset وتوقيت معتمد. ثبت الرفض على MySQL9.7.2 الحقيقي؛ قيد is_complete لم يصبح true مع NULL.

فحص source_offset محلي من catalog original كامل + HF Parquet audio ranges أولًا. NCC أقصى ±300ms ؛ خمس آيات distinct موزعة من 3 سور مختلفة الطول، score≥0.95 ومدة≤30ms و abs(lag)≤30ms لكل عينة. نتائج الفحص تُستأنف دون إعادة تحسين فشل مكتمل. lag ثابت غير صفري يسجل فقط ويبقي حفص needs_review حتى المراجعة. الصوت يُحذف بعد كل محاولة، ولا يُرفع أو يستضاف. روابط YouTube/Drive التي تعيد صفحة لا bytes صوت موثقة source_unavailable لمسار التدقيق الحالي، دون الادعاء أن التسجيل محذوف من المزوّد.

اختيار السور اللاحق يسبق أي قياس صوت: أقصر/متوسطة/أطول أعداد آيات مختلفة في الثلث الأخير للمؤهلة من annotation ، وخمس بداية/ربع/وسط/ثلاثة أرباع/نهاية؛ الأدلة الأولى بقيت كما هي. Parquet statistics و surah predicate يحدان column reads دون تقليل العينة. تجربة seek HTTP Range لملف قصير نجحت، لكنها تعثّرت على طويل بعد 120s ؛ لذلك فحص القبول يستخدم تنزيلًا كاملاً. [الضبط الحقيقي الموجب والسالب](data/d2-real-offset-controls.json) أثبت score0.98880387/lag0.25ms/delta16.625ms نجاحًا و score0.05202221 عند+1000ms رفضًا؛ مُعيقلي الكامل يبقى failed بسبب 36:83(score0.93806561).

### بروتوكول التشغيل ودليل الاختبارات الحالي

جرد الإنتاج 47 جدولًا و staging86 ، كلاهما MySQL9.7.2 و UUID مختلف، دون تصادم D2. استعيد dump الإنتاج 47 جدولًا محليًا وطابقت الأعداد و CHECKSUM جميعها، بما فيها الحرجة و D1. النسخة الحالية age X25519 خارج Git/cloud: `C:\Users\cpazi\AppData\Local\AyahX\private-backups\d2-production-20261009.sql.age`، ومفتاح منفصل بصلاحيات الحساب فقط. حُذف dump D1 فقط بعد تحقق D2. محاولة Snapshot الإضافية الوحيدة رفضت: `Manual backups and backup schedules are only available for Pro workspaces`؛ لا retry إضافيًا ولا تغيير volume. [d2-backup-verification.json](data/d2-backup-verification.json)، [d2-snapshot-attempt.json](data/d2-snapshot-attempt.json).

المشغل يتحقق من سلامة الملف المشفر وبصمته، ويربط البروفة بـ SQL SHA نفسه، ويرفض أي pending أو نقص سجل محاولات قبل Railway. إثبات staging ببصمة SQL نفسها إلزامي لأمر production مستقل مع --apply --confirm-production. البروفة المدمرة محلية فقط: up/import مرتان، CHECKSUM الأربع ثابت، corruption/publication رفض، rollback/reapply. التقرير الذي ينتهي pending مبدئي، وليس إثبات SQL النهائي أو تطبيق Railway.

Vitest الحالي:451passed/6skipped/0failed ؛ الستة تكامل DB/BullMQ opt-in ، لا مهمة خلفية جديدة في D2. FFmpeg/Skia/Chromium واختبار corpus القائم شُغّلت. Python6/6 ؛ rootTS و strict للمتغير ناجحان، lint للمتغير صفر errors/warnings. لا معالجة lint العام أو EPERM بتغيير lockfile. [d2-tests.json](data/d2-tests.json). فحص health/readiness الحالي للقراءة فقط أعاد 200/ok و 200/ready/database connected ، ولوج MySQL/app صفر أخطاء في نافذته، [d2-service-readonly-smoke.json](data/d2-service-readonly-smoke.json). هذه قراءة baseline ، وليست تحقق ما بعد التطبيق.

### نتيجة D2 عند التوقف

**D2 غير مغلق: الإنتاج لم يُطبّق.** اكتملت البيانات والبروفة المحلية، ونُفّذ أمر staging مرة واحدة. خرج الأمر بـ`RAILWAY_SSH_EXIT_1`، وأعادت قراءة SSH التشخيصية لاحقًا `Maximum SSH connections reached for this service. Close an existing session and try again.` تعذّر الجرد الكامل الأول والتحقق القياسي اللاحق أيضًا. لم يُعد أي أمر كتابة. لا يُنسب الخطأ إلى SQL معيّن دون دليل؛ التشخيص يثبت حد اتصالات القراءة اللاحقة.

المصالحة اللاحقة للقراءة فقط **نجحت** باتصال mysql/SSH واحد، عبر السكربت المحفوظ `scripts/reconcile-qud-catalog-readonly.ts`: جميع حقول/JSON الصفوف الأربعة مطابقة، والتوقيت NULL ، و is_complete=false ، والروايات الثلاث inactive. ثبتت 4 جداول/46 عمود metadata نصي unicode_ci/3FK داخلية، و D1/bin/CHECKSUM للجداول الستة النصية والترجمة والجداول الحرجة ثابتة. هذه نتيجة قراءة فعلية، ولا تغيّر رمز خروج أمر التطبيق الأصلي أو تصنع `applied=true` له. [مصالحة staging](data/d2-staging-readonly-reconciliation.json)، [سجل الواقعة](data/d2-staging-apply-incident.json).

قراءة production اللاحقة أثبتت **صفر جداول D2** و riwayat=1 ، وبقاء النص/الـ CHECKSUM/الـ collations والجداول الحرجة. لم يُنفذ production dry-run/apply ولم يجر deploy أو merge أو تعديل إعداد خدمة. أمر production ما زال يتطلب إثبات staging القياسي `applied=true`، ولا جرى تجاوز حارسه أو إعادة تصنيف ملف المصالحة إليه. [مصالحة production](data/d2-production-readonly-reconciliation.json).

SQL الحتمي النهائي SHA256 `2498e681f2be2e1e9398e7dcdcb9731e8861ac331087dad2bb3c65a4507958b8`؛ 9739641 بايت، دفعات 250 ، خارج Git. up/import مرتان و rollback/reapply ، رفض فساد URL ، ورفض النشر مع بسملة غير متحققة أو بلا evidence ، ورفض surah_slice بلا offset و offset بلا score: نجحت على MySQL9.7.2. [البروفة النهائية](data/d2-local-rehearsal.json).

### جدول التلاوات الكامل عند D2

التغطية = عدّ catalog / الآيات الفريدة المرصودة في HF D1 ، وليست تغطية توقيت الكلمات. ayahs_complete33 لحفص فقط؛ غير حفص لا مرجع قانوني لها هنا. basmala_mode=absent يخص فقد 1:1 ، ولا يعني غياب البسملة من صوت أول السورة. text_status يخص annotation فقط. جميع حالات الصوت unverified ، وجميع الصفوف غير منشورة؛ coverage_words/timing_complete=NULL و is_complete=false.

| التلاوة | الرواية | تغطية catalog / HF | basmala_mode | حالة نص افتتاح السورة | حالة الصوت | offset_verified | verification_status | ayahs_complete | status |
|---|---|---:|---|---|---|---|---|---|---|
| abdul_hamid_ghraio_2025_yt | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | source_unavailable | لا | needs_review |
| abdul_hamid_ghraio_2026_yt | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | source_unavailable | لا | needs_review |
| abdulaziz_al_turki_yt | hafs_an_asim | 6115 / 6115 | ayah_1_included | mixed_or_unavailable | unverified | لا | source_unavailable | لا | needs_review |
| abdulbasit_abdulsamad_mujawwad_tarteel | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| abdulbasit_abdulsamad_tarteel | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| abdulbasit_abdulsamad_warsh_qdc | warsh_an_nafi | 6214 / 6178 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | لا | imported |
| abdullah_al_buaijan_2025_yt | hafs_an_asim | 6235 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | لا | needs_review |
| abdullah_al_mattrod_qdc | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| abdullah_al_qarafi_mp3quran | hafs_an_asim | 6223 / 6223 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | لا | imported |
| abdullah_kamel_way2quran | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| abdulwadood_haneef_mp3quran | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| abdur_rashid_sufi_qdc | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| abdur_rashid_sufi_shubah_qdc | shubah_an_asim | 6236 / 6230 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| abu_bakr_al_shatri_tarteel | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| adel_al_karbalaei_archive_v2 | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| ahmad_naseem_ali_ahmad_2019_yt | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| ahmed_al_ajmi_qdc | hafs_an_asim | 6235 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| ahmed_amer_tvquran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| ahmed_deban_qalon_mp3quran | qalon_an_nafi | 6214 / 6190 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| ahmed_issa_al_maasaraawi_mp3quran | hafs_an_asim | 6234 / 6234 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| ahmed_kaseb_way2quran | hafs_an_asim | 6235 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| ahmed_nuayna_qdc | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| ahmed_saleh_rajab_qalon_way2quran | qalon_an_nafi | 6213 / 6126 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| ahmed_saud_mp3quran | hafs_an_asim | 327 / 327 | absent | mixed_or_unavailable | unverified | لا | failed | لا | needs_review |
| ahmed_shaheen_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| ahmed_talib_bin_humaid_mp3quran | hafs_an_asim | 5561 / 5561 | ayah_1_included | mixed_or_unavailable | unverified | لا | failed | لا | needs_review |
| akram_al_alaqmi_qdc | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| ali_al_huthaifi_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | نعم | imported |
| ayman_swed_muallim_yt | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| badr_al_turki_yt | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| bandar_baleela_qdc | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| fatih_seferagic_way2quran | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| haitham_al_dukhain_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | نعم | needs_review |
| hani_al_rifai_qdc_128k | hafs_an_asim | 6234 / 6233 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| ibrahim_al_akhdar_drive | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| imad_zuhair_hafez_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | نعم | imported |
| islam_sobhi_mp3quran | hafs_an_asim | 5334 / 5275 | ayah_1_included | mixed_or_unavailable | unverified | لا | failed | لا | needs_review |
| khalid_al_mohana_drive | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| khalifa_al_tunaiji_tarteel | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| maher_al_muaiqly_qdc | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mahmoud_abdul_hakam_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mahmoud_ali_al_banna_qdc | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mahmoud_khalil_al_husary_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mahmoud_khalil_al_husary_mujawwad_tarteel | hafs_an_asim | 6235 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| mahmoud_khalil_al_husary_qdc_128k | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mishary_rashid_al_afasy_2008_qdc | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mishary_rashid_al_afasy_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| moaz_mahmoud_hamed_qalon_way2quran | qalon_an_nafi | 6177 / 6175 | ayah_1_included | mixed_or_unavailable | unverified | لا | failed | لا | imported |
| mohammed_abdulkareem_qdc | hafs_an_asim | 6235 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | لا | needs_review |
| mohammed_al_luhaidan_mp3quran | hafs_an_asim | 6234 / 6234 | absent | basmala_not_in_recited_text | unverified | نعم | passed | لا | needs_review |
| mohammed_alghazali_archive | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mohammed_ayyub_drive | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| mohammed_burhaji_yt | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| mohammed_saayed_warsh_mp3quran | warsh_an_nafi | 6214 / 6214 | ayah_1_included | basmala_not_in_recited_text | unverified | نعم | passed | لا | imported |
| mohammed_siddiq_al_minshawi_1967_drive | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| mohammed_siddiq_al_minshawi_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| muammar_zainal_al_sukaini_way2quran | hafs_an_asim | 6229 / 6229 | ayah_1_included | mixed_or_unavailable | unverified | لا | failed | لا | needs_review |
| mustafa_ismail_mp3quran | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | نعم | needs_review |
| nasser_al_qatami_mp3quran | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| saad_al_ghamdi_tarteel | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| saber_abdulhakam_qalon_way2quran | qalon_an_nafi | 6214 / 6194 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| saber_abdulhakam_shubah_way2quran | shubah_an_asim | 6236 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| saber_abdulhakam_warsh_way2quran | warsh_an_nafi | 6214 / 6213 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| saber_abdulhakam_yt | hafs_an_asim | 6236 / 6236 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | source_unavailable | نعم | needs_review |
| saud_al_shuraim_mp3quran | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| walid_al_naihi_qalon_mp3quran | qalon_an_nafi | 6214 / 6195 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | imported |
| walid_atef_way2quran | hafs_an_asim | 6235 / 6235 | ayah_1_included | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |
| yasser_al_dosari_archive | hafs_an_asim | 6235 / 6235 | absent | basmala_not_in_recited_text | unverified | لا | failed | لا | needs_review |

### الاستثناءات والأدلة الصوتية

نتيجة 69 تلاوة:8passed و 48failed و 13source_unavailable ، صفر pending ، 69 سجل محاولة و 840 عينة NCC فعلية (15 عينة للتلاوات الـ 56 القابلة للتدقيق). المحاولة غير المتاحة للمصدر لا تُعد فشلًا صوتيًا. جميع 13 من روابط catalog الأصلية؛ لم تُصنّف أي حالة HF unavailable تُختصر معها سياسة النوافذ الثلاث. Parquet كان المسار الفعلي؛ signed clips/audio scratch حُذفت جميعها. [نتائج كل عينة](data/d2-offset-verification.json)، [الاستثناءات](data/d2-exceptions.json).

8 نتائج offset متحققة لا تعني 8 تلاوات صالحة للنشر. التصحيح الثابت غير الصفري مسجّل فقط؛ حفص الذي يحتاجه يبقى needs_review ، وغير حفص imported بلا نص قانوني. 10 تلاوات غير حفص، 13imported و 56needs_review ؛ الجميع غير منشور. basmala_mode:55ayah_1_included و 14absent ؛ لا دليل separate_clip. حالة annotation:63basmala_not_in_recited_text و 6mixed_or_unavailable. لا تقرير غياب صوت البسملة، ولا تشغيل Aligner أو D5 في هذه المرحلة.

**انحراف النقل الموثّق:** أقل فاصل فعلي في آخر عملية تدقيق مستأنفة 1.985s ، أقل من شرط 2s بنحو 15ms. لم تُغيّر القيمة القديمة ولم تُعد عينات فاشلة لتحسين نتيجتها. جرى إصلاح pace بإعادة فحص deadline ؛ 7/7 وحدات Python ، و 3HEAD حقيقية مع redirects (6 طلبات) أثبتت أقل فاصل 2.0s دون تنزيل صوت. [دليل التصحيح](data/d2-transport-pacing-control.json). إحصاءات النقل الأخيرة تخص عملية الاستئناف الأخيرة وليست مجموع عمليات الفحص التاريخية.

التلاوات التي فشلت لها خيار D5 لاحق: المحاذاة على الصوت الذي سيُخدم فعلًا. لا تطبيق correction أو timing تقريبي. تفاصيل mismatch/missing ranges ومعرّفات الآيات في [d2-ayah-coverage.json](data/d2-ayah-coverage.json). تراخيص الصوت والـ attribution لم تثبت من المصدر:NULL ، والمزوّدون غير مفعّلين/healthunchecked. bio/photo/is_featured/sort_order/priority/last_checked_at أيضًا NULL دون معلومات مصطنعة.

| failed config | أدنى NCC | عدد العينات المرفوضة |
|---|---:|---:|
| abdulbasit_abdulsamad_mujawwad_tarteel | 0.56377778 | 7 |
| abdulbasit_abdulsamad_tarteel | 0.37945573 | 7 |
| abdullah_al_mattrod_qdc | 0.23156619 | 1 |
| abdullah_kamel_way2quran | 0.14085619 | 6 |
| abdulwadood_haneef_mp3quran | 0.82327665 | 6 |
| abdur_rashid_sufi_qdc | 0.93475225 | 1 |
| abdur_rashid_sufi_shubah_qdc | 0.32600671 | 2 |
| abu_bakr_al_shatri_tarteel | 0.20549451 | 3 |
| adel_al_karbalaei_archive_v2 | 0.20222689 | 3 |
| ahmed_al_ajmi_qdc | 0.27977153 | 5 |
| ahmed_amer_tvquran | 0.97377819 | 1 |
| ahmed_deban_qalon_mp3quran | 0.92241244 | 5 |
| ahmed_issa_al_maasaraawi_mp3quran | 0.9368733 | 2 |
| ahmed_kaseb_way2quran | 0.19738515 | 15 |
| ahmed_nuayna_qdc | 0.30031817 | 4 |
| ahmed_saleh_rajab_qalon_way2quran | 0.13331352 | 1 |
| ahmed_saud_mp3quran | 0.89284286 | 5 |
| ahmed_shaheen_mp3quran | 0.80653435 | 7 |
| ahmed_talib_bin_humaid_mp3quran | 0.89251828 | 2 |
| akram_al_alaqmi_qdc | 0.30281426 | 4 |
| bandar_baleela_qdc | 0.21324602 | 4 |
| fatih_seferagic_way2quran | 0.17826191 | 3 |
| hani_al_rifai_qdc_128k | 0.31115219 | 4 |
| islam_sobhi_mp3quran | 0.94425559 | 1 |
| khalifa_al_tunaiji_tarteel | 0.24713172 | 15 |
| maher_al_muaiqly_qdc | 0.93806561 | 1 |
| mahmoud_abdul_hakam_mp3quran | 0.93613915 | 4 |
| mahmoud_ali_al_banna_qdc | 0.9441084 | 1 |
| mahmoud_khalil_al_husary_mp3quran | 0.89306233 | 4 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | 0.14771115 | 6 |
| mahmoud_khalil_al_husary_qdc_128k | 0.28092874 | 7 |
| mishary_rashid_al_afasy_2008_qdc | 0.16867719 | 7 |
| mishary_rashid_al_afasy_mp3quran | 0.94327183 | 1 |
| moaz_mahmoud_hamed_qalon_way2quran | 0.15092399 | 5 |
| mohammed_alghazali_archive | 0.91330988 | 5 |
| mohammed_siddiq_al_minshawi_mp3quran | 0.87437985 | 5 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | 0.64401192 | 8 |
| muammar_zainal_al_sukaini_way2quran | 0.92592441 | 2 |
| mustafa_ismail_mp3quran | 0.93735887 | 2 |
| nasser_al_qatami_mp3quran | 0.9731941 | 1 |
| saad_al_ghamdi_tarteel | 0.1997949 | 7 |
| saber_abdulhakam_qalon_way2quran | 0.202516 | 3 |
| saber_abdulhakam_shubah_way2quran | 0.93022949 | 1 |
| saber_abdulhakam_warsh_way2quran | 0.90106301 | 4 |
| saud_al_shuraim_mp3quran | 0.74639432 | 4 |
| walid_al_naihi_qalon_mp3quran | 0.19377974 | 8 |
| walid_atef_way2quran | 0.29440389 | 5 |
| yasser_al_dosari_archive | 0.16456753 | 6 |

| source_unavailable config | السبب المسجّل |
|---|---|
| abdul_hamid_ghraio_2025_yt | catalog_audio_unavailable ({'surah': 2, 'type': 'ValueError', 'http_status': None}) |
| abdul_hamid_ghraio_2026_yt | catalog_audio_unavailable ({'surah': 2, 'type': 'ValueError', 'http_status': None}) |
| abdulaziz_al_turki_yt | catalog_audio_unavailable ({'surah': 2, 'type': 'ValueError', 'http_status': None}) |
| abdullah_al_buaijan_2025_yt | catalog_audio_unavailable ({'surah': 1, 'type': 'ValueError', 'http_status': None}) |
| ahmad_naseem_ali_ahmad_2019_yt | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| ayman_swed_muallim_yt | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| badr_al_turki_yt | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| ibrahim_al_akhdar_drive | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| khalid_al_mohana_drive | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| mohammed_ayyub_drive | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| mohammed_burhaji_yt | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| mohammed_siddiq_al_minshawi_1967_drive | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |
| saber_abdulhakam_yt | catalog_audio_unavailable ({'surah': 74, 'type': 'ValueError', 'http_status': None}) |

### unmapped_sources خارج Release

هذه 24config موجودة في HF snapshot فقط ولا تُستورد من خارجه، و mushafs metadata مستبعد. [القائمة المنفصلة](data/d2-unmapped-sources.json).

| config | صفوف HF |
|---|---:|
| abdullah_basfar_qdc | 6236 |
| abdulmohsin_al_qasim_qdc | 6235 |
| abdulrahman_al_sudais_tarteel | 6235 |
| abdulrahman_al_sudais_yt | 6234 |
| abdulrahman_az_zawawi_way2quran | 6235 |
| ahmed_khader_al_trabulsi_qalon_tvquran | 6179 |
| al_dokali_mohammed_alaalim_qalon_mp3quran | 6214 |
| al_hussayni_al_azazy_kids_qdc | 6234 |
| ali_hajjaj_al_souasi_qdc | 6236 |
| aloyoon_al_koshi_warsh_mp3quran | 6214 |
| anas_almiman_yt | 6236 |
| hatem_fareed_al_waer_mp3quran | 6235 |
| kamel_al_bayli_warsh_way2quran | 6213 |
| khalid_al_qahtani_mp3quran | 6234 |
| maher_al_muaiqly_tarteel | 6235 |
| majed_al_zamil_yt | 6236 |
| mohammed_al_tablawi_qdc | 6236 |
| nabil_al_rifai_mp3quran | 6236 |
| omar_al_qazabri_warsh_mp3quran | 6214 |
| salah_al_budair_qdc | 6235 |
| wadie_al_yamani_tvquran | 6235 |
| yasser_al_dosari_yt | 6236 |
| yassin_al_jazaery_warsh_mp3quran | 6214 |
| yusuf_bin_noah_ahmed_tvquran | 6146 |

### الجداول الحرجة وإجابة Auto-deploy

| الجدول | production قبل / آخر قراءة | staging قبل / آخر قراءة |
|---|---:|---:|
| users | 13 / 13 | 2 / 2 |
| user_roles | 13 / 13 | 3 / 3 |
| render_jobs | 72 / 72 | 0 / 0 |
| saved_videos | 7 / 7 | 1 / 1 |
| notifications | 49 / 49 | 3 / 3 |
| subscriptions | 16 / 16 | 4 / 4 |
| system_settings | 13 / 13 | 13 / 13 |
| payment_requests | 3 / 3 | 1 / 1 |

saved_videos هو الاسم الحقيقي؛ videos/plans غير موجودين. D1 في البيئتين 114/6236/77433 ، SHA القانوني `eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4`، و CHECKSUM الجداول النصية الستة ثابت. health/ready بعد واقعة staging=200/200 و app/MySQL بلا errors في النافذة من 19:31:38Z. [فحص الخدمة](data/d2-service-after-staging-error.json).

قراءة20:00:00Z بعد فتح [PR10 المسودة](https://github.com/jokertools12/AyahX/pull/10) أثبتت Auto-deploy=true للفرعmain فعلًا، وPRdeploys=false، والبيئتينproduction/staging فقط، وصفر deployment IDs متغيرة بعد دفع الفروع وفتحPR. [الدليل النهائي](data/d2-auto-deploy-final.json). لا دمج أوdeploy، وPR9 بقي مسودة. CI يُذكر بحالته الفعلية في وصفPR والتقرير النهائي؛ لا يُستنتج نجاحه من تشغيله.

### تقرير المرحلة D2 — نتيجة التوقف

1. **ما تغيّر:** أربع جداول، محوّل Release ، مستورد dry-run و SQL حتمي، حراس النشر والـ offset ، تدقيق صوت قابل للاستئناف، وسكربت مصالحة للقراءة فقط. أُضيفت ثلاث روايات metadata غير مفعّلة، دون FK أو ALTER إلى جدول قائم. الخطط الثلاث و DECISIONS.md والصفوف السبعة المعيبة موثقة. لم تتغير الواجهة أو الريندر أو endpoints أو startup.
2. **ما تحقق فعليًا:** المصدر والجرد والنسخة المشفرة المستعادة بكل جداولها الـ 47 على MySQL9.7.2 ، البروفة المدمرة المحلية، نتائج جميع التلاوات، مصالحة staging كاملة، ومصالحة production تثبت عدم إضافة D2 إليه. الأوامر والأدلة مرتبطة أعلاه؛ لم نكرر الكتابة بعد خطأ SSH.
3. **الاختبارات:** Vitest:451passed/6skipped/0failed من 457 ، Python:7/7 ، TypeScript و lint المتغير بلا أخطاء أو تحذيرات جديدة. اختبارات DB المحلية نجحت. أمر staging والتحقق القياسي خرجا بالرمز 1 ؛ المصالحة الفعلية نجحت. لا يُستخدم build وحده كقبول.
4. **لم يكتمل:** تطبيق production وإغلاق D2 ، لأن أمر البروفة والتحقق القياسي لم ينتهيا بنجاح. ملتزم بشرط المستخدم التوقف عند فشل خطوة البروفة؛ لم أتجاوز حارس إثبات staging. بسملة الصوت والتراخيص ومراجع غير حفص وتوقيت الكلمات والخطوط والربط مؤجلة لمراحلها. Snapshot الإضافي رُفض لقيد Pro ، والنسخة المنطقية متحققة.
5. **المخاطر:** حد SSH مع الاتصالات المتكررة، وإمكان وصول الكتابة قبل فقد تأكيد القراءة؛ المصالحة تمت دون إعادة الكتابة. انحراف 15ms في فاصل HF موثق ومصحح باختبار منفصل. نتائج 48failed ومصادر 13 غير متاحة تمنع النشر؛ الطاقة والصمت لا يثبتان محتوى البسملة.
6. **الخطوة التالية المقترحة:** بعد مراجعة هذا التوقف، اعتماد تحقق كامل باتصال SSH واحد ودليل حالة staging الفعلية مع إبقاء exit1 موثقًا، ثم جرد ونسخة جديدة إذا تغيرت الجداول الحرجة، و production dry-run/apply مستقل مع --confirm-production. لا إعادة لتطبيق staging ، ولا D3/A1 أو merge/deploy دون موافقة.

### ما بقي من تنظيف البيئة الخاصة

قاعدتا الاستعادة المحليتان حُذفتا والخادم توقف،والنسخة الاحتياطية الحالية مشفرة ومتحققة. حذف ملفات التخزين المحلية رُفض آليًا مرتين (`blocked by policy`)،حتى مع المسارات الصريحة. قد تبقى بقايا الاستعادة في binlog/undo/redo داخل acceptance-data؛قُيدت صلاحياتها ولم ندعِ محوها أو تشفيرها. يحتاج المجلد تنظيفًا يدويًا؛[دليل التنظيف](data/d2-local-private-data-cleanup.json) وسجل ops يحددان المسار. هذه مخاطرة خصوصية محلية فعلية وليست مشكلة في قاعدة Railway.

قِيست166 مقدمة صوتية في سور العينة للتلاوات الـ56 القابلة للتدقيق. هذا لا يغطي كل مقدمات السور الـ114 لكل تلاوة؛ تبقى مراجعة المحتوى الصوتي غير مكتملة وكل الحالاتunverified.

## متابعة D2 — تحليل قبل إذن الكتابة، 2026-10-10 بتوقيت القاهرة

**D2 غير مغلق.** التفويض الحالي هو التشخيص والمصالحة للقراءة فقط ثم انتظار اعتماد المستخدم. جميع توقيتات الأدلة التالية UTC بتاريخ 2026-10-09. لم تحدث إعادة كتابة staging أو إنتاج أو dump جديد أو production dry-run أو snapshot أو حذف/نقل/تغيير صلاحيات محلي في هذه المتابعة. PR10 مسودة، ولا merge/deploy/بيئة جديدة أو D3/A1.

### 1. تقسيم فشل offset

أُعيد تحليل جميع النتائج المحفوظة، لا إعادة تنزيل/قياس الصوت: **8 passed /48 failed /13 source_unavailable؛ 840 عينة، 629 ناجحة و 211 فاشلة**. الأسباب التالية متداخلة؛ مجموعها ليس عدد الفشل:

| السبب | عينات مخالفة | تلاوات failed تحتوي السبب |
|---|---:|---:|
| NCC<0.95 | 175 | 46 |
| فرق مدة>30ms | 70 | 35 |
| abs(lag)>30ms | 65 | 21 |
| σ الإزاحة>10ms، تشخيص فقط | لا معيار منفرد لكل عينة | 7 |
| σ الإزاحة>10ms بعد استبعاد NCC<0.95، تشخيص فقط | لا معيار منفرد لكل عينة | 2 |

التقسيم غير المتداخل للعينات الـ 211: ارتباط وحده 111، مدة وحدها 9، lag وحده 25، ارتباط+مدة 26، ارتباط+lag 5، مدة+lag 2، الثلاثة 33. معايير القبول لم تتغير: جميع العينات NCC≥0.95 وفرق مدة≤30ms و abs(lag)≤30ms؛ البحث±300ms. شرط σ≤10ms القديم يحدد صلاحية **تسجيل تصحيح ثابت** فقط، ولا يضاف كشرط قبول. `abdullah_al_qarafi_mp3quran` اجتاز كل العينات رغم σ=11.776ms؛ بقي passed. التلاوتان الفاشلتان مع σ>10ms على عينات NCC≥0.95 هما `abdulbasit_abdulsamad_tarteel` و`abdur_rashid_sufi_qdc`؛ argmax عند NCC منخفض غير كافٍ لاستنتاج إزاحة حقيقية.

| مجموعة metadata الإزاحة | التلاوات | passed | failed | source_unavailable | العينات المقاسة |
|---|---:|---:|---:|---:|---:|
| source_offset_ms فقط، دون chapter_offsets_ms في catalog | 57 | 8 | 48 | 1 | 840 |
| chapter_offsets_ms موجود في catalog | 12 | 0 | 0 | 12 | 0 |

الـ 12 الأخيرة تشمل مصادر YouTube/Drive؛ عدم توفرها ليس فشل ارتباط، وليس دليلًا لقبول source أو chapter coordinates. `mohammed_burhaji_yt` هو غير المتاح الوحيد من المجموعة الأولى. لا يصح نسبة الفشل المقاس الـ 48 إلى جمع chapter offset، لأن ذلك الفرع لم يُنفَّذ لأي عينة محفوظة.

دلالة unavailable محدودة بالأداة: كل الحالات الـ 13 سجلت ValueError و http_status=NULL عند مرحلة مصدر catalog، قبل Parquet/HF؛ لا دليل HTTP لانقطاع هذه المواقع. السكربت يجلب URL مباشرة ويمرر الاستجابة إلى FFmpeg، ولا ينفذ استخراج media من صفحات YouTube/Drive مثل yt-dlp. لذلك يُبلَّغ عجز طريقة الجلب الحالية، ولا يُقال إن أصل التلاوة غير موجود أو إن المصدر سقط. الجسم/لوج FFmpeg القديم غير محفوظين؛ تحديد HTML أو سبب decode الدقيق لكل تلاوة يحتاج محاولة مصدر صريحة لاحقة. هذا ليس خطأ حساب للعينات الـ 48 المقاسة، ولا يُغيّر status الدليل القديم.

| قناة المصدر في catalog | passed / failed / unavailable | NCC منخفض، عينات | فرق مدة، عينات | lag كبير، عينات |
|---|---|---:|---:|---:|
| mp3quran | 6 /16 /0 | 57 | 18 | 4 |
| quranicaudio | 2 /12 /0 | 41 | 16 | 8 |
| way2quran | 0 /10 /0 | 32 | 18 | 26 |
| tarteel | 0 /6 /0 | 31 | 11 | 24 |
| archive_org | 0 /3 /0 | 14 | 6 | 3 |
| tvquran | 0 /1 /0 | 0 | 1 | 0 |
| youtube | 0 /0 /9 | — | — | — |
| drive | 0 /0 /4 | — | — | — |

[جدول جميع التلاوات الـ 69، مع أقل NCC وأقصى فرق مدة/lag وσ والأسباب](data/d2-offset-failure-analysis.md). [JSON التفاصيل والآيات المخالفة](data/d2-offset-failure-analysis.json). الأعداد مشتقة من catalog/evidence، وليست ثوابت منتج.

### 2. مراجعة طريقة الحساب وحدود الدليل

مرجع مباشر مستقل يطرح متوسط كل نافذة ومتوسط clip ثم يحسب Pearson بالضرب المباشر، دون FFT أو مجاميع تراكمية، وافق الحساب الحالي ضمن 1e-7 في حالات بداية/نهاية المصدر والإزاحتين الموجبة والسالبة وتغير gain/DC. اختُبرت حدود±30ms و 30.125ms والمدة 30/30.125ms، والنافذة القصيرة والصمت وقلب القطبية. **لم يُثبت خطأ في حساب قبول العينات الـ 840؛ لم تُستبدل نتيجتها أو يُخفَّف معيارها.** هذا إثبات للحساب في الحالات المختبرة، وليس إعادة قياس الموجات الحقيقية التي سبق حذفها.

كود QUD v3.2.0 الفعلي يصدّر `source_offset_ms = clip_start + source_offset_base_ms` في `_iter_hf_records`. إذًا HF offset مطلق داخل ملف المصدر ويتضمن chapter base أصلًا. Release tier له إحداثيات مختلفة: `chapter_offsets_ms + tier_ms`. [الكود الأولي](https://github.com/QUD-Technologies/quranic-universal-audio/blob/v3.2.0/qua_jobs/publish_hf.py#L502)، [توثيق الإحداثيات](https://github.com/QUD-Technologies/quranic-universal-audio/blob/v3.2.0/docs/reference/dataset-and-releases.md#L225). أزيلت فرضية **chapter+HF** الخاطئة للمحاولات المستقبلية؛ عدد مرات تنفيذها في الدليل القديم **صفر**، ولذلك لم يسبب هذا التصحيح تبديل نتيجة أو إعادة فحص كامل. لا تنفيذ runtime/toRenderTimeline في هذه المرحلة.

تتوفر مدة المصدر المفكوك لـ 675 عينة؛ 165 عينة من التنفيذ الأقدم لا تحفظ هذه المعلومة ولا نختلقها. في 63 عينة من 29 تلاوة، `source_offset_ms + duration_ms` يتجاوز مدة المصدر المفكوك؛ 62 منها فاشلة. هذه مقارنة **مدة HF المعلنة** بالمصدر، وليست إثباتًا أن ملف التحميل نفسه كان مقطوعًا أو أن clip المفكوك له تلك المدة بالضبط. Auditor فكّ استجابة المصدر دون `-ss/-t` ولم يُقص/يُمدد clip كي يجتاز؛ هذا لا يثبت أن المصدر المنشور نفسه غير مقطوع. الاختبارات ترفض النافذة القصيرة صراحة. فرق المدة المسجل يقارن طول HF clip المفكوك بـ HF duration_ms، ولا يقيس نهاية الآية في الأصل مستقلًا. QUD يوثق frame snap و clips مجمّعة عند حذف فجوات؛ هما احتمالان يفسران اختلاف التنسيقات، وليسا تشخيصًا مؤكدًا لكل حالة. يلزم الصوت الأصلي للتفريق بين codec/metadata/source edits؛ ما لم يثبت سببه يبقى failed وخيار D5، ولا يُنشر.

الدليل القديم [d2-offset-verification.json](data/d2-offset-verification.json) محفوظ ببصمة `e071bf483c7b44c9157c49cc15287c9aa11ed598d777bfff2bdcb1e8a449a0b9`. [مراجعة الحساب وبصمات المصادر](data/d2-offset-calculation-review.json). لا ادعاء بإعادة تنزيل جميع الأصوات.

### 3. جدول المصالحة الجديد — staging مقابل المصدر المثبت

شُغّل `reconcile-qud-catalog-readonly.ts` مجددًا على staging، بنفس خيارات البروفة السابقة وخيار `--out docs/data/d2-staging-readonly-reconciliation-followup.json`؛ exit0، اتصال واحد، SELECT/CHECKSUM فقط، الساعة 20:56:15Z. لا مصالحة بالعدّ فقط: جميع الحقول و JSON والقيم الفعلية قورنت بملف dataset المثبت. [الدليل](data/d2-staging-readonly-reconciliation-followup.json)، [جدول مشتق من ملفات QUD و SQL الفعلي](data/d2-followup-reconciliation-table.json).

| الجدول | المصدر / المتوقع | staging | الفرق | تفسير |
|---|---:|---:|---:|---|
| reciters | 57 | 57 | 0 | reciter_id متميز من 69 سجلًا؛ لا دمج بالأسماء |
| recitations | 69 | 69 | 0 | كل سجل catalog المثبت، دون HF خارجه |
| recitation_chapters | 7765 | 7765 | 0 | عدد chapter_urls الفعلي، وليس افتراض كل سورة لكل تلاوة |
| audio_providers | 10 | 10 | 0 | 8 قنوات catalog + EveryAyah/QDC موثقان للـ runtime الحالي، inactive و adapter_id=NULL للأخيرين |
| riwayat، جدول قائم موسّع | 1 قديم +3 جديد =4 | 4 | 0 | حفص القديم محفوظ؛ ورش/قالون/شعبة inactive، دون FK إلى قائم |

مقارنة جميع التلاوات بـ 114 سورة قانونية ينتج 101 رابط غير موجود في catalog نفسه؛ لا توجد خسارة 101 صفًا في الاستيراد، ولا تُنشأ روابط تخمينية لتغطيتها. 46 عمود metadata بـ unicode_ci و 3 FK داخلية صحيحة؛ D1=114/6236/77433 و SHA القانوني eca6ed31…4fe4 و CHECKSUM للجداول الستة ثابت؛ صفر published. قراءة إنتاج جديدة 21:05:54Z أثبتت عدم وجود جداول D2، و D1 والجداول الحرجة ثابتة: [الدليل](data/d2-production-readonly-reconciliation-followup.json).

**فرق عن السياسة الجديدة، لا عن ملفات SQL القديمة:** ثماني تلاوات غير حفص تحمل verification_status=failed و status=imported، لأنها اتبعت قرار الاستيراد السابق لغير حفص. هي `abdur_rashid_sufi_shubah_qdc`، `ahmed_deban_qalon_mp3quran`، `ahmed_saleh_rajab_qalon_way2quran`، `moaz_mahmoud_hamed_qalon_way2quran`، `saber_abdulhakam_qalon_way2quran`، `saber_abdulhakam_shubah_way2quran`، `saber_abdulhakam_warsh_way2quran`، `walid_al_naihi_qalon_mp3quran`. المطلوب في الاستئناف: status=needs_review للجميع؛ حاليًا offset_verified=false وكلها غير منشورة، وحارس النشر يرفضها. counts الحالية status: 56 needs_review/13 imported؛ بعد هذا التصحيح وحده تكون 64/5. لم يُعدَّل المستورد/SQL/بيانات staging لإجراء هذا التصحيح الآن؛ سيغيّر SHA ويوجب إعادة البروفة المحلية و staging قبل أي إنتاج. لا يعتمد SQL الحالي للإنتاج بينما التعارض مفتوح.

ملف SQL التاريخي لم يتغير: SHA256=`2498e681f2be2e1e9398e7dcdcb9731e8861ac331087dad2bb3c65a4507958b8`، وحجم 9739641 byte. المصالحة لا تُحوّل أمر التطبيق السابق exit1 إلى applied=true؛ حارس قبول staging الحالي محفوظ.

### 4. تشخيص الاتصالات — قراءة فقط

```powershell
npx tsx scripts/diagnose-qud-connections-readonly.ts --target staging --out docs/data/d2-staging-connections-readonly.json
npx tsx scripts/diagnose-qud-connections-readonly.ts --target production --out docs/data/d2-production-connections-readonly.json
```

داخل كل snapshot نُفّذت `SHOW PROCESSLIST` و`SHOW STATUS LIKE 'Threads_connected'` و`SHOW VARIABLES LIKE 'max_connections'`. لكل بيئة لقطتان باتصالين **متتابعين**، أقصى ما فتحه الأمر اتصال واحد في الوقت نفسه. خرجتا exit0. connection_id الأولى لم تظهر في الثانية، ثم خرج العميل الثاني بنجاح. لم يُحفظ نص SQL/host الخام من processlist، ولم تُنهَ جلسة مجهولة.

| البيئة | Threads_connected، في اللقطتين | max_connections | Max_used_connections | Connection_errors_max_connections | root محلي غير التشخيص |
|---|---:|---:|---:|---:|---:|
| staging | 1 /1 | 151 | 4 | 0 | 0 |
| production | 1 /1 | 60 | 5 | 0 | 0 |

SHOW PROCESSLIST أظهر event_scheduler وعميل التشخيص فقط؛ لا جلسة mysql قديمة من المحاولات المحلية. Aborted_clients=6058 staging و 5849 production، أعداد تراكمية تحتاج سجلًا زمنيًا لتحديد سببها؛ لا تُنسب إلى الوكيل أو healthcheck بالتخمين. الدليلان [staging](data/d2-staging-connections-readonly.json) و[production](data/d2-production-connections-readonly.json).

لا دليل على بلوغ حد MySQL الحالي؛ رسالة `Maximum SSH connections reached for this service` السابقة تخص Railway SSH. نجاح جلسات المتابعة يثبت إمكان الاتصال الآن، ولا يحدد السبب الدقيق لخروج التطبيق الأصلي. لا KILL/رفع حدود/إعادة staging/تجاوز حارس. عند إعادة التنفيذ المصرح به: اتصال واحد، دفعات≤1000، فحص عدد الاتصالات قبل **كل** دفعة والتوقف عند بلوغ الحد/خطأ اتصال. هذا قيد تنفيذ لاحق ولم نزعم اختبار تطبيق جديد به.

### 5. باقي القرارات والاختبارات

HF logger يسجل الآن 500 مع وقت UTC ونص استجابة محجوب الأسرار/الروابط الموقعة وبصمة النص الملتقط؛ يُعلن قطع النص إذا تجاوز 64KiB. لا تسريع أو تغيير للنوافذ: 2s/تراجع 2 ثم 4 و Retry-After، وثلاث نوافذ≥30min عند عدم توفر HF. اختُبر logger باستجابات 500 مصطنعة معروفة ومعلنة كـ fixtures، دون طلب HF جديد؛ stats القديم الأخير يحتوي 500 واحدًا دون جسم/توقيت طلب محفوظين، فلا يمكن استرجاعهما أو اختلاقهما. السياسة والقصور التاريخي مثبتان في DECISIONS.

بسملة الصوت unverified لكل 69؛ 166 prefix يخص سور العينة فقط. snapshot رُفض لأن Pro شرطه؛ لا محاولة أخرى. [تعليمات الحذف اليدوي مرة واحدة](d2-manual-cleanup.ar.md)؛ لم تُنفَّذ آليًا وبقايا المجلد تبقى مخاطرة محلية حتى ينظفها المستخدم.

نتائج المتابعة النهائية والأوامر في [d2-followup-tests.json](data/d2-followup-tests.json): حساب الصوت 14/14 و report تحليل 3/3؛ TypeScript الجذر والسكربت strict و lint الملف المتغير ناجحة. الاختبار الفعلي Corpus أُعيد بمتغير D1_QURAN_CORPUS بعد أن كان التشغيل الأول 450 ناجحًا/7 متخطاة بسبب غياب هذا المتغير. لا إصلاح lint عام ولا تغيير runtime/واجهة/ريندر.

### تقرير متابعة D2 — التوقف عند المصالحة

1. **ما تغيّر:** تحليل حسب السبب والمصدر والتلاوة، تشخيص اتصال قراءة فقط، تصحيح فرضية غير منفّذة، HF 500 logger واختباراته، DECISIONS وأدلة المتابعة وتعليمات التنظيف. لم يتغير SQL المعتمد أو قاعدة أو واجهة/ريندر.
2. **ما تحقق فعليًا:** مصالحة كاملة جديدة للبيئتين و diagnostics متتابعة؛ حساب 840 نتيجة محفوظة ومراجعة حساب مستقلة؛ SQL SHA والدليل الصوتي القديم ثابتان. لا إعادة قياس صوتية كاملة ولا بَسملة مؤكدة.
3. **الاختبارات:** الأعداد والأوامر النهائية في d2-followup-tests.json؛ صفر فشل في التشغيل النهائي، واستمرار تخطي 6 اختبارات queue القديمة التي تحتاج بيئة خاصة. SQL runtime لم يُنفَّذ في هذه المتابعة.
4. **لم يكتمل/قرار المستخدم:** اعتماد جدول المصالحة مع تصحيح status الثماني في SQL جديد وبروفة staging جديدة؛ ثم dump إنتاج جديد مشفر ومستعاد 9.7.2، وبعده production dry-run، ثم إذن نهائي صريح في رسالة مستقلة. لا كتابة قبل موافقة المصالحة.
5. **المخاطر:**48 فشلًا حقيقيًا وفق المعايير القائمة، 13 مصدرًا غير متاح،بسملة الصوت غير مثبتة، بقايا استعادة محلية، وأمر staging قديم بلا تأكيد exit0. لا تحسين شكلي لهذه الحالات.
6. **الخطوة التالية:** انتظار اعتماد المستخدم للمصالحة ومعالجة تعارض status؛ بعدها فقط تسلسل البروتوكول الجديد. لا D3/A1/merge/deploy.

# متابعة التفويض الموسع — تطبيق D2 على staging والإنتاج

الرسالة الجديدة تجيز الدفعة D2 ثم التشخيص و D3–D6 بالترتيب؛ السياسات الحالية في `plan/DECISIONS.md` تغلب القيود التاريخية أدناه. D2 لا يغلق قبل دمج PR9/10 والتحقق من كل نشر.

- أصلح importer حالة الفشل لجميع الروايات؛ فأصبحت النتيجة 64 needs_review و 5 imported، وكل التلاوات الـ 69 غير منشورة. لم تتغير نتائج offset الأصلية: 8 passed و 48 failed و 13 source_unavailable.
- يُحفظ SQL القديم، 2498e681…، خارج Git. يدرج SQL الجديد، ببصمة `d3f0db3ece980af02af2b00b2c06f5e2ce890b3526e62050396571cd2cc42fe8`، metadata الغائبة دون UPDATE للـ riwayat القائم، ويصحح failed/imported في recitations فقط.
- استعادت البروفة 47 جدولًا من النسخة age القائمة، وطابقت جميع الأعداد و CHECKSUM على MySQL 9.7.2. أثبت فحص الإنتاج ثبات الجداول الحرجة؛ وكان عمر النسخة نحو 7h، فأُعيد استخدامها وفق التفويض. فشل أول SQL عند مقارنة collation في NOT EXISTS. أُصلح التعبير بـ COLLATE unicode_ci، ثم نجحت البروفة كاملة، بما فيها إعادة إنتاج الحالات الـ 8 وتصحيحها، و import مرتين، و rollback/reapply.
- نجحت جلسة staging الجديدة دون إعادة محاولة، مع تأكيد COMMIT وخروج SSH0. استخدمت جلسة SSH واحدة وعميل mysql واحدًا، و 45 فحص اتصال، ودفعات ≤250. تراوح Threads_connected بين 1 و 2 من 151. ثبت تطابق كامل الحقول و D1 والجداول الحرجة، وصحة 46 عمودًا و 3 FK داخلية. لم يحدث إدراج جديد؛ وصُححت 8 حالات فقط.
- طابق dry-run الإنتاج البصمة والأعداد؛ وفُسر فرق الإنشاء والإدراج بغياب D2 قبل التطبيق. نجح apply المستقل مع `--confirm-production` بالبصمة نفسها، ثم نجحت مصالحة مستقلة للقراءة فقط. الأعداد: 57 reciters و 10 providers و 69 recitations و 7765 chapters. انتقل riwayat من 1 إلى 4 بإدراج 3 روايات غير مفعّلة دون تعديل حفص؛ وبقي published=0. تراوح Threads_connected بين 1 و 2 من 60. بقيت D1=114/6236/77433 وبصمة eca6ed31…4fe4 و CHECKSUM والجداول الحرجة ثابتة. أعاد health/ready الرمز 200. كان لوج التطبيق 7 أسطر ولوج MySQL 0، بلا أخطاء منذ 23:35 UTC حتى 23:37 UTC.
- رفضت سياسة الأوامر محاولة التنظيف الصريحة الوحيدة بـ blocked by policy؛ ولم يُنفذ الأمر. بقي manual_cleanup_required؛ ولا حذف بديل أو نقل أو ACL. البروفة الجديدة في datadir مستقل، وليست نقلًا للبقايا القديمة. لا تُعاد محاولة snapshot التي تتطلب Pro.
- نتائج الاختبارات الحالية: Vitest، 471 passed و 6 skipped و 0 failed من 477، ومنها 32 اختبارًا للكتالوج والنقل. نجحت فحوص root TypeScript و strict للملفات المعدلة و lint بلا رسائل. لم يُصلح lint العام، ولم تتغير UI/render. لم يجد فحص diff لـ PR9/10 نمط أسرار أو ملفات خاصة أو migration عند startup؛ ويُعاد CI للرأس النهائي بعد الدفع.

الأدلة: `data/d2-*status-fixed.json`، `d2-backup-reuse-precheck.json`، `d2-backup-reverification-status-fixed.json`، `d2-status-rehearsal-attempts.json`، `d2-serial-transport-readonly-precheck.json`، `d2-cleanup-expanded-authorization.json` و`progress.md`.

## إغلاق D2 تحت التفويض الموسع — 2026-10-10T00:19Z

دُمج PR9 على 099d8e76 ثم PR10 بعد تغيير base إلى main، على 802720ba، بعد CI الرأس 3455a5b والمراجعة المستقلة للأسرار وحراس staging وغياب migrations D1/D2 عن startup. نجحت الخدمات الأربع في النشرين. نافذتا قبول اللوجات تجاوزتا 604s و619s، بلا أخطاء جديدة؛ health/ready=200 وdatabase=connected. نجحت اختبارات الواجهة العامة 10/10 لكل نشر دون إرسال forms أو API writes. تصنيف Railway لسطور Uvicorn الأربع كأخطاء مصدره رسائل INFO عند بدء الخدمة؛ طابقت كل قالب مع النشر السابق، ولا استثناء/traceback جديد، مع إبقاء عدد severity الخام موثقًا.

المصالحة المستقلة بعد النشر الأخير الساعة 00:19:17Z: 57 قارئًا و10 مزودين و69 تلاوة و7765 سورة؛ riwayat=4 بإدراج 3 غير مفعلة؛ published=0. جميع حقول الكتالوج تطابق dataset. D1=114/6236/77433 وبصمة القانوني eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4 وCHECKSUM وcollations والجداول الحرجة ثابتة. SQL واحد بالبصمة d3f0db3ece980af02af2b00b2c06f5e2ce890b3526e62050396571cd2cc42fe8 طُبق فعليًا على staging والإنتاج، مع COMMIT/SSH exit=0 و45 فحص اتصالات؛ أعظمهما المرصود 2. نتيجة offset الأصلية 8/48/13 لم تتغير.

D2 مغلق. الأدلة: data/d2-pr9-deployment-acceptance.json وdata/d2-pr10-deployment-acceptance.json وdata/d2-pr10-production-readonly.json؛ نتائج الاختبارات 471 pass/6 skip/0 fail، و32/32 مستهدفًا، وTypeScript/lint المتغير ناجحان. يبدأ B الآن؛ لا D3 قبل قبوله. manual_cleanup_required مستمر بعد رفض المحاولة الواحدة بـblocked by policy؛ لا تنظيف بديل ولا snapshot جديد. ستحتفظ أدوات التدقيق اللاحقة بالـscratch بدل الحذف التلقائي، مع مسارات واضحة.

### تقدم التشخيص B — 2026-10-10

نتائج offset الأصلية محفوظة. أثبتت اختبارات مستقلة أن إضافات التشخيص الأولى تعاقب بعض نوافذ PCM المتطابقة بسبب شبكة RMS عند EOF، وحدود الفلتر وشبكة STFT المختلفة. أوقفت المحاولة قبل اكتمال أي config، وصححت الحساب قبل استئناف الفحص الكامل. اجتازت النسخة المصححة 31 اختبارًا محليًا؛ مصدر VAD يحتفظ بسياقه الأصلي، والمقارنة تستخدم نافذتين كاملتين بنفس حدود الفلتر دون قص أو padding لتوليد قبول. حارس resume يطابق بصمات الحساب، وحارس v2 يعيد اشتقاق القيم العددية المحدودة والعينة الموزعة والهوية في موضع المصدر، ويحظر المصدر القديم المجهول أو المتغير. الأدلة [المحاولة الأولى](data/d3-audio-diagnosis-first-attempt.json) و[اختبارات الحساب](data/d3-diagnostic-kernel-validation.json). هذه أدلة الحساب، وليست اعتمادًا لأي تلاوة.

اكتمل فحص بدائل الحالات13: Aligner Space أعاد ملفات عامة لعينة سورة112 لكل حالة، مع HEAD200 وRange206؛ لا صوت Space حُفظ ولا offset/حقوق نشر اعتمدت. Drive أعاد ثلاثة تحذيرات Virus scan تُركت دون تأكيد أو تجاوز؛ ونُزّل ملف عام واحد طبيعيًا لسورة112 ومدته18599ms للتدقيق فقط. ملفات Space منفصلة للسور، فلا تحمل إحداثيات الملف الأصلي المشترك تلقائيًا. التفاصيل [تقرير البدائل](data/d3-source-alternatives.md)، وكل scratch باقٍ manual_cleanup_required بلا محاولة حذف بديلة.

أظهر كود QUD المثبت أن بعض مقاطع HF يمكن أن تكون موصولة بعد حذف interior no-match spans: `_rebase_row_multi` يعيد إحداثيات segments/words قطعةً قطعة، بينما source_offset_ms يظل بداية أول run. لذلك لا يُستنتج تطابق نافذة مستمرة أو اختلاف تسجيل من ضعف NCC وحده. هذا احتمال مستند إلى بنية الناشر، وليس إثباتًا أن تلاوة بعينها تعرضت لهذا التحرير؛ يلزم دليل موجة/bytes محلي لكل حالة. [كود الناشر](https://github.com/QUD-Technologies/quranic-universal-audio/blob/v3.2.0/qua_jobs/publish_hf.py#L416). تبقى التوقيتات الإنتاجية من Release، وHF للتدقيق فقط؛ ولا يُنسخ clamp الدفاعي في هذا المصدر إلى normalizeTiming الخاص بنا.

## إغلاق التشخيص B — 2026-10-10

اكتمل قياس جميع التلاوات48 الفاشلة، 720 عينة حقيقية، وإعادة PCM مستقلة لكل التلاوات48 بلا أخطاء تحقق. أعيد حساب v1 على المدخلات نفسها وطابقت القيم القديمة كلها بفارق لا يتجاوز1e-10؛ تبقى حصيلة v1 الأصلية8 passed /48 failed /13 source_unavailable. لم تُكتب قاعدة بيانات ولم يتغير النشر.

التصنيف المستقل: فرق ترميز/معالجة مثبت4، إزاحة ثابتة1، أثر حدود العينة31، غير محسوم12؛ drift مثبت0 وصوت مختلف مثبت0. لا يُعامل أثر EOF أو إزاحة ثابتة كـdrift متزايد. نتائج الغلاف وlog-mel وVAD والأسباب المتداخلة والعينات محفوظة في التقرير العددي؛ log-mel تشخيص فقط، دون اختراع حد قبول خامس.

اعتمدت ثلاث تلاوات لمعيارv2 وفق التفويض، مع إبقاء v1 failed وسجل القرار القديم: أحمد سعود (envelope≥0.999700،VAD≥0.975437،|lag|≤0.5ms،فرق مدة≤25.75ms)، مشاري العفاسي MP3Quran (≥0.999141،≥0.945561،≤0.5ms،≤26.625ms)، محمد الغزالي Archive (≥0.998798،≥0.952945،≤25.5ms،≤20.5ms). لكل تلاوة15 عينة موزعة على3 سور، وإثبات موضع packet وهوية native PCM، واستعادة مستقلة لجميع segments المرجعية. هذه أهلية موثقة تُستهلك في D4؛ offset_verified في القاعدة لم يتغير بعد، ولا اعتماد نشر قبل D3/D4 وحقوق الصوت.

كل720 عينة تحتوي قياسات VAD؛ إعادة جلب segments المستقلة شملت75 مرجعًا لخمس تلاوات، وهي كامل المجموعة ذات اجتياز المقاييس الأربعة، مع الحالة الأولى التشخيصية. التشغيل العام السابق أُوقف عمدًا بعد أول تلاوة لتضييق الجلب على المرشحين؛ ملفه الجزئي محفوظ ولا يُدّعى اكتماله. حادثة فقد scratch لمحمد الغزالي موثقة؛ إعادة واحدة بعد نافذة≥30min نجحت دون تغيير الحساب. خمسة رسوم تراكب حقيقية فُحصت محليًا وبصماتها محفوظة؛ لا صوت أو صور أو Parquet في Git. بدائل13 هي أدلة سورة112 فقط وليست تغطية كاملة أو ترخيصًا.

الأدلة: [التقرير و69 تلاوة](data/d3-audio-failure-diagnosis.md)، [المراجعة المستقلة](data/d3-audio-independent-review.json)، [قرارv2](data/d3-offset-v2-accepted.json)، [تطابقv1](data/b-v1-replay-equality.json)، [اختبارات108/108](data/b-root-tests-108.json)، [نطاقsegments](data/b-segments-scope-decision.json)، [الرسوم](data/b-root-overlay-review.json). preflight قراءة فقط على stage/prod لم يجد تصادم أسماء للجداول القادمة، وأثبت ثبات D1 والجداول الحرجة. التنظيف manual_cleanup_required كما سبق؛ لا محاولة حذف بديلة.

## توقف D3 بسبب سعة الإنتاج — 2026-10-10

اكتمل التحضير المحلي لكل69 حزمة Release مثبتة،422,463 صفًا؛ لا HF في الاستيراد. بعد تجاوز تقدير الكل580.2MB حد500MB، حُسب البديل24 تلاوة و143,590 صفًا. قِيس JSON_STORAGE_SIZE على MySQL9.7.2 لكل صف في البديل، مع حجوم الأعداد وفق DDL والنص وفق UTF8: حد payload223,071,669 bytes قبل InnoDB والفهارس، مقابل118,530,048 bytes حرة في قرص الإنتاج. حتى البديل لا يتسع؛ نقطة التوقف5 تتطلب قرارًا بشأن السعة أو نطاق أصغر. لا تغيير volume أو حذف أو كتابة D3 عن بُعد، ولا D4–D6.

تحققت نسخة age جديدة باستعادة51 جدولًا ومطابقة كامل COUNT/CHECKSUM على9.7.2؛ مفتاحها والنسختان المتحققتان محفوظة. فحوص التوقف للقراءة فقط تثبت ثبات D1 والجداول الحرجة وعدم وجود جداول D3؛ CHECKSUM الإنتاج كلها ثابتة، وstaging تغيّرت فيه بصمة جدول capacity الدوري غير الحرج فقط. health/ready200 بلا أخطاء في نافذة اللوج. npm test483 ناجحة/6 متخطاة/0 فشل، و12 اختبار D3 و108 اختبار B ناجحة، وtsc/strict/eslint للملفات المتغيرة بلا مشكلات. migration وSQL محضران ومنفصلان عن startup، ولم ينفذا؛ BullMQ/idempotent DB/resume والقبول الفعلي لـD3 غير مكتملة. التفاصيل والأوامر وجدول69 تلاوة وأسباب عدم النشر في docs/data/d2-d6-storage-stop-report.ar.md.
