# تقرير المرحلة D3 — الدفعة 1: السعة والتكلفة، وتوقف البروفة المحلية

الحالة: **D3 غير مغلق**. فعّلت نقطة التوقف التي حددها المستخدم بعد تكرار أخطاء BullMQ في الخطوة نفسها. لم يبدأ استيراد D3 على production، ولم تبدأ D4.

## 1. ما الذي تغيّر

سُجل قرار الميزانية أولًا في DECISIONS.md، ثم تحقق حد الصرف 30$ والتنبيه عند 20$ بالقراءة. اكتمل [تحليل التكلفة](railway-cost-analysis.md)، وأوقفت deployments خدمات staging الست المتبقية؛ Redis كان بلا deployment أصلًا. بقيت الخدمات والبيئة والـ volumes الثلاثة، وحُفظت إعدادات watchPatterns السابقة مع تفعيل حارس يمنع النشر التلقائي على staging. لم تُشغّل مجددًا، ولم تتغير إعدادات production.

أضيف كود D3 للمراجعة، دون دمج أو نشر: مستورد BullMQ بتزامن واحد، SQL حتمي، checkpoints ذرية، والتحقق من القيم المخزنة قبل الاستئناف وبعد كل تلاوة. يحسب تغطية الكلمات ويحدّث أعمدة D2 دون الكتابة إلى is_complete المولد. migration003 منفصلة عن startup، وتحتوي down مقيدًا بالبروفة المحلية؛ اختبار down الحقيقي ما زال معلقًا.

تضيف migration جداول ayah_timings وimport_jobs وayah_timing_history، وجدول quran_timing_audit_fixtures للصفوف السبعة من HF التي لا تتبع Release المثبت، وجدول quran_storage_health لقياس المساحة. النص المنطوق يستخدم utf8mb4_bin، والحقول الوصفية utf8mb4_unicode_ci. فحص health/ready المحضّر يحذر تحت 20% ويعلن القياس الغائب أو القديم unavailable دون إسقاط الجاهزية. جامع القياس ودورة حياته لم يُقبلا أو يُنشرا؛ لا يُعتبر التحذير التشغيلي مكتملًا.

لم تتغير الواجهة أو الريندر أو سياسة النشر أو نتيجة offset المعتمدة. تبقى التوقيتات في source_ms دون تحويل إحداثيات.

## 2. ما الذي تحققت منه فعليًا

### السعة والتكلفة

Railway يعرض volume بحجم 5000MB. df الفعلي داخل خدمة MySQL قبل الدفعة وبعد التوقف:

| القياس | قبل | بعد |
|---|---:|---:|
| الحجم، bytes | 4,685,873,152 | 4,685,873,152 |
| المستخدم، bytes | 325,705,728 | 325,705,728 |
| المتاح، bytes | 4,350,103,552 | 4,350,103,552 |
| الاستخدام | 7% | 7% |

MySQL 9.7.2؛ آخر جرد السعة سجل uptime=61,844s وThreads_connected=2 مقابل max_connections=60. binlog معطل أصلًا؛ لا PURGE أو SET PERSIST، وأثر تنظيف binlog صفر. redo=104,861,696 وundo=33,554,432 bytes في الجرد الفعلي. الأدلة: [السعة قبل](d3-batch1-capacity-before.json) و[df بعد](d3-queue-stop-df-after.json).

قِيس JSON_STORAGE_SIZE لكل الصفوف الـ 422,463 في التلاوات الـ 69 على MySQL 9.7.2، مع الأحجام الفعلية للنص وحقول DDL: 645,389,632 bytes، ومع هامش 50% يصبح 968,084,448 bytes. هذا أقل من 60% من المساحة الحرة، أي 2,610,062,131.2 bytes؛ بوابة السعة ناجحة. الرقم تقدير payload مع هامش، وليس حجم جداول نهائيًا على القرص. [دليل القياس](d3-all-recitation-binary-size.json).

الاستهلاك قبل الدفعة 17.840302718684075$ وبعدها 17.84644344915963$؛ الزيادة 0.006140730475555$ تشمل الاستهلاك الجاري ولا تعزل تكلفة D3. التقدير العام تغير من 23.07756657010779$ إلى 23.07158363939096$؛ فرق التقدير ليس توفيرًا ماليًا مقاسًا. [الدليل](railway-cost-after-stop.json).

تقدير تكلفة D3 المحافظ قبل الكتابة بلغ 0.96743488992$: نمو volume بسعر 0.15$/GB-month يقدر بـ 0.1452126672$ شهريًا، واحتياط CPU=0.41666666688$ وRAM=0.25555555584$ وegress=0.15$. افترض التقدير أربع ساعات، 2vCPU و2GB RAM إضافيين و3GB egress؛ التنفيذ المحلي لا يحتسب CPU/Redis على Railway. المتبقي بعد التقدير 11.192262391395925$، فوق حد 3$. السقف الاسمي عند استخدام 5GB كاملة 0.75$ شهريًا، وليس فاتورة توسعة مقاسة. billing مكوّن volume الخاص بخدمة MySQL عبر البيئتين بلغ 0.06275018109914306$ خلال الدورة عند التحليل. [دليل بوابة التكلفة](d3-batch1-marginal-cost-preflight.json).

توزيع الفاتورة بحسب حصة كل بيئة من القياسات أعطى production≈8.06$ وstaging≈9.78$، ويشمل خدمات محذوفة تاريخيًا. هو توزيع مشتق من billing لكل خدمة وusage لكل بيئة، وليس فاتورتين مستقلتين. RAM هي أكبر بند، نحو 16.77$. runtime يثبت renderAutoscaler=false وSkia minimum=1؛ لا خدمات Chromium/FFmpeg حية. أعداد queued/running كانت صفرًا في البيئتين قبل الإيقاف.

بعد التخفيض: جميع activeDeployments في staging فارغة، والـ volumes محفوظة. المتوقع من RAM نحو 18.2$/شهر وفق القياس السابق والسعر الاسمي؛ التوفير الفعلي بالدولار غير قابل للقياس في هذه النافذة القصيرة بسبب تأخر المقاييس والفاتورة. آخر RAM metric للـ scanner بقي قديمًا رغم توقف deployment، فلا يثبت استهلاكًا جديدًا أو صفر استهلاك. [قراءة الإيقاف النهائية](railway-cost-staging-pause-readback-final.json). حجم استيراد D3 على production وزمنه لم يقاسا لأنه لم يبدأ.

### النسخة وحماية البيانات

أُنشئت نسخة age جديدة خاصة، واستعيدت محليًا على MySQL 9.7.2؛ تطابقت أعداد الصفوف وCHECKSUM لكل 51 جدولًا. حجم SQL قبل التشفير 21,307,787 bytes. [دليل النسخة والاستعادة](d3-batch1-backup-verification.json). لا dump أو مفتاح أو صوت في Git، ولا snapshot جديد لأن الميزة مرفوضة بسبب الخطة، ولا محاولة تنظيف محلي بديلة.

بعد التوقف أثبتت قراءة production ثبات D1: 114/6236/77433، وبصمة النص القانوني eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4. الجداول الحرجة ثابتة: users=13، subscriptions=16، payment_requests=3، saved_videos=7، render_jobs=72، system_settings=13، user_roles=13، notifications=49. CHECKSUM users/user_roles ثابتان، وحسابا الأدمن محفوظان دون إخراج بياناتهما. جداول D3 الخمسة غير موجودة على production. [الدليل](d3-queue-stop-production-readonly.json).

health وready أعادا 200، ولوج AyahX/MySQL بلا أخطاء جديدة في نافذة 04:46–04:49 UTC. ليست نافذة قبول نشر عشر دقائق؛ لم يحدث نشر جديد. [دليل الخدمات](d3-queue-stop-production-services.json). لم يُنفذ طلب ريندر فعلي بعد التخفيض؛ لا ندعي قبول العامل عند الطلب من health وحده.

### البروفة الجزئية والتوقف

محاولة تلاوة واحدة كشفت تعارض collation بين القيمة المحولة ومعرّف الجدول. عولجت المقارنات الخاصة بـ D3 باستخدام COLLATE صريح، دون ALTER للأعمدة القائمة. نجحت إعادة تلاوة ماهر بـ 6,236 صفًا وبصمة القيم bc2619c9b20af61acd8d792f623630eb12c27bc83e8aa93449ed9c2105f9288d. [النتيجة](d3-local-first-fixed.json).

المحاولة الكاملة التالية أنشأت SQL محليًا خاصًا ببصمة fcd552302417328ed5e82fab9e90865d933faa3c953066efe2ab88012d5c6cb7. وصلت قاعدة البروفة إلى 316,539 صفًا و52 checkpoint مكتملًا، ثم فشلت BullMQ برسالة job stalled more than allowable limit بعد ثماني رسائل WorkerError على الأقل. تقرير المعالج يحتوي 53 نتيجة بسبب إعادة job واحد؛ القراءة الفعلية تثبت 52 تلاوة، ولا يُحسب التكرار كتلاوة إضافية. [التقرير الجزئي](d3-local-full-first.json) و[قراءة MySQL](d3-local-queue-stop-readonly.json) و[أحداث Redis والتشخيص](d3-bullmq-stop-diagnosis.json).

مجموع elapsed_ms للمعالج عبر النتائج الـ 53 هو 241761ms، بما فيه الوظيفة المعادة؛ ليس زمنًا جداريًا لاستيراد كامل أو زمن production.

القفل المحلي القصير، ثانيتان، مع العمل المتزامن في بناء SQL وقراءة المدخلات سبب مرجح؛ لا إثبات سببي نهائي لأن event-loop-delay لم يقس. لا زيادة لـ maxStalledCount ولا تمرير للفشل. فُعّلت نقطة توقف التكرار أكثر من مرتين، ولم تُعد المحاولة بعد التوقف.

الصفوف السبعة الحقيقية من HF موجودة في جدول التدقيق المحلي بحالة needs_review وأسباب NON_POSITIVE_WORD_DURATION وHF_AUDIT_OUTSIDE_PINNED_RELEASE. تقع في 5:116، 7:44، 7:57، 9:72، 9:98، 10:104، 33:7. لم تُنشأ تلاوة وهمية لها في Release. مخالفات معادلة coverage_words+missing_words=expected_words في الجزء المحلي صفر.

الأحجام التالية إحصاءات information_schema للبروفة الجزئية قبل ANALYZE النهائي، وقد تتأخر عن تخصيص InnoDB؛ ليست قياس حجم استيراد كامل أو قياس production:

| الجدول | DATA_LENGTH | INDEX_LENGTH |
|---|---:|---:|
| ayah_timing_history | 16,384 | 16,384 |
| ayah_timings | 19,480,576 | 2,080,768 |
| import_jobs | 16,384 | 16,384 |
| quran_storage_health | 16,384 | 0 |
| quran_timing_audit_fixtures | 16,384 | 16,384 |

Golden fixtures للقسم 6 فُحصت من Release المثبت وكاش HF الحقيقي: 1:2 و1:3 و2:7 و2:32 ready؛ 2:31 needs_review بسبب نقص ربط الكلمات القانونية وتظليل الكلمات معطل. وصف المصدر القديم لا يطابق دائمًا occurrences في Release الحالي؛ الأدلة تحفظ المصدرين دون اختلاق segments. [دليل العينات](d3-golden-fixtures-source-check.json).

### جدول التلاوات والتغطية

الأعداد ready/needs_review والكلمات أدناه من التحضير المثبت لكل 69 تلاوة، وليست قبول نشر. العمود المحلي يثبت الصفوف التي تحققت قيمها أثناء المعالجة فقط؛ قبول الطابور الكامل فشل. الاستيراد على production صفر لكل التلاوات. غير حفص لا يحتوي spoken_text مستعارًا؛ تغطية قانوني حفص له غير منطبقة، والسبب SPOKEN_TEXT_UNAVAILABLE محفوظ.

| التلاوة | الرواية | صفوف التحضير | ready | needs_review | الكلمات الموقّتة/القانونية | الصفوف المحلية المتحققة | production D3 |
|---|---|---:|---:|---:|---:|---:|---:|
| abdul_hamid_ghraio_2025_yt | hafs_an_asim | 6,236 | 6,071 | 165 | 76,981/77,433 | 6,236 | 0 |
| abdul_hamid_ghraio_2026_yt | hafs_an_asim | 6,236 | 6,080 | 156 | 76,985/77,433 | 6,236 | 0 |
| abdulaziz_al_turki_yt | hafs_an_asim | 6,115 | 5,686 | 429 | 74,609/76,082 | 6,115 | 0 |
| abdulbasit_abdulsamad_mujawwad_tarteel | hafs_an_asim | 6,236 | 5,629 | 607 | 74,526/77,433 | 6,236 | 0 |
| abdulbasit_abdulsamad_tarteel | hafs_an_asim | 6,236 | 5,828 | 408 | 75,534/77,433 | 6,236 | 0 |
| abdulbasit_abdulsamad_warsh_qdc | warsh_an_nafi | 6,214 | 0 | 6,214 | غير منطبق | 6,214 | 0 |
| abdullah_al_buaijan_2025_yt | hafs_an_asim | 6,236 | 6,168 | 68 | 77,211/77,433 | 6,236 | 0 |
| abdullah_al_mattrod_qdc | hafs_an_asim | 6,236 | 5,898 | 338 | 76,355/77,433 | 6,236 | 0 |
| abdullah_al_qarafi_mp3quran | hafs_an_asim | 6,236 | 5,765 | 471 | 75,662/77,433 | 6,236 | 0 |
| abdullah_kamel_way2quran | hafs_an_asim | 6,236 | 4,515 | 1,721 | 71,790/77,433 | 6,236 | 0 |
| abdulwadood_haneef_mp3quran | hafs_an_asim | 6,236 | 5,511 | 725 | 75,427/77,433 | 6,236 | 0 |
| abdur_rashid_sufi_qdc | hafs_an_asim | 6,236 | 5,995 | 241 | 76,426/77,433 | 6,236 | 0 |
| abdur_rashid_sufi_shubah_qdc | shubah_an_asim | 6,236 | 0 | 6,236 | غير منطبق | 6,236 | 0 |
| abu_bakr_al_shatri_tarteel | hafs_an_asim | 6,236 | 4,379 | 1,857 | 73,004/77,433 | 6,236 | 0 |
| adel_al_karbalaei_archive_v2 | hafs_an_asim | 6,236 | 6,052 | 184 | 76,815/77,433 | 6,236 | 0 |
| ahmad_naseem_ali_ahmad_2019_yt | hafs_an_asim | 6,236 | 5,481 | 755 | 74,540/77,433 | 6,236 | 0 |
| ahmed_al_ajmi_qdc | hafs_an_asim | 6,236 | 4,780 | 1,456 | 73,104/77,433 | 6,236 | 0 |
| ahmed_amer_tvquran | hafs_an_asim | 6,236 | 5,893 | 343 | 75,913/77,433 | 6,236 | 0 |
| ahmed_deban_qalon_mp3quran | qalon_an_nafi | 6,214 | 0 | 6,214 | غير منطبق | 6,214 | 0 |
| ahmed_issa_al_maasaraawi_mp3quran | hafs_an_asim | 6,236 | 5,971 | 265 | 76,514/77,433 | 6,236 | 0 |
| ahmed_kaseb_way2quran | hafs_an_asim | 6,236 | 5,925 | 311 | 76,565/77,433 | 6,236 | 0 |
| ahmed_nuayna_qdc | hafs_an_asim | 6,236 | 6,015 | 221 | 76,586/77,433 | 6,236 | 0 |
| ahmed_saleh_rajab_qalon_way2quran | qalon_an_nafi | 6,213 | 0 | 6,213 | غير منطبق | 6,213 | 0 |
| ahmed_saud_mp3quran | hafs_an_asim | 327 | 325 | 2 | 1,359/1,363 | 327 | 0 |
| ahmed_shaheen_mp3quran | hafs_an_asim | 6,236 | 5,503 | 733 | 74,698/77,433 | 6,236 | 0 |
| ahmed_talib_bin_humaid_mp3quran | hafs_an_asim | 5,561 | 4,951 | 610 | 65,329/67,052 | 5,561 | 0 |
| akram_al_alaqmi_qdc | hafs_an_asim | 6,236 | 5,233 | 1,003 | 73,973/77,433 | 6,236 | 0 |
| ali_al_huthaifi_mp3quran | hafs_an_asim | 6,236 | 5,301 | 935 | 74,013/77,433 | 6,236 | 0 |
| ayman_swed_muallim_yt | hafs_an_asim | 6,236 | 4,881 | 1,355 | 72,807/77,433 | 6,236 | 0 |
| badr_al_turki_yt | hafs_an_asim | 6,236 | 5,589 | 647 | 74,786/77,433 | 6,236 | 0 |
| bandar_baleela_qdc | hafs_an_asim | 6,236 | 5,284 | 952 | 74,382/77,433 | 6,236 | 0 |
| fatih_seferagic_way2quran | hafs_an_asim | 6,236 | 6,167 | 69 | 77,216/77,433 | 6,236 | 0 |
| haitham_al_dukhain_mp3quran | hafs_an_asim | 6,236 | 5,122 | 1,114 | 73,893/77,433 | 6,236 | 0 |
| hani_al_rifai_qdc_128k | hafs_an_asim | 6,236 | 5,695 | 541 | 76,067/77,433 | 6,236 | 0 |
| ibrahim_al_akhdar_drive | hafs_an_asim | 6,236 | 6,106 | 130 | 76,995/77,433 | 6,236 | 0 |
| imad_zuhair_hafez_mp3quran | hafs_an_asim | 6,236 | 5,655 | 581 | 74,998/77,433 | 6,236 | 0 |
| islam_sobhi_mp3quran | hafs_an_asim | 5,334 | 4,683 | 651 | 61,761/63,841 | 5,334 | 0 |
| khalid_al_mohana_drive | hafs_an_asim | 6,236 | 5,973 | 263 | 76,377/77,433 | 6,236 | 0 |
| khalifa_al_tunaiji_tarteel | hafs_an_asim | 6,236 | 5,922 | 314 | 76,254/77,433 | 6,236 | 0 |
| maher_al_muaiqly_qdc | hafs_an_asim | 6,236 | 5,910 | 326 | 75,957/77,433 | 6,236 | 0 |
| mahmoud_abdul_hakam_mp3quran | hafs_an_asim | 6,236 | 5,660 | 576 | 74,973/77,433 | 6,236 | 0 |
| mahmoud_ali_al_banna_qdc | hafs_an_asim | 6,236 | 5,815 | 421 | 75,656/77,433 | 6,236 | 0 |
| mahmoud_khalil_al_husary_mp3quran | hafs_an_asim | 6,236 | 5,907 | 329 | 76,107/77,433 | 6,236 | 0 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | hafs_an_asim | 6,236 | 5,656 | 580 | 75,095/77,433 | 6,236 | 0 |
| mahmoud_khalil_al_husary_qdc_128k | hafs_an_asim | 6,236 | 5,929 | 307 | 75,839/77,433 | 6,236 | 0 |
| mishary_rashid_al_afasy_2008_qdc | hafs_an_asim | 6,236 | 5,291 | 945 | 74,622/77,433 | 6,236 | 0 |
| mishary_rashid_al_afasy_mp3quran | hafs_an_asim | 6,236 | 5,404 | 832 | 74,969/77,433 | 6,236 | 0 |
| moaz_mahmoud_hamed_qalon_way2quran | qalon_an_nafi | 6,177 | 0 | 6,177 | غير منطبق | 6,177 | 0 |
| mohammed_abdulkareem_qdc | hafs_an_asim | 6,236 | 4,952 | 1,284 | 73,300/77,433 | 6,236 | 0 |
| mohammed_al_luhaidan_mp3quran | hafs_an_asim | 6,236 | 5,096 | 1,140 | 74,389/77,433 | 6,236 | 0 |
| mohammed_alghazali_archive | hafs_an_asim | 6,236 | 5,119 | 1,117 | 73,766/77,433 | 6,236 | 0 |
| mohammed_ayyub_drive | hafs_an_asim | 6,236 | 5,539 | 697 | 74,229/77,433 | 6,236 | 0 |
| mohammed_burhaji_yt | hafs_an_asim | 6,236 | 5,163 | 1,073 | 74,699/77,433 | 0 | 0 |
| mohammed_saayed_warsh_mp3quran | warsh_an_nafi | 6,214 | 0 | 6,214 | غير منطبق | 0 | 0 |
| mohammed_siddiq_al_minshawi_1967_drive | hafs_an_asim | 6,236 | 5,689 | 547 | 75,222/77,433 | 0 | 0 |
| mohammed_siddiq_al_minshawi_mp3quran | hafs_an_asim | 6,236 | 5,766 | 470 | 75,510/77,433 | 0 | 0 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | hafs_an_asim | 6,236 | 5,281 | 955 | 73,501/77,433 | 0 | 0 |
| muammar_zainal_al_sukaini_way2quran | hafs_an_asim | 6,236 | 5,806 | 430 | 75,660/77,433 | 0 | 0 |
| mustafa_ismail_mp3quran | hafs_an_asim | 6,236 | 5,922 | 314 | 76,001/77,433 | 0 | 0 |
| nasser_al_qatami_mp3quran | hafs_an_asim | 6,236 | 4,518 | 1,718 | 72,390/77,433 | 0 | 0 |
| saad_al_ghamdi_tarteel | hafs_an_asim | 6,236 | 5,481 | 755 | 75,006/77,433 | 0 | 0 |
| saber_abdulhakam_qalon_way2quran | qalon_an_nafi | 6,214 | 0 | 6,214 | غير منطبق | 0 | 0 |
| saber_abdulhakam_shubah_way2quran | shubah_an_asim | 6,236 | 0 | 6,236 | غير منطبق | 0 | 0 |
| saber_abdulhakam_warsh_way2quran | warsh_an_nafi | 6,214 | 0 | 6,214 | غير منطبق | 0 | 0 |
| saber_abdulhakam_yt | hafs_an_asim | 6,236 | 5,630 | 606 | 75,267/77,433 | 0 | 0 |
| saud_al_shuraim_mp3quran | hafs_an_asim | 6,236 | 5,794 | 442 | 75,932/77,433 | 0 | 0 |
| walid_al_naihi_qalon_mp3quran | qalon_an_nafi | 6,214 | 0 | 6,214 | غير منطبق | 0 | 0 |
| walid_atef_way2quran | hafs_an_asim | 6,236 | 4,965 | 1,271 | 72,980/77,433 | 0 | 0 |
| yasser_al_dosari_archive | hafs_an_asim | 6,236 | 5,148 | 1,088 | 73,928/77,433 | 0 | 0 |

أسباب needs_review في التحضير الكامل؛ قد يحمل الصف أكثر من سبب، فلا يُجمع هذا الجدول للحصول على عدد الصفوف:

| السبب | عدد مرات السبب |
|---|---:|
| CANONICAL_TEXT_UNAVAILABLE | 62,146 |
| SPOKEN_TEXT_UNAVAILABLE | 62,146 |
| SPOKEN_WORD_COUNT_MISMATCH | 62,146 |
| CANONICAL_WORD_COVERAGE_INCOMPLETE | 38,518 |
| WORD_DIFF_UNMAPPED | 2,808 |
| INVALID_WORD_INTERVAL | 426 |
| MISSING_SOURCE_AYAH | 43 |

## 3. نتائج الاختبارات

- npm test: 488 ناجحة، 6 متخطاة، صفر فشل من 494. استُخدم corpus ومدخلات D3 الحقيقية. الاختبارات الستة المتخطاة تخص renderJobQueue المشروط ببيئة DB، ولا تعد قبول D3.
- npx tsc --noEmit، وفحص strict لملفات server/scripts الجديدة، وnpm run build: ناجحة.
- lint للملفات الجديدة بلا رسائل؛ في server/index.ts تحذيران قديمان متطابقان قبل وبعد، ولا رسائل جديدة. لم يُصلح lint العام.
- التشغيل المستهدف للـ golden/import/normalize: 8/8؛ اختبارات schema/storage أيضًا ناجحة. الاختبارات الوحدية لا تعوض فشل البروفة الكاملة.

الأدلة: [مخرجات npm test](d3-batch1-tests.json)، [مقارنة lint](d3-changed-lint-baseline-comparison.json). الأوامر:

~~~powershell
$env:D1_QURAN_CORPUS = "$env:TEMP/ayahx-d1/corpus.json"
$env:D3_INPUT_DIRECTORY = "$env:TEMP/ayahx-d3-release-inputs"
npm test -- --reporter=json --outputFile=docs/data/d3-batch1-tests.json
npx tsc --noEmit
npm run build
npx tsc --noEmit --module esnext --moduleResolution bundler --target es2022 --skipLibCheck --strict --esModuleInterop server/services/qudTimingImport.ts scripts/import-qud-timings.ts server/services/quranStorageHealth.ts
~~~

المستورد المحلي نُفذ عبر scripts/import-qud-timings.ts باستخدام --target local --apply، ومدخلات Release الخاصة والبصمات المسجلة في الأدلة. هذا ليس dry-run أو apply على production.

## 4. ما لم يكتمل أو يحتاج قرارك، وسببه

D3 غير مغلق بسبب نقطة التوقف الملزمة. لم يكتمل الاستيراد المحلي الكامل مرتين، أو قتل العملية المخطط ثم الاستئناف الحقيقي، أو رفض فساد قاعدة حقيقية، أو down وإعادة التطبيق، أو EXPLAIN يثبت الفهرس وزمنًا أقل من 50ms. لم ينفذ production dry-run/apply/ANALYZE أو تحقق تغطية كل سورة بعد الاستيراد. فحص المساحة يحتاج تشغيل جامع دائم واختبار دورة حياته. لا PR/CI/merge/deploy جديد؛ الكود لا يستوفي بوابة الدمج.

لا عزل مالي ممكن لتكلفة D3 الفعلية أو التوفير المحقق من فاتورة الدورة المتأخرة. لا اختبار طلب ريندر فعلي بعد تخفيض staging. لم تبدأ D4 أو أي مرحلة بعدها.

## 5. المخاطر المعروفة

قفل BullMQ قد ينتهي قبل تجديده تحت الحمل المتزامن؛ نجاح SQL أو checkpoint لا يعني نجاح الطابور. قد تستأنف BullMQ الوظيفة داخليًا، ولهذا يُتحقق من القيم المخزنة قبل أي كتابة. SQL الخاص والكاش محفوظان، ولا محاولة حذف بديلة. أرقام حجم information_schema الجزئية تحتاج ANALYZE وقياسًا فعليًا بعد استيراد كامل. خدمة القياس يجب أن تميز stale وأن تستمر بعد إعادة التشغيل قبل قبول health storage.

الـ offset والبسملة وحقوق الصوت قيود مستقلة محفوظة، ولا تُنشر تلاوة لمجرد استيراد توقيتها.

## 6. الخطوة التالية المقترحة

بعد قرار المستخدم باستئناف D3: تشخيص event-loop-delay وأخطاء القفل المحددة، وتقييم قفل طبيعي 120 ثانية مع تجديد موثق، وقفل قصير محصور في اختبار قتل منفصل. لا زيادة لـ maxStalledCount لإخفاء الفشل. بعدها تعاد البروفة الكاملة بكل اختبارات القبول، ثم بوابات production. العمل متوقف الآن؛ لا D4.

القرارات الذاتية: حماية جميع حسابات الأدمن؛ إيقاف staging وحدها وحفظ الرجوع ومنع auto-deploy؛ إبقاء موارد production؛ عدم PURGE مع binlog معطل؛ فصل تدقيق HF عن Release؛ إصلاح المقارنات بدل تغيير collation قائم؛ التوقف عند تكرار الفشل؛ الفصل بين تقدير التوفير والتوفير المالي المقاس.
