# تشغيل D2 وقيوده

التصريح الحالي كتالوج D2 فقط. راجع [القرارات](plan/DECISIONS.md) و[سجل التنفيذ](railway-ops-log.md). لا startup migration أو deploy أو واجهة/ريندر جديد. مصادر الصوت الأصلية فقط، HF تدقيق، وكل تلاوة غير منشورة.

## المصدر والوحدات

QUD Release v3.2.0، SHA الفعلي في `data/d2-catalog-source.json`. الملف الخام وcorpus وdataset وSQL والصوت خارج Git. counts محسوبة من الملفات؛ `mushafs` metadata وليس تلاوة. الدمج بـreciter_id فقط. QudReleaseAdapter يقبل bytes ذات البصمة المثبتة؛ source adapter محقون، لا registry runtime جديد أو fallback.

metadata/table/column: utf8mb4_unicode_ci صريح. D2 لا يخزن نصًا منطوقًا؛ `audit_json` إحصاءات D1، والتوقيتات لا تستورد حتى D3. أي عمود منطوق مستقبلي يجب utf8mb4_bin. source_reciter_id يحتفظ بقيمة المصدر، وcountry يحتفظ بالتسمية الفعلية دون تخمين ISO.

`coverage_ayahs` عدد معلن من catalog؛ `available_ayahs` عدد مرصود في snapshot HF المقبول في D1، مع المقارنة وmissing ranges الموسعة. سورة بلا مرجع عدّ لروايتها: expected_ayahs/coverage_mismatch=NULL وayahs_complete=false. لا يسقط عدّ حفص على غيره. توقيت الكلمات غير مستورد: timing_level=none وcoverage_words/timing_complete=NULL، وis_complete مولّد=false. التوفر في D4/D8 لكل سورة/مدى، وليس مجرد وجود URL أو العدد الإجمالي.

## الفحص الصوتي المحلي

Python/duckdb/numpy/scipy وFFmpeg في البيئة الخاصة الموضحة في dev-environment. المثال يستخدم مسارات scratch؛ لا ملف audio أو signed URL في التقرير:

```powershell
$env:PYTHONPATH = "$env:TEMP\ayahx-d2-python;$env:TEMP\ayahx-d1-python"
& '<Python المحلي>' -X utf8 scripts/verify-qud-offsets.py --catalog "$env:TEMP\ayahx-d2\catalog.json" --manifest "$env:TEMP\qud-parquet.json" --cache "$env:TEMP\ayahx-d1\configs" --ffmpeg '<FFmpeg المحلي>' --report docs/data/d2-offset-verification.json
```

الاختيار يُحسم قبل تنزيل الصوت أو قياس الارتباط: من الثلث الأخير للسور المؤهلة حسب annotation، تُختار أقصر/متوسطة/أطول ثلاثة أعداد آيات مختلفة؛ عند نقص التنوع يتوسع الاختيار إلى السور المؤهلة كلها. خمس آيات distinct من البداية/الربع/الوسط/ثلاثة أرباع/النهاية لكل سورة. الأدلة السابقة المكتملة محفوظة ولا تُعاد لتحسين نتيجة فاشلة. Parquet footer stats وconjunctive surah predicate يقللان audio column chunks دون تقليل العينة. NCC أقصى ±300ms؛ جميع samples يجب score≥0.95، فرق مدة≤30ms، abs(lag)≤30ms. فرق المدة هو decoded HF clip duration مقابل duration_ms المصدر، وليس حدًا مختلقًا من عدد الكلمات. source window من الصوت الأصلي، وموضع المطابقة يقارن إحداثي HF وcatalog+HF إذا وجد chapter_offset. chapter_offset هو أصل فصل السورة في تسجيل المصدر، وليس بديلًا عن موضع الآية؛ لا يتحول lag الثابت إلى تصحيح تشغيل تلقائي.

pending/passed/failed/source_unavailable مستقلة عن publication. ملف التقرير checkpoint للاستئناف؛ النتيجة المكتملة لا تعاد. HF request واحد، ≥2s للطلبات والredirects، Retry-After/backoff، وثلاث نوافذ حين يتعذر HF بفاصل≥30min. original catalog URL غير القابل للتنزيل/فك الصوت موثق بخطأ المصدر، ولا يستبدل بصوت HF أو مزوّد آخر. صفحة YouTube/Drive التي لا تعطي bytes صوت عبر هذا المسار تعني عدم توفرها **للتدقيق الحالي**، وليس ادعاء اختفاء التسجيل من الموقع.

الصوت الأصلي يُنزّل كاملًا ويُفك محليًا قبل المقارنة. اختبار HTTP Range على ملف قصير نجح، لكن seek لتسجيل طويل تعثّر بعد120s؛ لذلك لم يُعتمد هذا التحسين في فحص القبول (`data/d2-source-range-control.json` و`data/d2-long-source-range-control.json`). التسجيل الطويل نفسه متاح بالتنزيل الكامل، وقد استؤنف وفُحص؛ تعثّر التحسين ليس حكمًا صوتيًا على التلاوة. حفص غير offset_verified يحمل needs_review، وحالة verification تحفظ pending/failed/source_unavailable بدقة؛ غير حفص يبقى imported كما تقرر.

طول/طاقة/صمت prefix أدلة فقط؛ لا تثبت كلمات البسملة. كل surah_start_basmala_audio_status=unverified حتى مراجعة المستخدم. Aligner للبسملة فقط عند الحاجة ضمن التصريح؛ لا عميل D5 أو إعادة محاذاة عامة. كل scratch audio يحذف بعد المحاولة. `--resume-audio-dir` محصور في TEMP وبـ--config صريح لمحاولة interrupted، ثم يحذف أيضًا.

## dry-run والبروفة

```powershell
npx tsx scripts/import-qud-catalog.ts --dry-run --catalog "$env:TEMP\ayahx-d2\catalog.json" --corpus "$env:TEMP\ayahx-d1\corpus.json" --offset-report docs/data/d2-offset-verification.json --sql-out "$env:TEMP\ayahx-d2\d2-import.sql" --dataset-out "$env:TEMP\ayahx-d2\dataset.json"
npx tsx scripts/test-qud-catalog-db.ts --db-host 127.0.0.1 --db-name ayahx_d2_restored_972 --reset-local-catalog --dataset "$env:TEMP\ayahx-d2\dataset.json" --out docs/data/d2-local-rehearsal.json
```

السطر الثاني **مدمّر لجداول D2 الأربعة على النسخة المحلية فقط**، وحارسه loopback33319، prefixayahx_d2_ وMySQL9.7.2 بالضبط. up/import مرتان، CHECKSUM replay، collations/FK/join، corruption رفض، publication gates وrollback/reapply. لا بيانات fixture في الاستيراد الحقيقي؛ mocks للوحدات فقط. توليد SQL يرفض keys غير صالحة، activation غير المصرح للروايات، publication وtiming import. دفعة250≤1000.

reset المحلي بين خطط التطوير يحذف أيضًا IDs الروايات غير المفعلة الثلاث التي أدخلها D2 نفسه قبل إعادة fixture الكامل، دون حفص أو نص/مستخدمين. هذا إجراء تحضير للبروفة المحلية، وليس rollback إنتاجيًا أو إذن حذف riwayat على Railway. aligner_code لقالون هو `qalun` وفق enum المرجع، بينما code المصدر `qalon_an_nafi` محفوظ؛ فحص الاستيراد يتحقق من كل حقول metadata لا ID/activation فقط.

## Railway — dry-run ثم apply منفصل

الجرد والbackup المتحقق والبروفة المحلية إلزامية. نفس SQL sha على staging ثم الإنتاج، password داخل خدمة MySQL فقط، mysql connection واحد عبر SSH stdin. لا TCP proxy أو تعديل خدمة. staging UUID مختلف وإصدار9.7.2، إضافة فقط دون prod userdata. استخدم ملفات inventory/evidence الفعلية، لا تغير target فقط في command قديم:

```powershell
npx tsx scripts/apply-qud-catalog-railway.ts --target staging --inventory docs/data/d2-railway-staging-inventory.json --production-inventory docs/data/d2-railway-production-inventory.json --backup docs/data/d2-backup-verification.json --rehearsal docs/data/d2-local-rehearsal.json --dataset "$env:TEMP\ayahx-d2\dataset.json" --sql "$env:TEMP\ayahx-d2\d2-import.sql" --out docs/data/d2-staging-verification.json
```

هذا dry-run فقط. التنفيذ أمر مستقل يضيف `--apply`. replay staging فقط بـ`--replay-verified-staging` وبعد تطابق كل البيانات الفعلية قبل الكتابة. الإنتاج `--target production` وinventory الإنتاج ونفس الأدلة؛ التنفيذ يتطلب **--apply --confirm-production** صراحة. `--verify-only` قراءة فقط بعد التطبيق ولا يقبل معه apply. لا تطبيق تلقائي من npm start أو GitHub push.

الأسماء الأربع الجديدة يجب ألا تتصادم؛ critical counts وD1 counts/checksum/schema لا تتغير. `riwayat` استثناء metadata مصرح: INSERT ثلاث روايات غير حفص inactive، دون تعديل صف حفص أو النص. النشر يرفضه importer، وقيد DB يرفضه قبل مراجعة صوت البسملة بدليل/مرجع قانوني/offset وتوقيت معتمد؛ is_complete لا يصبح true بسبب NULL.

توقف عند critical count change، backup/rehearsal failure، table collision، new production log error، أو حاجة networking/config؛ لا تصحح production ارتجاليًا، ولا تعيد كتابة نتيجة تنفيذها غير مؤكدة. سجّل النتيجة وابدأ قراءة فقط لحسم الحالة.

## rollback

DDL في MySQL implicit commit. النسخة الحالية المشفرة المتحققة تبقى خارج Git/cloud؛ لا تمسحها أثناء rollback. البروفة تثبت هذه الخطوات على المحلي9.7.2 فقط، بترتيب FK:

```sql
DROP TABLE IF EXISTS recitation_chapters;
DROP TABLE IF EXISTS recitations;
DROP TABLE IF EXISTS audio_providers;
DROP TABLE IF EXISTS reciters;
```

لا drop/ALTER لأي جدول D1 أو جدول مستخدمين، ولا حذف صفوف riwayat القائمة؛ الثلاث الجديدة تبقى inactive ويمكن إعادة D2 idempotently. **SQL أعلاه غير مصرح بتنفيذه على Railway** ضمن تفويض root الحالي (CREATE/INSERT/READ فقط). rollback إنتاجي يحتاج قرارًا مستقلًا بعد الجرد والbackup؛ لا تجعله fallback عند غموض SSH.

## Git ومرحلة الربط

phase/d2-recitation-catalog من D1، PR مستقل دون merge. PR9 يظل draft. main Auto-deploy=true وPR deploys=false كما أثبت الجرد، ويعاد التحقق بعد PR. لا يستنتج green CI من غياب runs. قبل أي merge يحتاج المستخدم CI أخضر وخطة health/logs بعد النشر. الحالية maps/providers/render/font UI لا تتغير؛ الربط D7/D8 والأدمنA1 بتصريح لاحق. الخطوط الستة وقيد CDN الإنتاج في DECISIONS؛ لا ادعاء أن E2E D1 أثبت CDN الإنتاج.
