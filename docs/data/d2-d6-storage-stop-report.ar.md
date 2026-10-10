# تقرير الدفعة عند أول توقف إلزامي — 2026-10-10

## 1. ما الذي تغيّر

D2 مغلق، وB مغلق. بدأت D3 بتحضير البيانات والكود المنفصل، ثم توقفت قبل تطبيق أي migration أو استيراد توقيتات على staging أو production. D4 وD5 وD6 لم تبدأ؛ A1 لم يبدأ، ولا D7/D8/A2+. لا تغيير للواجهة أو الريندر. أغلقت أدلة B على commit d8909f7؛ باقي التغييرات على codex/data-pipeline-d2-d6 وغير مدمجة في main.

كود D3 المحضّر: normalizeTiming بلا علاج صامت، قارئ Release pinned، تجهيز كل المدخلات، SQL حتمي بدفعات≤1000 مع نقاط استئناف، ومقارنة القيم الفعلية لا version_hash وحده. migration003 مع down محلي فقط، غير مربوط بـstartup. الجداول المخططة:

- ayah_timings: id, recitation_id, ayah_id(nullable), surah, ayah, source, quality, qud_version, source_sha256, canonical_checksum(nullable), coordinate, source_offset_ms(nullable), start_ms/end_ms(nullable), segments, words, spoken_text(nullable), source_rows, review_status, review_reasons, word_highlight_enabled, repetition_display_mode, coverage_words, expected_words(nullable), missing_words, version_hash, import_job_id, created_at, updated_at.
- import_jobs: id, recitation_id, qud_version, source_sha256, manifest_sha256, canonical_checksum, importer_version, status, checkpoint, total_rows, imported_rows, review_rows, error_json, created_at, updated_at.
- ayah_timing_history: id, timing_id, version_hash, snapshot, reason, created_at. التاريخ محفوظ لتغييرات لاحقة؛ لا FK نحو جدول قائم.
- recitation_chapters (جدولنا منD2): coverage_words, expected_words, coverage_details، مع timing_complete/is_complete الموجودين. كل الأعمدة النصية الجديدة collation=utf8mb4_unicode_ci.

## 2. ما تحققت منه فعليًا

### الصوت B

48/48 تلاوة فاشلة و720 عينة قِيست وأُعيد PCM مستقلًا؛ v1 مطابق720/720 للقيم المحفوظة بتسامح1e-10، ولا استبدال للنتيجة الأصلية8 passed/48 failed/13 source_unavailable. التصنيف المستقل:4 فرق ترميز/معالجة،1 إزاحة ثابتة،31 أثر حدود العينة،12 غير محسوم؛ drift مثبت0 وصوت مختلف مثبت0. تفاصيل الأسباب والتقسيم حسب المزوّد/القناة/الفئة/الأسلوب/الرواية في [تقريرB](d3-audio-failure-diagnosis.md).

اعتمدت v2 لأحمد سعود MP3Quran، ومشاري العفاسي MP3Quran، ومحمد الغزالي Archive، لكل منها15 عينة موزعة على3 سور، دون تغيير القاعدة بعد. إثباتات packet/native PCM والمراجع المستقلة كاملة؛ إعادةsegments75 مرجعًا لخمس تلاوات ضمن نطاق موثق، و5 overlays حقيقية فُحصت محليًا خارجGit. log-mel تشخيص دون حد قبول مخترع. [قرارv2 والمقاييس](d3-offset-v2-accepted.json)، [المراجعة المستقلة](d3-audio-independent-review.json)، [تطابقv1](b-v1-replay-equality.json). بدائل13 مصدرًا هي عينة سورة112 فقط، لا تعميم ولا إثبات حقوق أو offset؛ لا استخراج YouTube.

### D3 والمصادر

أُنجز prepare-qud-timings.ts على69 حزمة Releasev3.2.0، كل ZIP مطابق SHA/bytes من manifest المثبت bde8378c…645cf؛ HF لم يُستعمل لاستيراد توقيتات. الناتج المحلي422,463 صفًا (يتضمن صفوف النقص الموثق)، وبصمات ملفات JSONL محفوظة؛ لا JSONL/ZIP/صوت/Parquet فيGit. حالة المراجعة وسبب كل نقص موجودان. اكتُشف أن بعض إصدارات غير حفص لا تحتوي letter؛ يقرأ المستورد tiers المعلنة، ويحفظ spoken_text=NULL مع SPOKEN_TEXT_UNAVAILABLE؛ لا استعارة نص حفص. [التحضير69](d3-release-preparation.json)، [المحاولة السابقة وسبب استبدالها](d3-source-schema-first-attempt.json)، [جدول69 تلاوة](d3-recitation-status-at-stop.md).

### السعة — سبب التوقف

df -B1 --output=avail /var/lib/mysql على الإنتاج أعطى118,530,048 bytes حرة؛ حد30%=35,559,014.4 bytes. تقدير كل69 تلاوة من payload الأعمدة الفعلية=580,163,495 bytes قبل InnoDB/الفهارس/JSON binary، فتجاوز500MB. فُعل شرط النطاق البديل حسابيًا:24 تلاوة (v1 غير failed، مع الثلاث المقبولةv2)،143,590 صفًا.

ثم قِيس JSON_STORAGE_SIZE فعلًا على MySQL9.7.2 لكل صف في هذا البديل، مع JSON_TABLE بدفعات250، وجُمعت أحجام الأعمدة العددية وفق أنواعDDL والنصية وفقUTF8. الحد الأدنى223,071,669 bytes، أي يتجاوز كامل المساحة الحرة بـ104,541,621 bytes، قبل الفهارس/pages/redo/history. هذا حد أدنى للبيانات لا حجم allocation نهائي. أدلة [df](d3-production-disk-free.json)، [التقدير والنطاق](d3-size-preflight.json)، [القياس الفعلي](d3-local-binary-size-measurement.json).

القياس المحلي للـJSON استعمل:

```sql
SELECT SUM(JSON_STORAGE_SIZE(j.segments)+JSON_STORAGE_SIZE(j.words)
 +JSON_STORAGE_SIZE(j.source_rows)+JSON_STORAGE_SIZE(j.review_reasons)
 +JSON_STORAGE_SIZE(j.missing_words)) AS bytes
FROM JSON_TABLE(CAST(? AS JSON),'$[*]' COLUMNS(
 segments JSON PATH '$.segments',words JSON PATH '$.words',
 source_rows JSON PATH '$.source_rows',review_reasons JSON PATH '$.review_reasons',
 missing_words JSON PATH '$.missing_words')) j;
```

كلمعلمة دفعة من ملفات JSONL المحضرة المطابقة لبصماتها، دون INSERT/DDL. الأنواع العددية المستخدمةSMALLINT2/INT4/BIGINT8/ENUM1/BOOLEAN1. المسارات الخاصة %TEMP%/ayahx-d3-release-inputs؛ بقيت دون حذف.

### النسخة والإنتاج

قبل أي كتابة D3 أُنشئت نسخة logical age جديدة خارجGit: C:/Users/cpazi/AppData/Local/AyahX/private-backups/d3-production-20261010.sql.age، بصمتهاfd8580df8fca4c23903150c56d93ac65934de2d10e6eaddf271b774f7bfbc510. تحققت باستعادة51 جدولًا على9.7.2، جميعCOUNT وCHECKSUM مطابقة؛ مفتاحage باقٍ. الأمر backup-quran-catalog.ts --inventory docs/data/d3-production-before-inventory.json --db-name ayahx_d2_d3_backup_20261010؛ الوسائط الخاصة خارجGit. [التحقق](d3-production-backup-verification.json).

فحص التوقف للقراءة فقط علىstage/prod: D1=114/6236/77433 وبصمة القانونيeca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4 ثابتة. counts الحرجة ثابتة، ولم تُنشأ جداولD3. الإنتاج بلا تغيرCHECKSUM. staging تغيّرت بصمةrender_engine_capacity فقط مع ثبات3 صفوف؛ مصدره تحديث دوري قائم فيserver/services/renderAutoscaler.ts:140، وهو خارجالجداول الحرجة ولا كتابة منا. [الدليل](d3-storage-stop-database-readonly.json).

| الجدول الحرج | staging | production |
|---|---:|---:|
| users |2|13|
| subscriptions |4|16|
| payment_requests |1|3|
| saved_videos |1|7|
| render_jobs |0|72|
| system_settings |13|13|
| user_roles |3|13|
| notifications |3|49|

health/ready=200 وdatabase=connected؛ app1/MySQL0 سطور بلا أخطاء في03:20–03:28UTC. لا نشر جديد بعدB/D3. نشراD2 PR9/10 اجتازا4SUCCESS ونافذتي604s/619s وsmoke10/10؛ [PR9](https://github.com/jokertools12/AyahX/pull/9)، [PR10](https://github.com/jokertools12/AyahX/pull/10)، CI38006592918. [آخرhealth/log](d3-storage-stop-services.json).

## 3. نتائج الاختبارات

B:108/108 pass. D3 المستهدف:12/12 pass، تشمل السبعة الحقيقية المعيبة وتكرار الكلمات وغيابletter ورفضSHA وتناقضtiers ومنعcorruption حتى معversion_hashقديم وحظرdown خارجالمحلي. npm test معD1_QURAN_CORPUS الفعلي:483 pass/6 skipped/0 fail من489؛ الستة هي اختباراتrenderJobQueue المشروطة ببيئةDB، وليست فحوصD3 تم تنفيذها. التشغيل الأول بدونمتغيرcorpus كان482pass/7skip0fail وحُفظ مستقلًا. npx tsc --noEmit وstrict bundler لملفاتserver/scripts الجديدة، وeslint للملفات الجديدة، نجحت دون رسائل. لا إصلاحlint العام. [الكامل](d3-tests-with-corpus.json)، [الأول](d3-tests-before-storage-stop.json)، [B](b-root-tests-108.json).

MySQL المحلي9.7.2 اشتغل، وRedis7.2.14 محليًا على127.0.0.1:36379 أعادPONG. RedisWindows port مثبتSHA9ff186e6…27c91 منrelease الأصلي للـport؛ هذا تحققruntime فقط وليس قبولBullMQ. [مصدرالـport](https://github.com/redis-windows/redis-windows/releases/tag/7.2.14).

## 4. ما لم يكتمل أو يحتاج قرارك

توقف إلزامي رقم5: تطبيق النطاق البديل يحتاج سعة غير متوفرة، وزيادة volume أو إعداد الخدمة أو الإنفاق خارج التفويض. لم أغيّر volume، ولم أحذف شيئًا لتوفير مساحة، ولم أقلّص النطاق إلى دفعة جزئية غير معتمدة. لا كتابة D3 على staging أو الإنتاج، ولا دليل قبول staging يمكن تقديمه للإنتاج.

D3 لم يُغلق: بقي التشغيل الفعلي لـBullMQ، وبروفة migration/down وidempotent مرتين وقطع واستئناف على MySQL، وتحديث timing_complete/coverage، وقبول staging والإنتاج. اختبارات حتمية SQL لا تثبت استئناف DB فعليًا. D4–D6 لم تبدأ. عدم وجود drift مثبت يعني أن عينة drift المطلوبة لـD5 لم تتوفر؛ لا يعاد تصنيف EOF أو lag لتجاوز هذا الشرط.

## 5. المخاطر المعروفة

حجم allocation الفعلي أعلى من حد payload المقاس. التغطية المحضرة وقرار v2 لا يساويان قبول إنتاج. رخصة CC-BY للـRelease لا تثبت حقوق صوت المزوّد؛ license/attribution لم تُختلق، وعدد المنشور0. مصدر ماهر القديم بلا SHA يمنع اعتماد v2 له، دون تغيير v1. البسملة الصوتية unverified ولم تُعمّم نتائج166 مقدمة. snapshot مرفوض بسبب خطة Pro، ولا محاولة جديدة.

حالة التنظيف manual_cleanup_required. رفضت المراجعة الآلية محاولة Remove-Item المحددة بـblocked by policy، فلم تنفذ ولم تُستخدم بدائل حذف أو نقل أو ACL. تعليمات الحذف اليدوي السابقة في docs/d2-manual-cleanup.ar.md لم تُكرر. بقيت .age ومفتاح age وd2-import.sql وملفات المشروع محفوظة، والـscratch خارج Git. لا تدوير بحذف النسخ بعد الرفض الأمني.

## 6. الخطوة التالية المقترحة

يلزم قرار مستقل منك: توفير سعة أكبر بعمل يدوي أو تفويض صريح لتغيير volume، أو اعتماد نطاق أصغر محدد وأسبقيته. النطاق24 يحتاج223.1MB للبيانات فقط؛ ليكون أقل من30% يحتاج743.6MB حرة على الأقل قبل الفهارس والهوامش. هذه حدود دنيا وليست توصية نهائية بحجم volume.

عند حسم القرار تعاد السعة والنسخة والجرد وفق حالتها، ثم البروفة المحلية، ثم staging بنفس SQL/SHA، ثم الإنتاج بأمر apply مستقل. بعد قبول D3 فقط يُستأنف D4→D5→D6. لا دمج main أو deploy عند هذا التوقف.
