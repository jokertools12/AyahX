# تقرير المرحلة D3 — استئناف إغلاق استيراد التوقيتات

الحالة الحالية: **بيانات D3 متحققة على production؛ إغلاق النشر وCI ما زال معلقًا، لا D4 أو A1.**

## 1. ما الذي تغيّر

المستورد الأساسي `scripts/import-qud-timings.ts` وخدمته CLI مستقلان عن Redis/BullMQ، ويستخدمان checkpoints ذرية والتحقق من القيم الفعلية قبل تخطيها. production يستقبل SQL حتميًا عبر جلسات Railway SSH متتابعة واتصال MySQL واحد في كل جلسة، بضغط gzip ودفعات 250 صفًا وهامش packet وفحص الاتصالات والمساحة قبل كل كتابة. source_offset_ms يبقى NULL؛ الإحداثيات source_ms دون تحويل، ولا تغيير واجهة أو ريندر أو نشر تلاوات.

migration003 تنشئ ayah_timings وimport_jobs وayah_timing_history فقط، وتضيف coverage_words وexpected_words وcoverage_details إلى recitation_chapters كأعمدة nullable. لا FKs إلى الجداول القائمة. spoken_text بـutf8mb4_bin، والحقول الوصفية بـutf8mb4_unicode_ci. down مقيد بالبروفة المحلية؛ لم ينفذ DROP أو اختبار هدم على production.

أُلغي جدول quran_storage_health وجامعه، وجدول quran_timing_audit_fixtures. البديل عند الطلب في health/ready: مجموع DATA_LENGTH+INDEX_LENGTH لجميع الجداول، مع فصل الأساسية عن D3 دون احتساب مزدوج، مقابل STORAGE_VOLUME_BYTES=5000000000؛ كاش خمس دقائق وتحذير تحت 20% دون إسقاط الجاهزية، وunavailable للقياس أو الإعداد الغائب. هذا تقدير تخصيص جداول يستثني undo/redo/binlog وملفات filesystem، وليس df.

ضُبط المتغير غير السري على خدمة AyahX في production مع skipDeploys=true، وتحقق بالقراءة. staging بقيت متوقفة، مع حفظ الخدمات والـ volumes وإعدادات الرجوع؛ لا تخفيضات إضافية ولا تغيير موارد production. حُدثت بنود D3 في خطة البيانات لتطابق قرارات CLI والسعة الأحدث.

## 2. ما الذي تحققت منه فعليًا

### البروفة الحقيقية على MySQL 9.7.2

استُخدمت النسخة المنطقية المشفرة المتحققة باستعادة 51 جدولًا ومطابقة COUNT/CHECKSUM. قبل الكتابة بقيت أعداد الجداول الحرجة وبصمتا users/user_roles مطابقة للنسخة، وعمر النسخة أقل من 24 ساعة. لا snapshot؛ رفض Pro السابق ما زال ساريًا، ولم تُنشأ نسخة snapshot جديدة. لا حذف محلي أو بدائل لتنظيف الملفات المرفوض سابقًا.

| القبول | النتيجة الفعلية | الدليل |
|---|---|---|
| أ: كامل مرتين | 69 تلاوة و422,463 صفًا؛ الثانية تحققت من جميع القيم ثم تخطت 69 checkpoint؛ CHECKSUM متطابق حتى الطوابع الزمنية | d3-close-cli-reapplied.json، d3-close-cli-second-final.json، d3-close-final-idempotence.json |
| ب: قتل واستئناف | SIGKILL الفعلي على Windows عبر TerminateProcess بعد commit/checkpoint250 في منتصف تلاوة؛ readback=250، والاستئناف يطابق بصمات خمس جداول للتشغيل غير المقطوع | d3-close-local-acceptance.json، d3-close-cli-resumed.json |
| ج: فساد فعلي | end_ms+1 مع بقاء version_hash؛ رفض STORED_TIMING_MISMATCH، وسجل snapshot في history بسبب CHECKPOINT_STORED_VALUE_MISMATCH؛ لا إصلاح صامت. التصحيح المحلي الصريح ثم الاستئناف نجح | d3-close-cli-corruption.json، d3-close-cli-corruption-restored.json، d3-close-local-acceptance.json |
| د: down وإعادة | حذف الجداول الثلاثة والأعمدة الثلاثة محليًا، ثم استيراد كامل يعيد نفس البصمات | d3-close-local-acceptance.json |
| هـ: فهرس | EXPLAIN يختار uk_timing_ayah لاستعلام تلاوة/سورة/مدى 1–20؛ 20 صفًا في 10.1273ms | d3-close-local-acceptance.json |
| و: الأعداد | 422,463 صفًا؛ كل تلاوة تطابق التحضير؛ صفر مخالفات coverage_words+missing_words=expected_words، وكل ID قانوني مغطى أو مفقود بسبب موثق | d3-close-local-acceptance.json |

بصمات الحالة تستثني created_at/updated_at عند مقارنة التشغيل المقتول بغير المقتول، وتحفظ جميع الأعمدة الدلالية. الاختبار الإضافي الثاني بعد إعادة التطبيق قارن CHECKSUM كاملة، بما فيها الطوابع الزمنية، ولم تتغير. حدث فشل واحد في guard جديد كان يحسب null للكلمات المنطوقة غير المربوطة كـID قانوني؛ صُحح بإقصاء null من مجموعة المغطى، واختبر بانحدار وبإعادة التطبيق الكاملة. لم تتغير المدخلات المثبتة أو التوقيتات.

المصالحة المستقلة لكل 7,765 تلاوة×سورة أثبتت صفر مخالفات. الاستعلام الشامل الأول اكتمل بصفر مخالفات لكنه كان بطيئًا؛ استبدل بجمع مستقل ومقارنة القيم، مع قراءة PRIMARY متتابعة للمجاميع بدل وصول secondary عشوائي لصفوف JSON. البروبة الأخيرة تحققت كذلك من جميع أعداد ready/needs_review وأسبابها في 58.8s؛ استعلام الملخص 19.34s. هذه أزمنة الجرد الكامل، وليست زمن استعلام مدى الآيات البالغ 10.1273ms.

### تشخيص BullMQ المحدود

نجحت محاولة واحدة كاملة على Redis 7.2.14 الحقيقي وMySQL9.7.2: 69 تلاوة، دون stalled أو lockRenewalFailed أو WorkerError؛ 753 تجديد قفل موثق. lockDuration=120000ms وlockRenewTime=1000ms، دون تغيير maxStalledCount. البناء والاستيراد الثقيل في child process، والطابور منفصل لـA3 ولا يشغل عاملًا على production.

| القياس | p50 ms | p99 ms | max ms |
|---|---:|---:|---:|
| CLI المحلي الأول | 13.869055 | 441.974783 | 639.631359 |
| حلقة عامل الطابور | 14.123007 | 35.028991 | 145.358847 |

زمن تشخيص الطابور الكامل 496,766ms. التجديد القصير 1s في التشخيص يثبت التجديد حتى للوظائف القصيرة؛ القفل الطبيعي120s. السبب السابق لقفل2s يظل فرضية مرجحة، وليس إثباتًا سببيًا بالقياسات الجديدة. الدليل: d3-close-queue-proof.json. القفل القصير لا يستخدم في مستورد الإنتاج؛ اختبار القتل منفصل.

### المصدر والعيوب والتغطية

المصدر QUD Release v3.2.0 فقط، manifestSHA=bde8378c423c5e6b30fbc73c42663cce299f2ca4e8bd9f2f4b258ed9467645cf. سبعة صفوف HF في docs/data/d1-defective-timing-rows.json أعيدت مطابقتها مع ملفات dataset الحقيقية المحفوظة؛ config خارج catalog المثبت، فلا تُزرع في production. fixtures الوحدات واختبارات golden الخمسة من قسم6 نجحت على المدخلات الحقيقية. الدليل d3-close-defective-fixtures-check.json.

التكرار canonical، والنص المنطوق منفصل عن النص القانوني، وفشل word diff يعطل تظليل الكلمات ويبقي needs_review. غير حفص لا يستعير مرجع حفص ولا spoken_text؛ expected_words=NULL عند غياب المرجع القانوني. لا تعديل للنص القانوني ولا علاج صامت أو تغيير قاعدة100%.

### السعة والنقل والميزانية

JSON_STORAGE_SIZE مع الحقول الأخرى المقاسة: 645,389,632 bytes؛ مع50%=968,084,448. الحجم المحلي الفعلي لجداول التوقيت أكبر:1,315,176,448، لذا رفع احتياط السعة والتكلفة إليه. كلاهما أقل من60% من4,350,103,552 bytes الحرة قبل الإنتاج، أي2,610,062,131.2. لا تغيير حد الإنفاق؛ hard30$/soft20$ مثبتان. البداية17.849900938462714$؛ التقدير الهامشي المحافظ1.01949868992$، والمتبقي بعده11.130600371617286$، فوق3$. الدليل d3-close-preflight.json.

تلاوة البداية ahmed_saud_mp3quran:327 صفًا وبصمة8dd4e1f…e8d3136،5,649ms للاستيراد والتحقق و12,285ms للCLI كاملة. gzip:655,372 SQLbytes إلى110,246 framed payloadbytes في837ms ACK، أي131,715.65 bytes/s كسرعة فعالة تشمل التنفيذ؛ ليست egress فاتورة. التقدير المحافظ لجميع التلاوات2.238h، أقل من4h. حافظت مصالحة ما بعد البداية علىD1 وبصمتي الأدمن. fullSQLSHA=bddda76d806308dc9a8b21f83e0801a3ff4be5489e52b272121e999717aa0d0e، مطابق لإعادة التطبيق المحلية. الدليل d3-close-transfer-estimate.json وd3-close-pilot-verification.json.

الأرقام النهائية والفروق وحدود نسب التكلفة موجودة أدناه.


<!-- D3_PRODUCTION_PROOF_START -->
### نتيجة production النهائية — قراءة فقط

422,463 صفًا في 69 تلاوة؛ ready=321,473 وneeds_review=100,990. كل أعداد وبصمات التلاوات تطابق التشغيل المحلي. D1=114/6236/77433 والبصمة القانونية eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4. أعداد الحرجة وبصمتا users/user_roles لم تتغير؛ حسابات الأدمن لم تُمس. الأعمدة الجديدة nullable وcollation صحيح، والجداول الملغاة غير موجودة. صفر مخالفات حساب الكلمات والتظليل والمرجع غير القانوني؛ 7765 فصلًا فُحصت بمصالحة مستقلة وصفر أخطاء تغطية. بصمات الحالة الدلالية للجداول الخمسة تطابق البروفة، مع استثناء الطوابع الزمنية المتغيرة فقط. [الدليل الكامل](d3-close-production-after.json)، [بصمات التلاوات](d3-close-production-recitation-proof.json).

انتهى الأمر الأول الكامل برمز خروج 1. آخر تقريره حفظ 38 تلاوة؛ المصالحة المستقلة وجدت 39 تلاوة و235,530 صفًا ملتزمًا، وتحققت من آخر تلاوة فعليًا. سبب الخطأ الأصلي لم يُحفظ بالكامل بسبب فشل مسار الإغلاق؛ لا يُنسب إلى عطل شبكة أو حد اتصالات دون دليل. حُفظ التقرير القديم، وأصلح حفظ الفشل قبل الإغلاق. استؤنف العمل بجلسات قصيرة متتابعة: dry-run محلي مستقل وSHA مطابق قبل كل apply، وCLOSE/COMMIT وSSH exit=0 قبل التالية. التلاوة 39 تخطت 6,236 صفًا بعد تحقق القيم. لا تخفيف للguards أو إعادة كتابة صامتة. الأدلة: [التقرير القديم](d3-close-production-import-interrupted.json)، [المصالحة](d3-close-production-interruption-readonly.json)، [تشخيص الاتصالات](d3-close-interruption-diagnosis.json)، [الاستئناف](d3-close-production-resumed.json).

الزمن الفعلي من بداية الاستيراد الكامل إلى انتهاء الاستئناف 80.583 دقيقة (يشمل الانقطاع والتشخيص وdry-run الجلسات). مجموع زمن تنفيذ التلاوات المحفوظ 46.683 دقيقة؛ لا يتضمن زمن التلاوة 39 في الأمر الأول لأنه لم يُحفظ. التقدير من البداية كان 2.238h. 31 جلسة استئناف موثقة تمت بموافقة SHA محلية مستقلة، ودفعات 250 دون تجاوز packet/الاتصالات.

| قياس المساحة بالبايت | قبل | بعد |
|---|---:|---:|
| df الحجم الحقيقي | 4,685,873,152 | 4,685,873,152 |
| df المستخدم | 325,705,728 | 1,666,068,480 |
| df المتاح | 4,350,103,552 | 3,009,740,800 |

| جدول D3 | DATA_LENGTH | INDEX_LENGTH | ملف ibd الفعلي المخصص |
|---|---:|---:|---:|
| ayah_timing_history | 16,384 | 16,384 | 131,072 |
| ayah_timings | 1,241,235,456 | 73,924,608 | 1,337,987,072 |
| import_jobs | 49,152 | 16,384 | 147,456 |

مجموع الملفات المخصصة للجداول الثلاثة 1,338,265,600 bytes، ونمو df المستخدم 1,340,362,752 bytes. بسعر المستخدم 0.15$/GB-month، أثر هذا النمو النظري 0.201054$/شهر، وليس بندًا مفوترًا منفصلًا. حجم volume المضبوط 5000MB؛ df أقل بسبب نظام الملفات. log_bin معطل؛ لم يُنفذ PURGE أو SET PERSIST، وأثر تنظيف binlog صفر. [df/du/stat](d3-close-capacity-after.json).

قياس الفاتورة النهائي مؤجل إلى نهاية قبول النشر؛ لا يُنسب فرق workspace إلى D3 وحده.

النشر وCI والدمج وsmoke ولوج عشر دقائق لم تُقبل بعد؛ بيانات الإنتاج وحدها لا تغلق D3.

### جدول كل التلاوات والتغطية

الفصول المكتملة من 114، مع بقاء قاعدة 100%؛ abdulaziz_al_turki_yt: 112 متاحة في catalog و2 غير متاحة؛ ahmed_saud_mp3quran: 30 متاحة في catalog و84 غير متاحة؛ ahmed_talib_bin_humaid_mp3quran: 107 متاحة في catalog و7 غير متاحة؛ islam_sobhi_mp3quran: 106 متاحة في catalog و8 غير متاحة. لا تُختلق صفوف الفصول غير المتاحة. timing_complete=3,044 وis_complete=3,043؛ الفرق فصل عند islam_sobhi خاضع لحارس ayahs_complete القائم في D2، رغم اكتمال الكلمات. [سبب الفصل](d3-close-chapter-gate-explanation.json). «غير متاح» لمرجع غير حفص لا يعني صفر كلمات ناقصة. أسباب المراجعة غير حصرية؛ الصف الواحد قد يحمل عدة أسباب. ready هنا حالة صف توقيت، وليست إذن نشر تلاوة. جميع التلاوات غير منشورة والبسملة الصوتية unverified. سبعة عيوب HF خارج Release لم تدخل production؛ عيوب Release الفعلية بقيت needs_review وأسبابها في [القراءة النهائية](d3-close-production-after.json).

| التلاوة | الرواية | صفوف | ready | needs_review | فصول مكتملة | فصول تنقص 1–3 كلمات | كلمات موقّتة / قانونية | أكثر أسباب النقص/المراجعة |
|---|---|---:|---:|---:|---:|---:|---|---|
| abdul_hamid_ghraio_2025_yt | hafs_an_asim | 6,236 | 6,071 | 165 | 66/114 | 12 | 76,981 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 163<br>WORD_DIFF_UNMAPPED: 14<br>INVALID_WORD_INTERVAL: 2 |
| abdul_hamid_ghraio_2026_yt | hafs_an_asim | 6,236 | 6,080 | 156 | 62/114 | 11 | 76,985 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 155<br>WORD_DIFF_UNMAPPED: 15<br>MISSING_SOURCE_AYAH: 1 |
| abdulaziz_al_turki_yt | hafs_an_asim | 6,115 | 5,686 | 429 | 57/114 | 6 | 74,609 / 76,082 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 429<br>WORD_DIFF_UNMAPPED: 33 |
| abdulbasit_abdulsamad_mujawwad_tarteel | hafs_an_asim | 6,236 | 5,629 | 607 | 51/114 | 5 | 74,526 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 606<br>WORD_DIFF_UNMAPPED: 56<br>INVALID_WORD_INTERVAL: 1 |
| abdulbasit_abdulsamad_tarteel | hafs_an_asim | 6,236 | 5,828 | 408 | 57/114 | 4 | 75,534 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 407<br>WORD_DIFF_UNMAPPED: 27<br>INVALID_WORD_INTERVAL: 1 |
| abdulbasit_abdulsamad_warsh_qdc | warsh_an_nafi | 6,214 | 0 | 6,214 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_WORD_COUNT_MISMATCH: 6,214 |
| abdullah_al_buaijan_2025_yt | hafs_an_asim | 6,236 | 6,168 | 68 | 90/114 | 11 | 77,211 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 68<br>WORD_DIFF_UNMAPPED: 4<br>MISSING_SOURCE_AYAH: 1 |
| abdullah_al_mattrod_qdc | hafs_an_asim | 6,236 | 5,898 | 338 | 58/114 | 11 | 76,355 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 336<br>WORD_DIFF_UNMAPPED: 19<br>INVALID_WORD_INTERVAL: 2 |
| abdullah_al_qarafi_mp3quran | hafs_an_asim | 6,236 | 5,765 | 471 | 46/114 | 7 | 75,662 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 470<br>WORD_DIFF_UNMAPPED: 16<br>MISSING_SOURCE_AYAH: 13 |
| abdullah_kamel_way2quran | hafs_an_asim | 6,236 | 4,515 | 1,721 | 35/114 | 6 | 71,790 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,654<br>WORD_DIFF_UNMAPPED: 196<br>INVALID_WORD_INTERVAL: 109 |
| abdulwadood_haneef_mp3quran | hafs_an_asim | 6,236 | 5,511 | 725 | 51/114 | 7 | 75,427 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 719<br>WORD_DIFF_UNMAPPED: 52<br>INVALID_WORD_INTERVAL: 10 |
| abdur_rashid_sufi_qdc | hafs_an_asim | 6,236 | 5,995 | 241 | 62/114 | 7 | 76,426 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 240<br>WORD_DIFF_UNMAPPED: 20<br>INVALID_WORD_INTERVAL: 1 |
| abdur_rashid_sufi_shubah_qdc | shubah_an_asim | 6,236 | 0 | 6,236 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,236<br>SPOKEN_TEXT_UNAVAILABLE: 6,236<br>SPOKEN_WORD_COUNT_MISMATCH: 6,236 |
| abu_bakr_al_shatri_tarteel | hafs_an_asim | 6,236 | 4,379 | 1,857 | 34/114 | 8 | 73,004 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,853<br>WORD_DIFF_UNMAPPED: 123<br>INVALID_WORD_INTERVAL: 7 |
| adel_al_karbalaei_archive_v2 | hafs_an_asim | 6,236 | 6,052 | 184 | 60/114 | 15 | 76,815 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 182<br>WORD_DIFF_UNMAPPED: 10<br>INVALID_WORD_INTERVAL: 2 |
| ahmad_naseem_ali_ahmad_2019_yt | hafs_an_asim | 6,236 | 5,481 | 755 | 50/114 | 7 | 74,540 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 755<br>WORD_DIFF_UNMAPPED: 53 |
| ahmed_al_ajmi_qdc | hafs_an_asim | 6,236 | 4,780 | 1,456 | 32/114 | 13 | 73,104 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,455<br>WORD_DIFF_UNMAPPED: 108<br>INVALID_WORD_INTERVAL: 2 |
| ahmed_amer_tvquran | hafs_an_asim | 6,236 | 5,893 | 343 | 56/114 | 4 | 75,913 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 342<br>WORD_DIFF_UNMAPPED: 26<br>INVALID_WORD_INTERVAL: 1 |
| ahmed_deban_qalon_mp3quran | qalon_an_nafi | 6,214 | 0 | 6,214 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_WORD_COUNT_MISMATCH: 6,214 |
| ahmed_issa_al_maasaraawi_mp3quran | hafs_an_asim | 6,236 | 5,971 | 265 | 63/114 | 8 | 76,514 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 260<br>WORD_DIFF_UNMAPPED: 23<br>INVALID_WORD_INTERVAL: 5 |
| ahmed_kaseb_way2quran | hafs_an_asim | 6,236 | 5,925 | 311 | 53/114 | 9 | 76,565 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 309<br>WORD_DIFF_UNMAPPED: 23<br>INVALID_WORD_INTERVAL: 2 |
| ahmed_nuayna_qdc | hafs_an_asim | 6,236 | 6,015 | 221 | 57/114 | 5 | 76,586 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 162<br>WORD_DIFF_UNMAPPED: 73<br>INVALID_WORD_INTERVAL: 59 |
| ahmed_saleh_rajab_qalon_way2quran | qalon_an_nafi | 6,213 | 0 | 6,213 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,213<br>SPOKEN_TEXT_UNAVAILABLE: 6,213<br>SPOKEN_WORD_COUNT_MISMATCH: 6,213 |
| ahmed_saud_mp3quran | hafs_an_asim | 327 | 325 | 2 | 28/114 | 2 | 1,359 / 1,363 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 2 |
| ahmed_shaheen_mp3quran | hafs_an_asim | 6,236 | 5,503 | 733 | 51/114 | 5 | 74,698 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 730<br>WORD_DIFF_UNMAPPED: 48<br>INVALID_WORD_INTERVAL: 3 |
| ahmed_talib_bin_humaid_mp3quran | hafs_an_asim | 5,561 | 4,951 | 610 | 42/114 | 10 | 65,329 / 67,052 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 601<br>WORD_DIFF_UNMAPPED: 47<br>INVALID_WORD_INTERVAL: 11 |
| akram_al_alaqmi_qdc | hafs_an_asim | 6,236 | 5,233 | 1,003 | 39/114 | 7 | 73,973 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,002<br>WORD_DIFF_UNMAPPED: 69<br>INVALID_WORD_INTERVAL: 1 |
| ali_al_huthaifi_mp3quran | hafs_an_asim | 6,236 | 5,301 | 935 | 49/114 | 3 | 74,013 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 935<br>WORD_DIFF_UNMAPPED: 68 |
| ayman_swed_muallim_yt | hafs_an_asim | 6,236 | 4,881 | 1,355 | 42/114 | 6 | 72,807 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,339<br>WORD_DIFF_UNMAPPED: 102<br>INVALID_WORD_INTERVAL: 20 |
| badr_al_turki_yt | hafs_an_asim | 6,236 | 5,589 | 647 | 50/114 | 6 | 74,786 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 646<br>WORD_DIFF_UNMAPPED: 51<br>INVALID_WORD_INTERVAL: 1 |
| bandar_baleela_qdc | hafs_an_asim | 6,236 | 5,284 | 952 | 42/114 | 9 | 74,382 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 939<br>WORD_DIFF_UNMAPPED: 70<br>INVALID_WORD_INTERVAL: 23 |
| fatih_seferagic_way2quran | hafs_an_asim | 6,236 | 6,167 | 69 | 83/114 | 18 | 77,216 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 66<br>WORD_DIFF_UNMAPPED: 11<br>INVALID_WORD_INTERVAL: 5 |
| haitham_al_dukhain_mp3quran | hafs_an_asim | 6,236 | 5,122 | 1,114 | 43/114 | 14 | 73,893 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,112<br>WORD_DIFF_UNMAPPED: 73<br>INVALID_WORD_INTERVAL: 3 |
| hani_al_rifai_qdc_128k | hafs_an_asim | 6,236 | 5,695 | 541 | 46/114 | 13 | 76,067 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 531<br>WORD_DIFF_UNMAPPED: 31<br>INVALID_WORD_INTERVAL: 10 |
| ibrahim_al_akhdar_drive | hafs_an_asim | 6,236 | 6,106 | 130 | 78/114 | 6 | 76,995 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 130<br>WORD_DIFF_UNMAPPED: 13 |
| imad_zuhair_hafez_mp3quran | hafs_an_asim | 6,236 | 5,655 | 581 | 52/114 | 3 | 74,998 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 581<br>WORD_DIFF_UNMAPPED: 38 |
| islam_sobhi_mp3quran | hafs_an_asim | 5,334 | 4,683 | 651 | 44/114 | 10 | 61,761 / 63,841 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 647<br>WORD_DIFF_UNMAPPED: 30<br>INVALID_WORD_INTERVAL: 4 |
| khalid_al_mohana_drive | hafs_an_asim | 6,236 | 5,973 | 263 | 69/114 | 4 | 76,377 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 262<br>WORD_DIFF_UNMAPPED: 18<br>INVALID_WORD_INTERVAL: 1 |
| khalifa_al_tunaiji_tarteel | hafs_an_asim | 6,236 | 5,922 | 314 | 59/114 | 3 | 76,254 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 314<br>WORD_DIFF_UNMAPPED: 17 |
| maher_al_muaiqly_qdc | hafs_an_asim | 6,236 | 5,910 | 326 | 59/114 | 2 | 75,957 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 326<br>WORD_DIFF_UNMAPPED: 16 |
| mahmoud_abdul_hakam_mp3quran | hafs_an_asim | 6,236 | 5,660 | 576 | 49/114 | 6 | 74,973 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 576<br>WORD_DIFF_UNMAPPED: 42 |
| mahmoud_ali_al_banna_qdc | hafs_an_asim | 6,236 | 5,815 | 421 | 56/114 | 4 | 75,656 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 420<br>WORD_DIFF_UNMAPPED: 31<br>INVALID_WORD_INTERVAL: 1 |
| mahmoud_khalil_al_husary_mp3quran | hafs_an_asim | 6,236 | 5,907 | 329 | 60/114 | 5 | 76,107 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 328<br>WORD_DIFF_UNMAPPED: 18<br>INVALID_WORD_INTERVAL: 1 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | hafs_an_asim | 6,236 | 5,656 | 580 | 55/114 | 5 | 75,095 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 580<br>WORD_DIFF_UNMAPPED: 41<br>MISSING_SOURCE_AYAH: 1 |
| mahmoud_khalil_al_husary_qdc_128k | hafs_an_asim | 6,236 | 5,929 | 307 | 64/114 | 3 | 75,839 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 307<br>WORD_DIFF_UNMAPPED: 35 |
| mishary_rashid_al_afasy_2008_qdc | hafs_an_asim | 6,236 | 5,291 | 945 | 47/114 | 4 | 74,622 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 944<br>WORD_DIFF_UNMAPPED: 47<br>INVALID_WORD_INTERVAL: 1 |
| mishary_rashid_al_afasy_mp3quran | hafs_an_asim | 6,236 | 5,404 | 832 | 53/114 | 5 | 74,969 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 831<br>WORD_DIFF_UNMAPPED: 52<br>INVALID_WORD_INTERVAL: 1 |
| moaz_mahmoud_hamed_qalon_way2quran | qalon_an_nafi | 6,177 | 0 | 6,177 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,177<br>SPOKEN_TEXT_UNAVAILABLE: 6,177<br>SPOKEN_WORD_COUNT_MISMATCH: 6,177 |
| mohammed_abdulkareem_qdc | hafs_an_asim | 6,236 | 4,952 | 1,284 | 35/114 | 12 | 73,300 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,276<br>WORD_DIFF_UNMAPPED: 67<br>INVALID_WORD_INTERVAL: 11 |
| mohammed_al_luhaidan_mp3quran | hafs_an_asim | 6,236 | 5,096 | 1,140 | 44/114 | 9 | 74,389 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,139<br>WORD_DIFF_UNMAPPED: 64<br>MISSING_SOURCE_AYAH: 2 |
| mohammed_alghazali_archive | hafs_an_asim | 6,236 | 5,119 | 1,117 | 38/114 | 8 | 73,766 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,117<br>WORD_DIFF_UNMAPPED: 57<br>INVALID_WORD_INTERVAL: 1 |
| mohammed_ayyub_drive | hafs_an_asim | 6,236 | 5,539 | 697 | 51/114 | 6 | 74,229 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 697<br>WORD_DIFF_UNMAPPED: 48 |
| mohammed_burhaji_yt | hafs_an_asim | 6,236 | 5,163 | 1,073 | 46/114 | 6 | 74,699 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,068<br>WORD_DIFF_UNMAPPED: 67<br>INVALID_WORD_INTERVAL: 10 |
| mohammed_saayed_warsh_mp3quran | warsh_an_nafi | 6,214 | 0 | 6,214 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_WORD_COUNT_MISMATCH: 6,214 |
| mohammed_siddiq_al_minshawi_1967_drive | hafs_an_asim | 6,236 | 5,689 | 547 | 52/114 | 5 | 75,222 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 546<br>WORD_DIFF_UNMAPPED: 45<br>INVALID_WORD_INTERVAL: 1 |
| mohammed_siddiq_al_minshawi_mp3quran | hafs_an_asim | 6,236 | 5,766 | 470 | 54/114 | 4 | 75,510 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 469<br>WORD_DIFF_UNMAPPED: 34<br>INVALID_WORD_INTERVAL: 1 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | hafs_an_asim | 6,236 | 5,281 | 955 | 43/114 | 3 | 73,501 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 903<br>WORD_DIFF_UNMAPPED: 124<br>INVALID_WORD_INTERVAL: 60 |
| muammar_zainal_al_sukaini_way2quran | hafs_an_asim | 6,236 | 5,806 | 430 | 59/114 | 4 | 75,660 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 427<br>WORD_DIFF_UNMAPPED: 33<br>MISSING_SOURCE_AYAH: 7 |
| mustafa_ismail_mp3quran | hafs_an_asim | 6,236 | 5,922 | 314 | 62/114 | 4 | 76,001 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 313<br>WORD_DIFF_UNMAPPED: 21<br>INVALID_WORD_INTERVAL: 1 |
| nasser_al_qatami_mp3quran | hafs_an_asim | 6,236 | 4,518 | 1,718 | 30/114 | 9 | 72,390 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,699<br>WORD_DIFF_UNMAPPED: 125<br>INVALID_WORD_INTERVAL: 28 |
| saad_al_ghamdi_tarteel | hafs_an_asim | 6,236 | 5,481 | 755 | 47/114 | 5 | 75,006 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 753<br>WORD_DIFF_UNMAPPED: 55<br>INVALID_WORD_INTERVAL: 2 |
| saber_abdulhakam_qalon_way2quran | qalon_an_nafi | 6,214 | 0 | 6,214 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_WORD_COUNT_MISMATCH: 6,214 |
| saber_abdulhakam_shubah_way2quran | shubah_an_asim | 6,236 | 0 | 6,236 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,236<br>SPOKEN_TEXT_UNAVAILABLE: 6,236<br>SPOKEN_WORD_COUNT_MISMATCH: 6,236 |
| saber_abdulhakam_warsh_way2quran | warsh_an_nafi | 6,214 | 0 | 6,214 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_WORD_COUNT_MISMATCH: 6,214 |
| saber_abdulhakam_yt | hafs_an_asim | 6,236 | 5,630 | 606 | 52/114 | 6 | 75,267 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 606<br>WORD_DIFF_UNMAPPED: 38 |
| saud_al_shuraim_mp3quran | hafs_an_asim | 6,236 | 5,794 | 442 | 55/114 | 12 | 75,932 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 438<br>WORD_DIFF_UNMAPPED: 33<br>INVALID_WORD_INTERVAL: 4 |
| walid_al_naihi_qalon_mp3quran | qalon_an_nafi | 6,214 | 0 | 6,214 | 0/114 | غير متاح | 0 / مرجع غير متاح | CANONICAL_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_TEXT_UNAVAILABLE: 6,214<br>SPOKEN_WORD_COUNT_MISMATCH: 6,214 |
| walid_atef_way2quran | hafs_an_asim | 6,236 | 4,965 | 1,271 | 37/114 | 6 | 72,980 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,270<br>WORD_DIFF_UNMAPPED: 76<br>MISSING_SOURCE_AYAH: 1 |
| yasser_al_dosari_archive | hafs_an_asim | 6,236 | 5,148 | 1,088 | 38/114 | 7 | 73,928 / 77,433 | CANONICAL_WORD_COVERAGE_INCOMPLETE: 1,083<br>WORD_DIFF_UNMAPPED: 62<br>INVALID_WORD_INTERVAL: 7 |
<!-- D3_PRODUCTION_PROOF_END -->

## 3. نتائج الاختبارات

npm test على المدخلات الحقيقية:500 اختبار،494 ناجحة/6 متخطاة/0 فشل. الستة المتخطاة اختبارات queue شرطية موجودة سابقًا؛ قبولD3 والطابور الحقيقيان أعلاه مستقلان. npx tsc --noEmit، strict للملفات الجديدة، وnpm run build ناجحة. lint لكل الملفات المتغيرة:0 أخطاء و0 رسائل جديدة؛ تحذيرا server/index.ts القديمان باقيان دون تغيير. لم يُصلح lint العام.

الأدلة: d3-close-quality-final.json، d3-close-tests-final.json، d3-close-lint-final.json؛ 29 ملفًا وفحص strict إضافي للسكربتات والخدمات. لا تُعامل mocks الوحدات كقبول MySQL/Railway.

## 4. ما لم يكتمل أو يحتاج قرارًا، وسببه

اكتمل استيراد production والتحقق النهائي؛ CI والدمج والنشر وsmoke/لوج عشر دقائق ما زالت معلقة، ولا إعلان إغلاق D3 قبلها. لا تلاوات منشورة ضمن هذه المرحلة. البسملة الصوتية تبقىunverified، وسياسات offset لا تُخفف. عيوب المصدر/غياب مرجع غير حفص تبقى needs_review؛ لا تُقلد البيانات الناقصة.

## 5. المخاطر المعروفة والقرارات الذاتية

- health يعرض تقدير تخصيص الجداول، لا مساحة filesystem؛ df الفعلي هو دليل السعة التشغيلية.
- رفع احتياط الحجم إلى القياس المحلي الفعلي لأن هامش50% وحده أقل من تخصيصInnoDB. لم تتغير معايير القبول أو مواردproduction.
- التوقف عند فسادcheckpoint بدل إعادة الكتابة الصامتة، مع history؛ الإصلاح التجريبي محلي وصريح فقط.
- استخدام gzip المتوفر وجلسات متتابعة ودفعات250 مع packet guard؛ لا وصول قاعدة عام.
- تحسين جرد القراءة بصفوف PRIMARY المتتابعة وجمع مستقل لتجنب استعلام بطيء؛ لا تغيير حساب التوقيت أو التغطية.
- استخدام النسخة المشفرة المتحققة الأقل من24h بعد مطابقة الحرجة؛ لا عملية هدمprod. لا snapshot أو تنظيف محلي آلي.
- السعة المتاحة والتكلفة تراقبان، وفاتورةRailway متأخرة؛ فرق workspace لا يعزلD3 أو الوفر.
- النسخة الأولى السابقة لم يكن لها timings إنتاجية؛ diff الحالي0→422,463، وإعادة الإصدار نفسه تغير0 صف. لم يُختبر ترقية لإصدارRelease مختلف، ولا يُسمح لها بإعادة كتابة خفية.

## 6. الخطوة التالية المقترحة

إكمال بوابات CI والنشر لهذا D3 وحده، ثم التقرير والتوقف. **لاD4 أو أي مرحلة أخرى.**
