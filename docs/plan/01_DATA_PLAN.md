# 01 — خطة البيانات: القراء والسور والنصوص والتوقيتات والصوت

> الهدف: أن يعمل اختيار السورة/الآيات/القارئ/الرواية ثم التوقيت كلمة بكلمة ثم الريندر **بشكل صحيح ومتسق**، بالاعتماد على مصادر QUD، وبحيث يمكن إضافة قراء ومصادر وأصوات جديدة من لوحة الأدمن دون تعديل كود.

---

## 0. لماذا فشلت النماذج السابقة (وكيف تمنع الخطة تكرار ذلك)

من `VIDEO_PIPELINE_BUGFIX_LOG.md` ومن البنية الحالية، الأعطال المتكررة كانت من نوع واحد: **عدم وجود عقد واضح للبيانات**.

| العطل السابق | السبب الجذري | المنع في هذه الخطة |
|---|---|---|
| الآيات لا تتحرك في الريندر (ثابتة على آية 1) | توقيتات بإحداثيات الصوت الكامل (مثلاً 185000ms) بينما الفيديو يبدأ من 0 | **عقد الإحداثيات** (قسم 2) + اختبار يفشل إذا بدأ أول توقيت خارج [0، مدة الفيديو] |
| تأخر التظليل حتى 2.5 ثانية | تقسيم خطي `ratio * wordCount` بدل توقيت حقيقي | توقيتات محاذاة حقيقية (QUD) + وسم الجودة `estimated/aligned/approved` |
| `timingMap.words.X.endMs: Required` | مصدر يرسل بدون `endMs` | مُطبِّع واحد `normalizeTiming()` على السيرفر، لا إصلاح متفرق |
| رفض `blob:` في الريندر | الواجهة تمرر رابط محلي | `AudioResolver` يُرجع دائماً رابطاً بعيداً + هوية التلاوة، لا blob |
| قراء ناقصون في Quran Foundation | خريطة قراء مكتوبة يدوياً في الكود | كتالوج في قاعدة البيانات يُستورد من QUD، لا خرائط hardcoded |
| إعدادات تُحفظ ولا تؤثر | لا مصفوفة ربط | مصفوفة ربط (Wiring Matrix) + اختبار لكل إعداد |

---

## 1. المصادر: ماذا يعطينا كل مصدر وما حدوده

### 1.1 Quranic Universal Audio (QUA) — `audio.qud.dev` + `github.com/QUD-Technologies/quranic-universal-audio`
- كتالوج موحّد للتلاوات بمخطط واحد وبيانات وصفية للقراء والتلاوات، مع توقيتات على مستوى **الآية والكلمة والحرف**.
- وقت فحصي أظهر الريبو شارات: **1,214 قارئاً** و**19 رواية** و**47,500+ ساعة** في الكتالوج، و**93 مصحفاً** و**4 روايات** و**2,700+ ساعة** في الجزء المحاذى والمدقّق. (أرقام متغيّرة؛ لا تكتبها في الكود.)
- الأصناف: مجوّد، مرتّل، معلّم، تراويح، تكرار للأطفال.
- **صيغتان للوصول:**
  - **GitHub Releases:** JSON لكل تلاوة بمستويات آية/كلمة/حرف، النسخ مثبّتة (reproducible)، **الصوت غير مضمّن**؛ روابط ملفات السور الأصلية داخل `catalog.json`. مناسب للتطبيقات.
  - **Hugging Face Dataset** `QUD-Technologies/quranic-universal-ayahs`: Parquet، صف لكل آية، **مقطع صوتي مضمّن لكل آية** + الرابط الأصلي، نسخة متجددة (rolling).
- **الرخصة:** عمل المشروع (التوقيتات/التقسيم/الميتاداتا/الكود) تحت **CC BY 4.0 → الإسناد (attribution) واجب**. أما **التسجيلات الصوتية فتبقى ملكاً لقرائها ومصادرها الأصلية** (QuranicAudio, EveryAyah, MP3Quran, QUL, TVQuran, SurahQuran, Way2Quran). لذلك: حقل رخصة/إسناد في كل تلاوة + صفحة إسناد عامة + لا نعيد استضافة الصوت دون مراجعة حقوقه.
- النص العثماني والميتاداتا مأخوذة من **QUL (Tarteel)** والخط **DigitalKhatt**.

### 1.2 مجموعة البيانات على Hugging Face (ما رأيته فعلياً)
- عدد subsets والتلاوات **يُحسب من المصدر**، بما فيها `mushafs` إن وجد. اسم الـ subset = **slug للتلاوة** بصيغة غالباً `{reciter}_{style?}_{riwayah?}_{provider}` مثل `maher_al_muaiqly_qdc`, `abdulbasit_abdulsamad_mujawwad_tarteel`, `saber_abdulhakam_warsh_way2quran`, `mishary_rashid_al_afasy_mp3quran`. لواحق المزوّد التي رأيتها: `qdc, tarteel, mp3quran, way2quran, tvquran, yt, drive, archive`. **لا تفكّ الـ slug بـ regex لاستنتاج القارئ**؛ اقرأ الميتاداتا من الكتالوج.
- بعض التلاوات ناقصة (مثلاً `ahmed_saud_mp3quran` ≈ 327 صفاً فقط، و`islam_sobhi_mp3quran` ≈ 5.28k) ⇒ **التغطية لا تساوي 6236 دائماً**؛ احسبها ولا تفترضها.
- أعمدة الصف: `audio` (مقطع الآية)، `surah`, `ayah`, `duration_ms`, `text_uthmani`, `segments`, `word_timestamps`, `source_url`, `source_offset_ms`.
- شكل `segments`: قائمة `[word_from, word_to, start_ms, end_ms]` — وقد يكون للآية الواحدة **عدة مقاطع** (مثال: آية 2:7 عند أحد القراء: `[[1,6,25,4675],[7,9,4935,8125],[10,12,8385,11476]]`).
- شكل `word_timestamps`: قائمة `[word_index, start_ms, end_ms]` (الفهرس يبدأ من 1).
- **مفاجآت رأيتها في العيّنة (يجب أن يتحملها الكود):**
  1. **التكرار:** عندما يكرر القارئ عبارة، تتداخل فهارس الكلمات بين المقاطع (مثال: مقطع ينتهي عند الكلمة 13 والتالي يبدأ من 12؛ ومثال آخر `[1,10,…]` ثم `[9,15,…]`). وفي حقل `text_uthmani` نفسه ظهرت عبارات مكررة في بعض الآيات (2:22 و2:31). ⇒ **لا تفترض أن فهرس الكلمة يتزايد دائماً**، ولا أن `text_uthmani` = النص القانوني للآية حرفياً. **[تحقّق]** من الحالتين بعيّنة وسجّل القرار (قسم 2.4).
  2. **غياب البسملة:** أول صف عند أحد القراء كان 1:2 (لا 1:1). ⇒ تعامل مع البسملة صراحة (قسم 3.1).
  3. علامات قرآنية خاصة داخل النص (مثل `ۖ` `ۛ` `ࣰ` `ࣱ` `۟` و`۞`) ⇒ تحتاج خطاً يدعمها (قسم 4 / D1).

### 1.3 Quranic Universal Aligner API
- الأساس: `https://hetchyy-quranic-universal-aligner.hf.space/api/v1` (الوثائق: `/docs`, `/redoc`, `/openapi.json`).
- هو **Space على Hugging Face بحصة ZeroGPU يومية لكل مستدعٍ**؛ نفاد الحصة لا يفشل الطلب بل يُكمَل على CPU (أبطأ، وله حد استخدام عادل). ⇒ **ليس بنية إنتاج لحركة المستخدمين المباشرة**. نستخدمه كعامل خلفي في الأدمن لملء الفجوات وإعادة المحاذاة، مع تخزين النتائج.
- نقاط مهمة (من openapi.json الفعلي):

| Endpoint | الاستخدام |
|---|---|
| `GET /health` | فحص الحياة |
| `GET /recitations` | التلاوات المنشورة ذات المقاطع المراجَعة وسورها |
| `GET /recitations/{recitation}/chapters/{chapter}/segments?verse_from&verse_to&include_timestamps` | مقاطع مراجَعة لمدى آيات + `audio_url` لمقطع مقصوص؛ **الأزمنة معاد تصفيرها لبداية المقطع** |
| `GET /audio-recitations` | تلاوات بصوت فقط بلا مقاطع مراجَعة |
| `GET /recitations/{recitation}/chapters/{chapter}/audio` | رابط صوت السورة (يدعم Range) |
| `POST /segment/audio` | تقطيع حدود الكلام فقط (بدون تعرّف/محاذاة) |
| `POST /align/audio`، `POST /align/url` (+ `/stream`) | محاذاة تلاوة مع النص المرجعي؛ يُرجع `audio_id` يبقى دافئاً لساعات |
| `POST /sessions/{audio_id}/realign` (+ `/stream`) | إعادة المحاذاة بحدود تعطيها أنت |
| `POST /sessions/{audio_id}/split` | تقسيم المقاطع حسب آية/عدد كلمات/مدة |
| `POST /sessions/{audio_id}/timestamps`، `POST /timestamps` | توقيتات الكلمات |
| `POST /batches` ... | دفعات (للجودة/الاستخراج الجماعي) — **لا تستخدم** مسارات `/extraction/*` (تحتاج `X-Extraction-Secret`) |

- الخيارات: `model_name` = `Base`(95M أسرع) | `Large`(1B أقوى للصوت الصعب)؛ `device` = `GPU|CPU`؛ `riwayah` = `hafs|warsh|qalun|shuba`؛ `pad_left_ms` (0–1000، افتراضي 100)، `pad_right_ms` (افتراضي 200).
- البث (SSE): أحداث `progress` بمراحل `queued_gpu, queued_cpu, segmenting, transcribing, matching, recovering, building` ثم **حدث `result` واحد** أو **`error` واحد**؛ تعليق `: keepalive` كل 15 ثانية.
- الأخطاء: كل ردّ غير 2xx بصيغة `{code, message, detail}` — **قرّر بالـ `code` لا بالـ `message`**. معاني مهمة: `402` حصة GPU انتهت ولا بديل CPU؛ `429` حد CPU (مع `detail.retry_after_s`)؛ `503 gpu_temporarily_unavailable` آمن لإعادة المحاولة؛ `404` `audio_id` منتهي؛ `422` تعذّرت المحاذاة؛ `502` خدمة التوقيت فشلت.
- التوثيق بالمستخدم: `Authorization: Bearer <HF token>` ليستهلك حصة حسابك. **التوكن على السيرفر فقط.**

### 1.4 ما لم أستطع فحصه (لتتحقق منه أنت)
- بنية مجلدات `src/` و`server/` و`database/` في AyahX (GitHub منع الجرد الآلي للمجلدات) — اقرأها محلياً.
- محتوى `catalog.json` وملفات الـ Releases الفعلية (أسماء الأصول وحقولها).
- واجهة `audio.qud.dev` (صفحة SPA لم يُرجع الجلب سوى الميتاداتا) — **[تحقّق]** هل لها API عام/روابط CDN.
- دلالة `source_offset_ms` بدقة (قسم 2.3).

---

## 2. عقد البيانات والإحداثيات (أهم قسم في الخطة)

### 2.1 الوحدات
- كل الأزمنة **بالمللي ثانية، أعداد صحيحة** (`int`). ممنوع الثواني العشرية داخل الـ DB أو الـ manifest.
- فهرس الكلمة **1-based** كما في QUD (`wordIndex`).
- فهرس الآية `ayah` يبدأ من 1، السورة 1..114.

### 2.2 الأنواع الموحدة (TypeScript، في `shared/`)
```ts
export type TimingLevel   = 'none' | 'ayah' | 'word' | 'letter';
export type TimingQuality = 'estimated' | 'aligned' | 'approved';   // approved = اعتمده إنسان
export type CoordinateSystem = 'clip_ms' | 'chapter_ms' | 'render_ms';

export interface WordTiming { wordIndex: number; startMs: number; endMs: number }
export type Segment = [wordFrom: number, wordTo: number, startMs: number, endMs: number];

export interface AyahTiming {
  surah: number; ayah: number;
  clipDurationMs: number;
  sourceOffsetMs: number | null;      // موضع بداية المقطع داخل صوت السورة الأصلي إن عُرف
  segments: Segment[];
  words: WordTiming[];                // قد تتكرر wordIndex (تكرار القارئ) — مرتبة زمنياً
  coordinate: 'clip_ms';
}
```

### 2.3 قاعدة الإحداثيات (تمنع خطأ "الآيات لا تتحرك")
1. **التخزين:** نخزّن كما في المصدر: `clip_ms` (نسبة لبداية مقطع الآية) **+** `source_offset_ms` منفصلاً.
2. **التحويل الوحيد المسموح:** دالة نقية واحدة `toRenderTimeline(ayahTimings[], plan)` في `shared/timing/`، تُرجع `render_ms` يبدأ من 0 عند أول لحظة في الفيديو، وهي **المكان الوحيد** الذي يحدث فيه الجمع/الطرح. ممنوع أي `+ offset` في مكان آخر.
3. **[تحقّق] دلالة `source_offset_ms`:** قبل الاعتماد، نفّذ تجربة على 3 تلاوات × 3 آيات: اقصص صوت السورة الأصلي (من رابط `catalog.json`) عند `source_offset_ms` بطول `duration_ms` وقارنه بمقطع الآية المضمّن (استماع + مقارنة الطول والـ cross-correlation). سجّل النتيجة. إن لم تتطابق، **لا تستخدم وضع "صوت السورة الأصلي"** واعتمد وضع "مقاطع الآيات" فقط حتى تُحل.
4. **اختبار قبول إلزامي:** `assertTimelineValid()`: أول `startMs ≥ 0`، آخر `endMs ≤ مدة الصوت الفعلية + هامش 200ms`، لا توقيت سالب، `endMs > startMs`.

### 2.4 التكرار وعدم أحادية الفهرس
- **التظليل يُقاد بالزمن لا بالفهرس:** الكلمة النشطة عند `t` = أول عنصر في `words` (مرتب بالبداية) يحقق `startMs ≤ t < endMs`؛ وإن وقع `t` في فجوة قصيرة (وقف/نفس) **تُبقى الكلمة السابقة مضاءة** (waqf-hold) بدل الإطفاء.
- **قرار العرض عند التكرار** يصبح إعداداً في الأدمن `repetition_display_mode`:
  - `canonical` (الافتراضي المقترح): نعرض النص القانوني، ونعيد تظليل الكلمات عند تكرارها (يتطلب ربط `wordIndex` المسموع ↔ الكلمة القانونية).
  - `recited`: نعرض ما قيل بما فيه التكرار.
  - **[تحقّق]** بعيّنة 2:22 و2:31 كيف يختلف `text_uthmani` عن النص القانوني، ثم نفّذ الربط بـ diff على مستوى الكلمات. إذا تعذّر الربط لآية ما ⇒ علّم تلك الآية `needs_review` ولا تُظلَّل تلقائياً.

### 2.5 مستويات الثقة
- `estimated`: ناتج المحرك التقريبي `wordTimingEngine` القديم ⇒ **ممنوع** تفعيل توهج الكلمات به افتراضياً (يبقى قاعدة Track E: لا glow بدون TimingMap معتمد). يُسمح به فقط بتفعيل صريح "تظليل تقريبي" ويُوسَم في الواجهة.
- `aligned`: من QUD أو من الـ Aligner، لم يراجعه إنسان.
- `approved`: اعتمده أدمن (أو أتى من QUD "مراجَع" ونسبته موثّقة). **الريندر الافتراضي يتطلب `aligned` على الأقل من QUD، و`approved` للمحاذاة الناتجة عن الـ Aligner.**

---

## 3. نموذج قاعدة البيانات (MySQL 9.7.2 الفعلي، metadata unicode_ci، القانوني/المنطوق bin)

> أسماء مقترحة؛ طابقها مع ما هو موجود فعلاً بعد D0 ولا تكرر جدولاً قائماً. كل جدول: `id` PK, `created_at`, `updated_at`. الـ migrations ترقيمية وidempotent.

| الجدول | الأعمدة الرئيسية | ملاحظات |
|---|---|---|
| `riwayat` | `code` (hafs,warsh,qalun,shuba,…), `name_ar`, `name_en`, `aligner_code`, `is_active` | `aligner_code` ↔ قيم الـ API |
| `quran_text_versions` | `riwayah_id`, `source` (qul/qud), `script` (uthmani…), `version_label`, `checksum`, `imported_at`, `is_active` | نسخ النص مؤرّخة |
| `quran_surahs` | `number` 1..114 UNIQUE, `name_ar`, `name_en`, `name_translit`, `revelation_place`, `ayah_count`, `has_basmala` (bool), `juz_start`, `page_start` | للقراءة فقط عملياً |
| `quran_ayahs` | `text_version_id`, `surah`, `ayah`, `text_uthmani`, `text_simple`, `words_count`, `juz`, `page`, UNIQUE(`text_version_id`,`surah`,`ayah`) | الإجمالي 6236 لحفص **[تحقّق]** |
| `quran_words` | `ayah_id`, `position` (1-based), `text_uthmani`, `text_simple`, UNIQUE(`ayah_id`,`position`) | أساس الربط والتكرار |
| `translations` + `translation_ayahs` | `code`, `lang`, `name`, `translator`, `license`; `ayah_id`, `text` | متعدد اللغات |
| `reciters` | `slug` UNIQUE, `name_ar`, `name_en`, `country`, `bio`, `photo_url`, `is_featured`, `sort_order`, `status` | الشخص |
| `audio_providers` | `code` (qdc,everyayah,mp3quran,way2quran,tvquran,tarteel,qud,upload,…), `name`, `base_url`, `host_allowlist` JSON, `priority`, `is_active`, `health_status`, `last_checked_at` | تُدار من الأدمن |
| `recitations` | `slug` UNIQUE (= slug QUD/المزوّد), `reciter_id`, `riwayah_id`, `style` (murattal,mujawwad,muallim,taraweeh,kids), `provider_id`, `audio_mode` في D2 (`unverified_source`/`surah_slice`)، `audio_category` من المصدر، `timing_level`, `timing_quality`, `coverage_ayahs`, `coverage_words`, `license_text`, `attribution_text`, `source_url`, `qud_version`, `status` (draft,imported,needs_review,published,hidden,deprecated) | استراتيجية القص لا تساوي تصنيف المصدر؛ surah_slice محظور دون offset_verified. HF clips للتدقيق فقط، ولا يضاف وضع clips إنتاجي في D2 |
| `recitation_chapters` | `recitation_id`, `surah`, `audio_url`, `duration_ms`, `audio_status`, `last_verified_at`, UNIQUE(`recitation_id`,`surah`) | صوت السورة |
| `ayah_timings` | `recitation_id`, `surah`, `ayah`, `clip_audio_url` NULL, `source_offset_ms` NULL, `clip_duration_ms`, `segments` JSON, `words` JSON, `quality`, `source` (qud,aligner,manual,estimated), `version`, `confidence` NULL, `approved_by` NULL, `approved_at` NULL, UNIQUE(`recitation_id`,`surah`,`ayah`) | ≈ 6k صف × عدد التلاوات (مئات الآلاف: مقبول) |
| `ayah_timing_history` | `ayah_timing_id`, `version`, `snapshot` JSON, `changed_by`, `reason` | تدقيق ورجوع |
| `import_jobs` | `type`, `source`, `params` JSON, `status`, `progress`, `stats` JSON, `error`, `started_at`, `finished_at`, `created_by` | يغذّي مركز الاستيراد |
| `alignment_jobs` | `recitation_id`, `surah`, `verse_from`, `verse_to`, `model_name`, `device`, `riwayah`, `aligner_audio_id`, `status`, `stage`, `result_ref`, `error_code`, `retry_after_at`, `created_by` | |
| `render_jobs` (موجود) | **أضف**: `recitation_id`, `timing_version_hash`, `audio_mode_used`, `fallback_used` | كل ريندر يسجّل ما استُخدم فعلاً |

فهارس: `(recitation_id, surah)`, `(status)`, `(reciter_id)`, FULLTEXT اختياري على أسماء القراء. استعلام الآيات بمدى يجب أن يستخدم `(recitation_id, surah, ayah)`.

---

## 4. المراحل (D0 → D9)

> **لكل مرحلة:** المهام ← مخرجات ← **قبول** ← **اختبارات**. لا تنتقل قبل تحقق القبول.

### D0 — جرد وخط أساس (قراءة فقط)
**المهام**
1. شغّل المشروع محلياً (`npm run db:setup`, `npm run dev:all`) وسجّل ما يعمل وما لا يعمل.
2. اجرد أين يُعرَّف/يُستهلك كل من: السور، القراء، الروايات، النص القرآني، التوقيتات، روابط الصوت (ابحث عن `everyayah`, `qurancdn`, `qdc`, `reciter`, `timingMap`, `wordTimingEngine`). أنتج جدولاً: *المفهوم → الملف → هل hardcoded أم DB → من يستهلكه*.
3. حدّد أي أجزاء تعتمد على Quran Foundation/EveryAyah وأيها على قاعدة البيانات.
4. حدّد أين تقع migrations الأدمن (فرع/worktree) وحالتها.
5. شغّل `npm test` و`npx tsc --noEmit` و`npm run lint` وسجّل خط الأساس (AGENTS يذكر 22 suite/180+ اختباراً سابقاً — تحقق من الرقم الفعلي).
6. نفّذ تجارب **[تحقّق]** في قسم 1.4 و2.3 و2.4 وسجّل النتائج.

**مخرجات:** `docs/data-audit.md` (جدول الجرد + نتائج التجارب + قائمة المخاطر).
**قبول:** لا تعديل على الكود؛ كل **[تحقّق]** له نتيجة مكتوبة.

### D1 — النص القرآني والسور والمصاحف
**قرارات المستخدم المعتمدة بعد D0 (تغلب النص الأقدم):**
- مصدر العرض القانوني هو script العثماني المثبّت من QUD Release `v3.2.0`، بعد التحقق من أعداد السور/الآيات/الكلمات. HF للتدقيق فقط؛ `text_uthmani` الخاص بالتلاوة يُحفظ كنص منطوق منفصل، ولا يُعرض كنص قانوني.
- `repetition_display_mode=canonical` افتراضياً؛ word diff يربط التكرار بالمواقع القانونية. فشل الربط = `needs_review` وتظليل آية فقط؛ لا estimated افتراضي.
- `basmala_mode` يُستنتج من بيانات التلاوة مع سبب؛ غياب 1:1 يعني أنها غير متاحة، دون تصنيع أو استبدال الصوت.
- `source_offset_ms` ليس معتمداً عالمياً. في D2 تُضاف `offset_verified` (false افتراضياً) و`offset_check_score`، ولا يُسمح `surah_slice` قبل نجاح ≥5 آيات موزعة، correlation ≥0.95 وفرق مدة ≤30ms. الفشل = غير منشور و`needs_review`؛ إعادة المحاذاة على الصوت الفعلي في D5 فقط.
- لا استضافة صوت جديدة؛ روابط HF الموقعة للتدقيق فقط. التوفر لكل تلاوة/سورة يتطلب 100% آيات و100% توقيت كلمات، والمدى الناقص يُرفض برسالة واضحة في D4/D8.
- في D1 تُنشأ جداول النص السبعة فقط؛ لا catalog أو UI أو ريندر جديد. استنتاجات التلاوات تُحفظ في تقرير D1، ثم تُنقل إلى `recitations` عند migration D2؛ لا يُنشأ جدول D2 مبكراً.
- كل استيراد يخزن `qud_version`، وتُحسب أعداد المصدر ديناميكياً. أعداد Hafs الثابتة الموجودة هنا معايير قبول/مرجع اختبار وليست ثوابت داخل كود المنتج.
- تُضاف إلى قبول D1: فحص corpus كامل للخط، وفحص كل configs المنشورة، وdry-run، وتحقق استيراد متكرر وrollback على MySQL اختبار معزول.
- قرار البروفة بعد فحص Railway: الإصدار المطابق هو MySQL 9.7.2 بالضبط. كل الجداول/الأعمدة القائمة unicode_ci؛ الجديدة تحدد `utf8mb4_unicode_ci` صراحة على الجدول والعمود، والنص القانوني أو المنطوق `utf8mb4_bin`، والبحث المشتق فقط unicode_ci. لا ALTER لجدول قائم ولا FK إليه. اختبار information_schema وDISTINCT/unique للحركات وjoin مع users على النسخة المستعادة إلزامي.
- SQL حتمي خارج Git، عبر SSH stdin فقط، باتصال واحد ودفعات ≤1000. backup منطقي مستعاد ومقارن بالأعداد وCHECKSUM TABLE قبل الكتابة؛ snapshot إضافي إن أتاحه Railway. لا اختبارات مدمرة على Railway؛ البروفة المدمرة محليًا على النسخة المستعادة 9.7.2. staging مستقلة ومتحقق من إصدارها، وتطبيقها إضافي فقط. حذف dump الخاص بعد إغلاق المرحلة، مع إبقاء نسخة Railway القائمة.
**المهام**
1. migrations للجداول: `riwayat, quran_text_versions, quran_surahs, quran_ayahs, quran_words, translations, translation_ayahs`.
2. سكربت استيراد `scripts/import-quran-text.ts`: المصدر النص العثماني (`text_uthmani`) من بيانات QUD/QUL (من صفوف dataset أو من ملف مرجعي مثبّت). يُشغَّل **dry-run** أولاً ثم فعلياً، وهو idempotent.
3. توليد `quran_words` بتقسيم النص على المسافات مع **مطابقة عدد الكلمات** مع `word_timestamps` في عيّنة من الآيات (اختبار اتساق).
4. البسملة: حقل `has_basmala` للسورة (كل السور عدا التوبة، والفاتحة بسملتها آية 1). **[تحقّق]** كيف تتعامل كل تلاوة معها (آية 1:1 ضمن الصفوف أم مقطع سابق). خزّن في `recitations` سلوك البسملة (`basmala_mode`: `ayah_1_included | separate_clip | absent`).
5. الخط: اعتمد خطاً يغطي كل علامات النص العثماني المستورد (DigitalKhatt مذكور مصدراً لـ QUD). اختبار تغطية الجليفات (قسم 5).
6. **ممنوع** أي تعديل على النص من الذكاء الاصطناعي. نقطة `refine-text` تُحصر في الابتهالات/النصوص غير القرآنية ولا تقبل مرجعاً من `quran_ayahs`.

**قبول:** 114 سورة؛ مجموع الآيات لحفص = 6236؛ أعداد الآيات لكل سورة تطابق قائمة مرجعية مكتوبة في ملف اختبار؛ كل كلمة تُرسم بلا مربعات (tofu) في الواجهة والريندر.
**اختبارات:** counts، checksum النص، تطابق عدد الكلمات مع عيّنة QUD، تغطية الخط، idempotency للاستيراد.

### D2 — كتالوج القراء والتلاوات والمزوّدين
**القرارات الملزمة:** راجع `DECISIONS.md`. المصدر QUD Release v3.2.0 ببصمة فعلية؛ HF تدقيق فقط. القراء حسب reciter_id فقط؛ configs الخارجية unmapped_sources ولا استيراد. الروايات غير حفص imported بلا مرجع حفص وبلا نشر. أربع جداول جديدة فقط؛ riwayah_id VARCHAR(36) بلا FK إلى riwayat القائمة؛ FKs داخل D2 فقط. basmala_mode لوجود 1:1، وحالتان مستقلتان للبسملة النصية والصوتية؛ الصوتية unverified افتراضياً وقيد قاعدة يمنع published دون دليل ومراجعة. verification_status مستقل pending/passed/failed/source_unavailable. timing_complete=NULL وis_complete=false حتى D3. البروفة المدمرة محلية على restored MySQL9.7.2؛ staging إضافة فقط، ثم apply منفصل للإنتاج عبر SSH و--confirm-production، والتحقق قراءة فقط. لا تغيير UI أو renderer أو الخرائط القائمة.
**المهام**
1. migrations: `reciters, audio_providers, recitations, recitation_chapters`.
2. **محوّل مصدر** (Provider Adapter) بواجهة موحدة:
```ts
interface CatalogAdapter {
  id: string;
  listRecitations(): Promise<RecitationDescriptor[]>;
  listChapters(slug: string): Promise<ChapterDescriptor[]>;
  resolveAudio(slug: string, surah: number): Promise<AudioDescriptor>;
  loadTimings?(slug: string, surah: number): AsyncIterable<AyahTiming>;
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}
```
   في D2: `QudReleaseAdapter` فقط (من Releases/`catalog.json`)؛ HF محوّل تدقيق صوتي محلي وليس مصدر كتالوج أو مزوّد إنتاج. سجلات EveryAyah/QDC والمصادر الفعلية توثيقية غير مفعّلة، ومسار التشغيل الحالي ثابت. بقية المحوّلات تؤجل لمرحلتها وموافقة المستخدم. إضافة مصدر = محوّل محقون + سجل موثّق، دون تعديل محرك الاستيراد.
3. **[تحقّق]** حمّل `catalog.json` من Release المثبّت v3.2.0 وسجّل حقوله الفعلية وبصمة SHA، ثم اربط الحقول بالأعمدة أعلاه (لا تخمّن الأسماء أو ثبات الملف تحت tag).
4. استيراد القراء: ادمج التلاوات التي تخص نفس الشخص تحت `reciter` واحد (مثلاً مرتّل/مجوّد/روايتان). المطابقة عبر الميتاداتا في الكتالوج وليس عبر تحليل الـ slug.
5. تقرير تغطية لكل تلاوة: عدد الآيات/السور المتاحة، ومستوى التوقيت.
6. نشر تلقائي ممنوع. imported افتراضياً؛ فشل الصوت needs_review لحفص؛ غير حفص imported غير منشور. published يتطلب صوت بسملة مراجع بدليل، offset معتمد، مرجع قانوني للرواية، و100% تغطية آيات/توقيت كلمات. source_unavailable لا يساوي نجاحاً أو فشلاً صوتياً.

**قبول:** استيراد جميع سجلات Release المثبّت مرتين دون تكرار، أعداد محسوبة من المصدر، دمج بهوية المصدر فقط، coverage/missing ranges وHF mismatch موثقة، عدم نشر آلي بقيد MySQL، verify-offset فعلي وقابل للاستئناف. تبقى خرائط runtime القائمة حتى D7/D8 ولا يُحذف ملف قائم في D2.
**اختبارات:** استيراد fixture صغير، إعادة التشغيل لا تُنتج تكرار، تقرير التغطية صحيح، محوّل وهمي (mock) يُضاف دون تعديل المحرك.

### D3 — استيراد التوقيتات (آية/كلمة/حرف) إلى `ayah_timings`
**المهام**
1. المستورد الأساسي أمر CLI مستقل عن BullMQ، مع checkpoints في `import_jobs`، محليًا وعلى production عبر SQL حتمي وRailway SSH. يقرأ Release v3.2.0 JSON المثبّت وبصمة SHA؛ HF للمقارنة فقط، بلا استيراد توقيتات منه. طبقة BullMQ منفصلة لـ A3؛ تشخيصها في D3 مستقل ولا يوقف قبول المستورد بعد حد المحاولتين المعتمد.
2. مُطبِّع `normalizeTiming()` موحّد: حتمي بلا علاج صامت أو إعادة ترتيب؛ أي endMs ناقص أو وقت سالب أو تعارض يوثّق needs_review. تحفظ المصادر والترتيب والتكرار، ويربط النص المنطوق بالقانوني عبر word diff؛ فشل الربط يعطل تظليل الكلمات. السبعة المعيبة fixtures إلزامية.
3. تخزين `source='qud'`, `quality='aligned'`, `qud_version`.
4. تخزين مستوى الحرف في `letters` JSON (اختياري) فقط إن احتاجته ميزة محددة؛ لا تمتلئ به القاعدة بلا استخدام.
5. حساب `coverage_*` بعد كل استيراد؛ تقرير فروق بين نسختين (diff).
6. الأداء: دفعات ≤1000 صف باتصال واحد وفحص اتصالات ومساحة قبل كل دفعة، تقدم محفوظ واستئناف بعد الانقطاع. كل التلاوات المثبتة مطلوبة، بما فيها الفاشلة في offset اللازمة لـ D5. يقاس JSON_STORAGE_SIZE مع 50% overhead، ويرفع الاحتياط إلى الحجم المحلي الفعلي إن كان أكبر؛ يجب ألا يتجاوز 60% من المساحة الحرة. يستبدل ذلك حد 500MB/30% السابق بقرار المستخدم. يبدأ الإنتاج بتلاوة ahmed_saud_mp3quran، ويقاس النقل؛ إذا تجاوز التقدير أربع ساعات تحسن الطريقة قبل المتابعة. سقف الصرف 30$ والتنبيه 20$؛ التوقف إذا بقي أقل من 3$ بعد تقدير تكلفة الدفعة.

**قبول:** جميع التلاوات المثبتة تطابق التحضير؛ كل كلمة قانونية لها توقيت أو سبب نقص موثق، والتغطية الكاملة 100% دون تخفيف. لا قيم سالبة في التوقيتات الفعالة؛ المصدر المعيب يبقى دون تعديل في `source_rows` مع needs_review وتظليل الكلمات معطلًا. الصفوف السبعة من HF fixtures فقط؛ لا جدول تدقيق HF أو جامع مساحة دائم في production. فحص المساحة عند الطلب في health/ready بكاش خمس دقائق، ولا يسقط الجاهزية بسبب تحذير المساحة.
**اختبارات:** golden fixtures (قسم 6)، تطابق عدّاد الكلمات، استئناف، idempotency.

### D4 — طبقة الصوت `AudioResolver`
**المهام**
1. دالة واحدة: `resolveAudioPlan({recitationId, surah, from, to}) → AudioPlan`:
```ts
interface AudioPlan {
  mode: 'surah_slice' | 'ayah_clips';
  parts: { url: string; sliceFromMs?: number; sliceToMs?: number }[];
  coordinate: 'chapter_ms' | 'clip_ms';
  provider: string; license: string; attribution: string;
  fallbackUsed: boolean; fallbackReason?: string;
}
```
2. الأولوية صريحة ومخزّنة في الأدمن لكل تلاوة (`audio_mode` + سلسلة مصادر). **الـ fallback مسموح فقط إن كان مضبوطاً في الأدمن**، ويُسجَّل في `render_jobs.fallback_used` ويظهر للمستخدم. لا fallback صامت.
3. `surah_slice`: قص من صوت السورة بإعادة ترميز دقيقة (FFmpeg `-ss` بعد `-i` أو قص بعد فك الترميز) لتجنب إزاحة MP3؛ مرتبط بنتيجة تجربة 2.3.
4. `ayah_clips`: دمج المقاطع بـ concat مع cross-fade قصير (يوجد اختبار `audioConcat` حالي).
5. **SSRF:** قائمة المضيفين المسموحة تأتي من `audio_providers.host_allowlist` (لا ثابتة في الكود)، مع بقاء حجب 127.0.0.0/8 و169.254.0.0/16 والشبكات الخاصة. لا `blob:` أبداً.
6. فحص صحة الروابط (HEAD/Range) دوري يحدّث `recitation_chapters.audio_status`.

**قبول:** لأي (تلاوة، سورة، مدى) يرجع الـ resolver خطة يمكن تشغيلها؛ الفشل يعطي سبباً واضحاً لا صوتاً صامتاً.
**اختبارات:** SSRF، رفض blob، قص بمدى ومطابقة المدة ±30ms، دمج بلا نقرات، fallback مسجّل.

### D5 — تكامل الـ Aligner (ملء الفجوات وإعادة المحاذاة)
**المهام**
1. `server/services/alignerClient.ts` مكتوب من `openapi.json` (يفضّل توليد types منه). إعدادات (من الأدمن/البيئة): `baseUrl`, `hfToken` (سري)، `modelName`, `device`, `timeouts`.
2. معالجة أخطاء بالـ `code`: `gpu_quota_exhausted/402` ⇒ حالة `waiting_quota` + جدولة؛ `429` ⇒ `retry_after_at` من `detail.retry_after_s`؛ `503 gpu_temporarily_unavailable` ⇒ إعادة محاولة بتأخير أسي (حد أقصى 5)؛ `404` ⇒ أعد الرفع/المحاذاة؛ `422` ⇒ فشل نهائي مع تفاصيل؛ لا حلقة لا نهائية.
3. استهلاك بث SSE وتحويل `progress` إلى `alignment_jobs.stage`. تعامل مع `keepalive` ومع قطع الاتصال.
4. العمل عبر BullMQ بتزامن 1 (مراعاة الحصة) وإمكانية الإيقاف المؤقت من الأدمن.
5. **المخرجات تُحفظ** `source='aligner'`, `quality='aligned'`, في حالة `needs_review`، ولا تُنشر تلقائياً.
6. تفضيل المقاطع المراجعة الجاهزة: قبل أي محاذاة استدعِ `GET /recitations/.../segments`؛ إن وُجدت فاستوردها بدل إعادة الحساب.
7. تخزين مؤقت حسب hash الصوت+الخيارات لتجنب استهلاك الحصة.
8. إن تعذّر الـ Aligner: الحالة `pending/failed` مع السبب؛ **ممنوع** اختلاق توقيت بالمحرك التقريبي وإظهاره كأنه محاذاة.
9. خيار مستقبلي موثّق: استضافة ذاتية (مستودع QUD يحوي `qua_jobs` و`inspector`) إن تجاوز الحجم حد الـ Space.

**قبول:** محاذاة سورة قصيرة (مثلاً الإخلاص) من URL تنتهي بمقاطع وكلمات محفوظة؛ محاكاة 402/429/503 تنتج الحالات الصحيحة.
**اختبارات:** mock server يحاكي كل الأكواد وSSE؛ اختبار حي اختياري (`ALIGNER_LIVE=1`) بسورة قصيرة.

### D6 — مراجعة التوقيت واعتماده
**المهام**
1. **مدققات آلية** (تعمل بعد كل استيراد/محاذاة وتغذي علامة `needs_review`):
   - عدد الكلمات المحاذاة = كلمات الآية (مع استثناء التكرار الموثّق).
   - `end > start`، لا تداخل غير مبرر، فجوة بين كلمتين ≤ حد قابل للضبط.
   - تغطية الصوت: آخر كلمة قريبة من نهاية المقطع (≤ 1.5s).
   - مدة كلمة شاذة (قصيرة جداً < 40ms أو طويلة جداً > حد قابل للضبط).
   - مقاطع تتداخل فهارسها (تكرار) ⇒ علامة معلومة لا خطأ.
2. شاشة/واجهة API للمراجعة (تُبنى في الأدمن A3): موجة صوتية، سحب حدود الكلمات، تشغيل مقطع، مقارنة نسختين، اعتماد/رفض مع سبب، سجل إصدارات (`ayah_timing_history`).
3. اعتماد جماعي بشروط ("اعتمد كل ما اجتاز المدققات بدون تحذيرات").
4. تصدير/استيراد JSON لتوقيت (لمشاركة التصحيحات مع مجتمع QUD عند الرغبة).

**قبول:** يمكن لأدمن أن يصحّح كلمة ويعتمد، ويظهر التصحيح في الريندر التالي.
**اختبارات:** كل مدقق بحالة نجاح/فشل؛ تتبّع الإصدارات؛ الصلاحيات.

### D7 — ربط الريندر (RenderManifest + المحرك الحتمي)
**قبول إضافي معتمد:** render-harness على Railway يستخدم ملفات الخطوط من `public/fonts` دون اعتماد على CDN خارجي. اختبار E2E D1 استخدم Amiri مضمّنًا ولا يثبت سلوك الإنتاج؛ يلزم إثبات إنتاجي فعلي في D7.
**المهام**
1. تحديث `RenderManifest` (الإصدار 1.1): أضف `recitationId`, `timingVersionHash`, `audio.mode`, `audio.coordinate`. اجعل الـ schema يرفض توقيتاً خارج الإحداثيات (يستدعي `assertTimelineValid`).
2. الكلمات تُقرأ في السيرفر من `ayah_timings` المعتمدة، **لا** من جسم الطلب (تقليل ثقة العميل). الواجهة ترسل `{recitationId, surah, from, to, options}` فقط، والسيرفر يبني الـ `timingMap`.
3. في `render-harness.html`: التظليل بالزمن (قسم 2.4) + waqf-hold + دعم التكرار؛ تعطيل glow إن `quality='estimated'` ما لم يُفعَّل صراحة.
4. تسجيل ما استُخدم فعلاً (provider, mode, fallback, timing hash) في `render_jobs`.
5. حذف المنطق المكرر القديم (خرائط قراء، `+offset` متفرقة) بعد اجتياز الاختبارات.

**قبول (فحص ناتج فعلي، وليس build فقط):** ريندر آيتين لثلاث قراء مختلفين: ffprobe يطابق المدة؛ استخراج إطارات عند أزمنة معروفة يُظهر الكلمة الصحيحة مضاءة؛ A/V sync ضمن ±40ms؛ لا إطار أسود.
**اختبارات:** golden-frame tests (تظليل الكلمة k عند t)، اختبار الإحداثيات، اختبار تكرار، اختبار `estimated` بلا glow.

### D8 — ربط الواجهة الأمامية والـ API العام
**الخطوط:** القرآن بالستة المثبتة على corpus كامل فقط: Amiri، Amiri Quran، Noto Naskh Arabic، Scheherazade New، Lateef، Mada. العشرة الناقصة ليست خيارات قرآن معتمدة؛ تطبيق القيد في D8/A4 دون تغيير UI في D2.
**Endpoints عامة (للقراءة، مع ETag/Cache-Control):**
- `GET /api/catalog/surahs`, `/api/catalog/riwayat`
- `GET /api/catalog/reciters?riwayah=&style=&q=&timing=word&featured=1`
- `GET /api/catalog/recitations/:slug` (تغطية، أسلوب، إسناد)
- `GET /api/catalog/recitations/:slug/chapters/:surah` (متاح؟ مدة؟)
- `GET /api/quran/ayahs?surah=&from=&to=&riwayah=` (نص + كلمات)
- `GET /api/catalog/recitations/:slug/chapters/:surah/timing?from=&to=` ⇒ `{ audioPlan, ayahs: AyahTiming[], level, quality, version }`

**الواجهة:**
- اختيار السورة ← الآيات (تحقق من الحدود بحسب الرواية) ← الرواية ← القارئ (يُرشَّح بالقراء الذين لديهم تلاوة منشورة لتلك السورة) ← التلاوة/الأسلوب.
- شارة مستوى التوقيت (كلمة/تقريبي) وتعطيل خيار "تظليل الكلمات" عندما لا يتوفر توقيت معتمد، مع تفسير.
- عرض الإسناد (CC BY 4.0 + مصدر الصوت) في صفحة الريل ونص قابل للنسخ مع كل تصدير.
- المعاينة والريندر يستخدمان **نفس** `AudioPlan` ونفس `toRenderTimeline` (لا مسارين مختلفين).
- حذف أي قائمة قراء/سور ثابتة من الواجهة.

**قبول:** إضافة قارئ جديد من الأدمن (بعد النشر) يظهر في الواجهة دون نشر كود.
**اختبارات:** Vitest للـ hooks، E2E (tooling/e2e) لمسار: اختر سورة/آيات/قارئ ← معاينة ← تصدير؛ اختبار قارئ جديد يُضاف ويظهر.

### D9 — تصليب وأداء
- فهارس واستعلامات (EXPLAIN) لأهم 5 استعلامات؛ كاش ذاكرة/Redis للكتالوج (TTL + إبطال عند تغيير الأدمن).
- حدود معدل لـ endpoints العامة، وحجم الاستجابة (مدى آيات ≤ حد).
- نسخ احتياطي واستعادة مجرّبة لجداول الكتالوج والتوقيتات.
- مراقبة: مقاييس عدد الاستيرادات/المحاذاات/الأخطاء، وتنبيه عند فشل متكرر.
- وثائق: `docs/data-architecture.ar.md`, `docs/adding-a-reciter.ar.md`, `docs/adding-a-provider.ar.md`.

---

## 5. اختبارات إلزامية (مجمّعة)

1. **اتساق النص:** 114 سورة، 6236 آية (حفص)، أعداد الآيات لكل سورة، عدم تغيّر checksum.
2. **تغطية الخط:** لكل رمز Unicode يظهر في `text_uthmani` (بما فيها ۞ ۖ ۛ ࣰ ࣱ ۟) تأكد أن الخط المستخدم في الواجهة **وفي harness الريندر** لديه glyph (مقارنة بجدول cmap). فشل = tofu.
3. **عقد الإحداثيات:** `assertTimelineValid` على كل ريندر؛ اختبار "آيات تتحرك": مدى سورة متوسطة، أول كلمة آية 2 تُضاء عند زمنها المتوقع لا قبله ولا بعده.
4. **التكرار:** صف فيه تداخل فهارس ⇒ التظليل يقفز للخلف دون استثناء.
5. **الفجوات:** t داخل فجوة بين كلمتين ⇒ الكلمة السابقة تبقى مضاءة.
6. **المزوّدون:** SSRF، رفض blob، مضيف غير مسموح، فحص صحة الروابط.
7. **الـ Aligner:** محاكاة 402/429/503/404/422/502 وSSE.
8. **الاستيراد:** idempotency، استئناف، تقرير التغطية.
9. **الأداء:** استعلام مدى آيات لتلاوة كاملة < 50ms محلياً بعد الفهارس (قياس مسجّل).
10. **الريندر الحقيقي:** ffprobe + استخراج إطارات + فحص A/V sync (مراجعة يدوية لعيّنة 3 قراء بصرياً وسمعياً).

## 6. Golden fixtures (استخرجتها من صفوف فعلية في dataset)

> قيم من `abdul_hamid_ghraio_2025_yt` كما ظهرت في عارض البيانات. استخدمها كعيّنة اختبار للمحلّل (parser) والمطبّع. **[تحقّق]** منها مجدداً من الـ dataset قبل تثبيتها.

| الآية | `duration_ms` | `segments` | `word_timestamps` |
|---|---|---|---|
| 1:2 | 3328 | `[[1,4,6,3328]]` | `[[1,236,806],[2,806,1426],[3,1426,1846],[4,1846,3296]]` |
| 1:3 | 2566 | `[[1,2,24,2566]]` | `[[1,94,1124],[2,1124,2254]]` |
| 2:7 (3 مقاطع) | 11476 | `[[1,6,25,4675],[7,9,4935,8125],[10,12,8385,11476]]` | 12 كلمة (انظر الصف) |
| 2:32 (تكرار) | 9940 | `[[1,12,1,9940]]` | فهارس 1..12 |
| 2:31 (تداخل فهارس) | 19527 | `[[1,10,16,10340],[9,15,10416,19527]]` | الكلمات 9–10 تتكرر |

اختبارات من الجدول: لا فجوة سالبة؛ `segments` تغطي `[firstWordStart, lastWordEnd]`؛ المقاطع المتداخلة فهرسياً تُقبل وتُسجَّل `repetition=true`.

## 7. أخطاء شائعة تمنعها الخطة (قائمة مراجعة للمراجع)

- [ ] أي `+ offset` خارج `toRenderTimeline`.
- [ ] أي قارئ/سورة/رابط مكتوب بالكود.
- [ ] أي fallback صامت لمزوّد آخر.
- [ ] أي توقيت `estimated` يظهر كأنه دقيق.
- [ ] أي تعديل لنص قرآني بالذكاء الاصطناعي.
- [ ] التوكن/المفاتيح في الواجهة أو اللوج.
- [ ] استدعاء الـ Aligner من المتصفح مباشرة بدل السيرفر.
- [ ] افتراض أن فهرس الكلمة يتزايد دائماً.
- [ ] نشر تلاوة بتغطية ناقصة دون إظهار ذلك للمستخدم.
- [ ] صوت يُعاد توزيعه بدون إسناد/مراجعة حقوق.

## 8. التراخيص والإسناد (نص مقترح لصفحة "المصادر والحقوق")

"التوقيتات والتقسيم والبيانات الوصفية من مشروع Quranic Universal Audio (QUD Technologies) بترخيص CC BY 4.0. التسجيلات الصوتية ملك لقرائها ومصادرها الأصلية (QuranicAudio، EveryAyah، MP3Quran، QUL، TVQuran، SurahQuran، Way2Quran). النص العثماني والميتاداتا من Qur'anic Universal Library (QUL)."

راجع بنود الاستخدام لكل مزوّد صوت قبل إعادة التوزيع التجاري، وسجّل نتيجة المراجعة في `audio_providers`.
