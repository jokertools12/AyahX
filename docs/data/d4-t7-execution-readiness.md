# K7 — جاهزية التنفيذ قبل GO

هذا تقرير إعداد offline بتاريخ 2026-10-10. لا قياس T7 فعلي ولا تنزيل صوت ولا كتابة DB. ينتظر قبول root لـK2–K4 وأمر GO الصريح؛ لا يقبل هذا التقرير المصادر نيابة عنه.

المحفوظ الخاص الحالي `%TEMP%/ayahx-d4-t7-selection-prepared.json`: 35 تلاوة (31 حدية و4 Drive)، و525 عينة ثابتة. بصمة الملف `c8c312564c3203c99d808508df8ea4f448e950ad93a39a06ad6bb69d4d26287a`، وselection SHA `3a730736876c66045219bb7bc761b7c8245c965659519b48213c0d2d6abe1df5`. فحص inventory فقط يعيد network_requests=0/audio_measurements=0/database_writes=0. لم يُستبدل الملف أو تعاد اختيار العينات. أي قفل نهائي بعد GO يحفظ IDs عيناته واستبعاد قياسات v1/B؛ لا تُعاد الاختيارات بعد رؤية نتائج.

أُصلح التقريب المؤثر في قرار NCC: القيمة الفعلية 0.949999996999995 تُعرض 0.95 لكنها تفشل حد 0.95 الخام. اختبار القياس المصطنع نفسه يثبت أن المسار القديم يمرّرها والمصحح يرفضها. مدة المقطع الكامل غير المقصوص تبقى أساس فرق المدة، وحدود NCC/lag/مدة/V2 لم تُخفّف.

نطاق hosts يصدره root من قاعدة الإنتاج بعد قبول K2؛ لا يستنتجه المستورد من URL. المصدر الحقيقي `audio_providers.host_allowlist` مرتبط بـ`recitations.provider_id`. مثال قراءة root فقط:

```sql
SELECT JSON_OBJECT('recitationSlug', r.slug, 'allowedHosts', p.host_allowlist) AS record
FROM recitations r JOIN audio_providers p ON p.id = r.provider_id
ORDER BY r.slug;
```

ملف inventory خاص يكون JSON array لتلك الكائنات، أو `{ "records": [...] }`؛ لا أسرار أو روابط موقعة فيه. `prepare_t7_host_snapshot.py` يراجع بصمتي inventory/manifest، ويحتفظ بتلاوات manifest فقط، ويرفض الغياب والتكرار وأي host غير مسموح. ينتج snapshot حتميًا `{slug: [hosts]}` بأسماء دقيقة و`*.us.archive.org` وحده؛ لا `*.archive.org` ولا توسعة إلى نطاقات Canada غير المقيدة صراحة. الملف لا يُكتب فوق قفل مختلف موجود. لم ينشأ snapshot حقيقي بعد.

تحقق النقل قبل كل قفزة: HTTPS، وDNS/IP عام مُثبت للاتصال، وhost allowlist، بحد 5 redirects، وعدم مفاتيح signature/token/credential/expires/`sig`/`api_key` للمصدر الإنتاجي. يسمح التوقيع المؤقت لـHF في نطاق التدقيق فقط. فاصل HF الأدنى 2s ونوافذ 500≥30min، دون retry متسارع؛ Drive بمحاولة واحدة للملف، و5s بين تلاواته و80KiB/s. أي سبب «مصدر غير متاح» يبقى كما هو، ولا يستبدل بمصدر آخر.

وجد فحص runtime أن `%TEMP%/ayahx-d1-python/duckdb` namespace غير مكتمل: `__file__=None` و`connect=False`، و`PackageNotFoundError` لـmetadata. لم يُحذف أو يغيّر. ثبتت نسخة تشخيصية 1.4.3 في مسار خاص جديد ونجح connect، ثم كشف فحص cache أن امتداد httpfs السابق مثبت لـv1.5.6. لذلك النسخة المعتمدة للتنفيذ `duckdb==1.5.6`، wheel من pip cache، في `%TEMP%/ayahx-d4-duckdb-1.5.6`؛ القديم والمسار التشخيصي محفوظان. بلا تغيير requirements/package-lock. نجاح offline فعلي: version+distribution=1.5.6، وconnect/SELECT42، وLOAD httpfs المثبت مع autoinstall/autoload معطلين، ثم SET threads=1/http_retries=0/http_timeout=120؛ امتداد httpfs loaded=true/installed=true. NumPy 2.5.3 وSciPy 1.18.1. لا طلب شبكة خلال التحقق.

أمر الإعداد بعد GO وبعد استلام inventory وقفل manifest النهائي من root:

```powershell
$python = 'C:/Users/cpazi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:OPENBLAS_NUM_THREADS = '1'
$env:PYTHONPATH = "$env:TEMP/ayahx-d4-duckdb-1.5.6;$env:TEMP/ayahx-d2-python;$env:TEMP/ayahx-d1-python;$env:TEMP/ayahx-d3-python"
& $python scripts/prepare_t7_host_snapshot.py --manifest $manifest --manifest-sha $manifestSha --provider-inventory $inventory --provider-inventory-sha $inventorySha --out $hostSnapshot
& $python scripts/execute_qud_t7.py --manifest $manifest --manifest-sha $manifestSha --source-hosts $hostSnapshot --source-hosts-sha $hostsSha --scratch $privateNewScratch --checkpoints $privateNewCheckpoints --ffmpeg 'C:/Users/cpazi/Downloads/ayahX/node_modules/ffmpeg-static/ffmpeg.exe' --execute --approved-k2-k4
```

المتغيرات أعلاه placeholders لبصمات وملفات root الفعلية؛ ليست تفويضًا بالتنفيذ. HF index الخاص الاختياري يحتاج `--hf-manifest` وبصمته الصريحة معًا. checkpoint يرتبط ببصمات manifest file/selection/hosts/ffmpeg/calculator، ويكتب append-only/fsync؛ اختلافها يوقف الاستئناف ولا يمحو سابقًا. القيم الخام لا تُستبدل بعرض مقرب. خارج Git كل source audio/checkpoints/URLs موقعة؛ root وحده ينشر ملخصًا منقحًا بعد المراجعة.

نتيجة الاختبارات offline: 25 executor +11 preparer +3 hosts +12 K4=51 نجاحًا. المتبقي: اعتماد K2–K4، وقفل root النهائي وhost snapshot الحقيقي، ثم GO وT7 الفعلي. لا نتيجة نجاح لتلاوة تستنتج من نجاح هذه الاختبارات.
