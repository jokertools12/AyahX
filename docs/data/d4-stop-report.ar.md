## تقرير المرحلة D4 — توقف إلزامي عند بروفة T6 المحلية

الحالة: **D4 غير مغلق**. أوقفت التنفيذ بعد ثالث فشل للخطوة المحلية نفسها، وفق نقطة التوقف الصريحة. لا محاولة رابعة، ولا T6 على production، ولا قياس T7، ولا A1 أو D5. التقرير أدناه يميز قبول كل جزء عن اكتمال المرحلة.

### 1. ما الذي تغيّر

- **T0 مكتمل ومنشور**: logger يحفظ code/message/stack مع حجب الأسرار والروابط الموقعة. [PR13](https://github.com/jokertools12/AyahX/pull/13)، [CI](https://github.com/jokertools12/AyahX/actions/runs/38039600952)، commit `ec593cf689a1402155fe41f2016720c82ef78118`. لا ادعاء معرفة سبب 503 التاريخي؛ تحسين التسجيل يجعل التشخيص اللاحق ممكنًا. دليل النشر: [d4-t0-publication.json](d4-t0-publication.json).
- **T1 مطبق على production**: migration004 إضافية، 3 جداول جديدة وحقول الكتالوج والصوت/المراجعات، NULLable وcollations صريحة ودون FK نحو الجداول القديمة. مجموع الجداول 54→57. down للمحلي فقط. [البروفة](d4-t1-local-migration.json)، [التطبيق](d4-t1-production-apply.json)، [rollback](d4-migration004.md).
- **T2 مطبق**: حساب مستوى كل تلاوة/سورة والنطاقات الجاهزة والكلمات الناقصة. 7,765 صف كتالوج تغيرت في التشغيل الأول؛ التشغيل الثاني **صفر تغيير** والبصمة نفسها. [الإنتاج الأول](d4-t2-production-first.json)، [الثاني](d4-t2-production-second.json)، [415 فصلًا](near-complete-chapters.json).
- **T3 وخدمة T4 في الفرع، غير منشورتين**: أربع GET خلف flag، services للكتالوج/الأدمن بلا routes أدمن، AudioResolver يرفض الاستبدال بين التلاوات وSSRF/blob؛ البديل داخل التسجيل نفسه يحتاج SHA للصوت المفكوك واعتمادًا بشريًا وتدقيق الاستخدام. تحويل QUD/HF في `toRenderTimeline` وحده. الفاحص الدوري مغلق مع flag، ويحترم Retry-After ويحفظه عبر restart؛ يغلق طلبه بـ AbortSignal قبل تصريف الخادم.
- **T4 metadata مطبقة**: قبول v2 السابق للثلاث المحددة محفوظ مع النتائج القديمة وتدقيق. إضافة `cdn.mp3quran.net` المضيف الدقيق الذي أثبتته إعادة التوجيه؛ لا wildcard. 70 تغييرًا/سجل تدقيق، replay صفر. [النتيجة](d4-t4-metadata-production-apply.json)، [replay](d4-t4-metadata-production-replay.json).
- **T5 جزئي**: تدقيق الهوية والخريطة القديمة، قياسات جودة المصادر المحفوظة، planner للعَيّنات واختبار browser Range فعلي. **لم تُدرج عينات الاستماع الـ207 في production**؛ اعتمادها ينتظر اكتمال فحص الروابط. مواصفات الأدمن الحرفية في [ADMIN_RECITERS_SOURCES_SPEC.md](../plan/ADMIN_RECITERS_SOURCES_SPEC.md).
- لم تتغير الواجهة أو الريندر؛ flag production مغلق، ولا confirmed أو permitted أو is_public فُعل تلقائيًا. لم يُفتح أو يُدمج PR لبقية D4؛ العمل في `codex/d4-catalog-audio`.

### 2. ما الذي تحققت منه فعليًا

الأوامر الأساسية وأدلتها:

```powershell
npx tsx scripts/test-d4-catalog-db.ts --local-db ayahx_d4_catalog_20261010 --report docs/data/d4-t1-local-migration.json
npx tsx scripts/reconcile-availability.ts --target production --apply --confirm-production --progress --baseline docs/data/d3-close-production-after.json --expected-report docs/data/d4-t2-production-first.json --report docs/data/d4-t2-production-second.json
npx tsx scripts/test-d4-catalog-api.ts
npx tsx scripts/test-d4-production-shadow-api.ts
npx tsx scripts/test-d4-audio-source.ts
npx tsx scripts/test-d4-publication-constraints.ts --local-db ayahx_d4_catalog_20261010 --report docs/data/d4-t6-local-constraints.json
npx tsx scripts/verify-qud-timings.ts --corpus "$env:TEMP/ayahx-d4-corpus.json" --baseline docs/data/d3-close-production-before.json --out "$env:TEMP/ayahx-d4-stop-production-inventory.json"
```

البروفة T1: up مرتين، down مرتين، إعادة التطبيق؛ projection للحقول الأصلية ثابت. المصالحة T2: 3,043 complete / 415 near_complete / 3,165 partial / 1,243 unavailable، الأخيرة تشمل 101 سورة غائبة من الكتالوج، دون اختلاق صفوف. البصمة `e3bf310ebb4786297e3f8c09d3704f3815a731a328fc943fa38a40824038c5ce`. أول تطبيق T2 نفذ بنمط autocommit؛ replay الثاني أثبت COMMIT صريحًا وnative SSH exit=0.

API محلي حقيقي على MySQL9.7.2: حالات flag/ranges/modes/ETag/revocation، primary HEAD وخطة القص، concurrent audit وصلاحيات. أعيد بعد إصلاح الفاحص الدوري: **20 رابطًا فعليًا/20 تحديث صحة**، fixtures البشرية/الترخيص محلية فقط وأعيدت في finally؛ لا هوية بشرية مستنتجة. [الدليل](d4-t3-real-api.json). shadow الإنتاج: SELECT عبر SSH فقط، writes=0، flag override في العملية المحلية فقط؛ flag off أربع404 بكود QURAN_CATALOG_DISABLED، enabled-local يعيد قوائم فارغة كما تفرض الموافقات البشرية الغائبة. [الدليل](d4-t3-production-shadow-api.json). هذه تجربة للكود المحلي على بيانات الإنتاج، وليست نشرًا للـ endpoints الجديدة.

AudioSource: HEAD/redirect فعلي، وSHA المفكوك للمصدر والرابط النهائي متطابق، تسجيل آخر مرفوض، no audio file persisted. [الدليل](d4-t4-real-audio-source.json). المعاينة في desktop/mobile: **2/2**، طلب Range فعلي ووقوف زمني؛ DOM اختبار فقط دون تعديل UI المنتج. [الدليل](d4-t5-browser-audition.json).

فحص الروابط أُوقف عمدًا وحفظ checkpoint: **6,052/7,765**؛ 4,623 available، 269 AUDIO_HOST_NOT_ALLOWED، 789 YouTube محظور، 369 source_unavailable، 2 AUDIO_REQUEST_FAILED. لا collision مختلف قارئين في الجزء المفحوص؛ **لا يُعمم على 1,713 غير مفحوصة**. لم تُطبق خطة صحة الروابط على production. فشل Archive بسبب allowlist لإعادة التوجيه يحتاج دليل المضيف قبل إضافة أي host؛ لا تعويض أو fallback. [ملخص التوقف](d4-stop-summary.json).

القراءة النهائية: D1=114/6236/77433، البصمة `eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4`، D3=422463، users/user_roles والجداول المحمية ثابتة. health/ready200 عند 11:04UTC. [الحماية والمساحة](d4-stop-production-proof.json)، [health](d4-stop-health.json). نافذة T0 المقبولة615.238s، 6 خدمات بلا أخطاء جديدة؛ ليست قبول نشر لبقية D4.

| قياس df | الحجم bytes | المستخدم bytes | المتاح bytes |
|---|---:|---:|---:|
| قبل D4، بعد T0 | 4,685,873,152 | 1,666,068,480 | 3,009,740,800 |
| بعد migration004 | 4,685,873,152 | — | 2,967,388,160 |
| قراءة التوقف النهائية | 4,685,873,152 | 1,731,608,576 | 2,944,200,704 |

المساحة المقدرة من information_schema في health: allocatedTableBytes=1,372,979,200، freePercent=72.54%. هذا تقدير الجداول مقابل5000MB، **ولا يشمل redo/undo/ملفات النظام**، فلا يساوى df.

المال: قبل17.8925166119$ / بعد17.9200316042$ / فرق **0.0275149923$** لإجمالي workspace، hard30$/soft20$، remaining12.0799683958$. لا دليل يعزل تكلفة D4 أو يثبت توفير فاتورة. لم تتغير موارد production، وstaging بقيت متوقفة.

### 3. نتائج الاختبارات

- آخر suite كامل قبل تعديلات المراجعة النهائية وT6: **104 files passed،1 skipped؛577 passed،6 skipped،0 failed**، مع golden D1/D3 من المصادر الفعلية. build ناجح في التشغيل السابق؛ لا يثبت صحة كود T6 اللاحق.
- بعد إصلاح مصدر المعاينة وAbortSignal/Retry-After: **31/31** في أربعة ملفات؛ `npx tsc --noEmit` exit0. lint للملفات المذكورة في التشغيل الأخير0؛ تحذيرا index.ts قديمان مطابقان للخط الأساسي. لم تُصلح lint العام.
- MySQL migration004/mصالحة/Metadata replay ناجحة؛ الفهرس covering لجميع69 أعاد ready321473 في541.101ms. لا إعادة قياس جديد لوقت query النطاق بعد التوقف.
- **T6 محلي فاشل3مرات**: (1) clone سمّى القيود recitations_chk_1/2؛ (2) قوس زائد ER_PARSE_ERROR؛ (3) MySQL رفض COALESCE كنوع غير boolean، ER_NON_BOOLEAN_EXPR_FOR_CHECK_CONSTRAINT. ALTER الأخير فشل atomically؛ القيود القديمة بقيت، مع إعادة تسميتها محليًا فقط. لم يصل الاختبار إلى probes أو down/reapply. [آخر خطأ](d4-t6-local-constraints.json)، [تاريخ المحاولات](d4-stop-summary.json).
- لم يشغل CI جديد لبقية D4 ولم تُحقق بوابات نشرها. لا إعلان نجاح شامل.

### 4. ما لم يكتمل أو يحتاج قرارًا، وسببه

فحص الروابط الكامل وتطبيق صحته، إدراج207عينات، مراجعة T0–T6 النهائية، بروفة قيود T6 ونشر rule-v1، ثم T7؛ كلها غير مكتملة. **عدد القراء المؤهلين تقنيًا غير معتمد بعد**؛ جدول69 أدناه يعرض offset والإتاحة المثبتة، دون تحويل المرشحين إلى published. T7 لا قياس ولا تغيير نتائج، ولا إعادة اختيار عينات. موافقة استئناف لازمة لأن نقطة التوقف تحققت، وليست صلاحية دمج قديمة إذنًا لمحاولة رابعة.

T5: [voice-identity-report.json](voice-identity-report.json) يحوي69تلاوة/57قارئًا،7قراء متعددَي التلاوة، وصفر تكرار exact/file-ID بين قارئين في7523URL. فحص الجودة144/144مصدر محفوظ ببصماته،28مقارنة للسورة نفسها،19تنبيهًا استشاريًا؛16فرق مدة،4bitrate،1sample rate مع تداخل. غطى6من7القراء متعددَي التلاوة، ولم يشمل كل صوت الكتالوج. speaker embeddings اختياري لم ينفذ؛ لا ادعاء تعذر تثبيت.

**أهم خلل قديم**: resolver QuranFoundation يعيد AbdulBaset(id2) عند اسم MaherAlMuaiqly/اسم مجهول بسبب نقاط الأسلوب دون nameHit. أثبت بمنطق المصدر وبقائمةAPI فعلية؛ لا تحميل صوت لهذه المقارنة. الدالة لا callsites لها والمسار القديم معطل؛ لذلك **سبب محتمل تاريخي، وليس سببًا مثبتًا لسلوك الموقع الحالي**. بقيت خرائط EveryAyah/QDC لاستخدامD8 لاحقًا. [legacy audit](legacy-reciter-mapping-audit.md).

IslamSobhi44: Release مثبت يحوي59صفًا جاهزًا ورابطHEAD200، بينما available_ayahs=0/coverage_mismatch=1 في الكتالوج؛ اقتراح تصحيح البيانات موثق فقط، **حارس D2 لم يتجاوز ولم يطبق التعديل**. [الدليل](d4-islam-sobhi-44.json).

### 5. المخاطر المعروفة

الإنتاج يحتوي schema وmetadata الجديدة لكن runtime الجديد غير منشور. حالة المسودة المحلية تتضمن CHECK غير مقبول؛ ممنوع تطبيقه على production حتى بروفة ناجحة. link scan جزئي؛ صحة الرابط ليست هوية قارئ أو ترخيصًا أو توافق offset. all voice unverified/provider license unreviewed/public flag off، وبسملة الصوت unverified. لا توقيت تقريبي ولا مرجع حفص لغير حفص. تبقى الموارد والملفات الخاصة محفوظة؛ لا حذف أو نقل بعد رفض التنظيف.

مراجعة كود T7 التحضيري كشفت أيضًا أن مقارنة score المدوّر قد تحول NCC=0.949999997 إلى0.95 رغم passed=false الخام. لم يحدث أي قياس فعلي بهذا الكود؛ يجب تثبيت رفض هذه الحالة باختبار واستخدام القرار الخام قبل اعتماد المنفّذ. توقفت المراجعة مع الوكلاء، ولا يُعلن المنفّذ مقبولًا.

القرارات الذاتية: حماية audit-chain بقفلحتىCOMMIT؛ تقسيم البيانات≤200row/256KiB والفحص قبل الدفعات؛ فحص الروابط بشكل مسلسل1s/host؛ تمثيل معاينة unavailable حين لا يوجد ملف سورة مستقل؛ حفظsource metadata ورفض تغيرها؛ عدم تعديل Archiveallowlist بلا دليل؛ إبقاء القيود القديمة في الإنتاج عند فشل المحلي؛ إيقاف الفحوص والوكلاء عند نقطة التوقف؛ no-public approval آلي.

### 6. الخطوة التالية المقترحة

بعد موافقة الاستئناف فقط: تشخيص CHECK وتجربة تعبير boolean صريح مع رفض NULL على MySQL9.7.2؛ بروفة up مرتين/down/reapply وبيانات مرفوضة؛ استكمال link checkpoint وحسم Archive بدليل؛ ثم207عينات وT6. بعد قبولT0–T6 فقط يقفل manifestT7 ويقاس الجميع وفق البروتوكول، ثم PR/CI/merge/SUCCESS/health/ready/10minlogs/smoke. **التنفيذ متوقف هنا؛ لاA1 ولاD5.**

### جدول التلاوات — snapshots الإتاحة وoffset، وليس نشرًا

T7 لم يبدأ لجميع الصفوف. rule-v1 لم يطبق لأي صف في هذه الدفعة؛ عدد المؤهلين النهائي ينتظر اكتمال الروابط وبروفة T6.

| التلاوة / القارئ | الرواية | المصدر | offset الحالي / T7 | complete | near | partial | unavailable | جاهزة آيات | أكبر نطاق | rule-v1 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|
| abdul_hamid_ghraio_2025_yt — عبدالحميد القريو | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 66 | 12 | 36 | 0 | 6071 | 227 | لم يطبق |
| abdul_hamid_ghraio_2026_yt — عبدالحميد القريو | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 62 | 11 | 41 | 0 | 6080 | 226 | لم يطبق |
| abdulaziz_al_turki_yt — عبد العزيز التركي | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 57 | 6 | 49 | 2 | 5686 | 227 | لم يطبق |
| abdulbasit_abdulsamad_mujawwad_tarteel — عبد الباسط عبد الصمد | hafs_an_asim | tarteel | failed / لم يبدأ | 51 | 5 | 58 | 0 | 5629 | 227 | لم يطبق |
| abdulbasit_abdulsamad_tarteel — عبد الباسط عبد الصمد | hafs_an_asim | tarteel | failed / لم يبدأ | 57 | 4 | 53 | 0 | 5828 | 227 | لم يطبق |
| abdulbasit_abdulsamad_warsh_qdc — عبد الباسط عبد الصمد | warsh_an_nafi | quranicaudio | v1 مقبول / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| abdullah_al_buaijan_2025_yt — عبد الله البعيجان | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 90 | 11 | 13 | 0 | 6168 | 206 | لم يطبق |
| abdullah_al_mattrod_qdc — عبد الله المطرود | hafs_an_asim | quranicaudio | failed / لم يبدأ | 58 | 11 | 45 | 0 | 5898 | 206 | لم يطبق |
| abdullah_al_qarafi_mp3quran — عبد الله القرافي | hafs_an_asim | mp3quran | v1 مقبول / لم يبدأ | 46 | 7 | 61 | 0 | 5765 | 227 | لم يطبق |
| abdullah_kamel_way2quran — عبد الله كامل | hafs_an_asim | way2quran | failed / لم يبدأ | 35 | 6 | 73 | 0 | 4515 | 134 | لم يطبق |
| abdulwadood_haneef_mp3quran — عبد الودود حنيف | hafs_an_asim | mp3quran | failed / لم يبدأ | 51 | 7 | 56 | 0 | 5511 | 227 | لم يطبق |
| abdur_rashid_sufi_qdc — عبد الرشيد صوفي | hafs_an_asim | quranicaudio | failed / لم يبدأ | 62 | 7 | 45 | 0 | 5995 | 227 | لم يطبق |
| abdur_rashid_sufi_shubah_qdc — عبد الرشيد صوفي | shubah_an_asim | quranicaudio | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| abu_bakr_al_shatri_tarteel — أبو بكر الشاطري | hafs_an_asim | tarteel | failed / لم يبدأ | 34 | 8 | 72 | 0 | 4379 | 96 | لم يطبق |
| adel_al_karbalaei_archive_v2 — عادل الکربلائي | hafs_an_asim | archive_org | failed / لم يبدأ | 60 | 15 | 39 | 0 | 6052 | 226 | لم يطبق |
| ahmad_naseem_ali_ahmad_2019_yt — أحمد  نسيم على أحمد | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 50 | 7 | 57 | 0 | 5481 | 227 | لم يطبق |
| ahmed_al_ajmi_qdc — أحمد بن علي العجمي | hafs_an_asim | quranicaudio | failed / لم يبدأ | 32 | 13 | 69 | 0 | 4780 | 177 | لم يطبق |
| ahmed_amer_tvquran — أحمد عامر | hafs_an_asim | tvquran | failed / لم يبدأ | 56 | 4 | 54 | 0 | 5893 | 227 | لم يطبق |
| ahmed_deban_qalon_mp3quran — أحمد ديبان | qalon_an_nafi | mp3quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| ahmed_issa_al_maasaraawi_mp3quran — أحمد عيسى المعصراوي | hafs_an_asim | mp3quran | failed / لم يبدأ | 63 | 8 | 43 | 0 | 5971 | 227 | لم يطبق |
| ahmed_kaseb_way2quran — أحمد كاسب | hafs_an_asim | way2quran | failed / لم يبدأ | 53 | 9 | 52 | 0 | 5925 | 223 | لم يطبق |
| ahmed_nuayna_qdc — أحمد نعينع | hafs_an_asim | quranicaudio | failed / لم يبدأ | 57 | 5 | 52 | 0 | 6015 | 157 | لم يطبق |
| ahmed_saleh_rajab_qalon_way2quran — أحمد صالح رجب | qalon_an_nafi | way2quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| ahmed_saud_mp3quran — أحمد سعود | hafs_an_asim | mp3quran | v2 مقبول / لم يبدأ | 28 | 2 | 0 | 84 | 325 | 30 | لم يطبق |
| ahmed_shaheen_mp3quran — أحمد خليل شاهين | hafs_an_asim | mp3quran | failed / لم يبدأ | 51 | 5 | 58 | 0 | 5503 | 227 | لم يطبق |
| ahmed_talib_bin_humaid_mp3quran — أحمد طالب بن حميد | hafs_an_asim | mp3quran | failed / لم يبدأ | 42 | 10 | 55 | 7 | 4951 | 226 | لم يطبق |
| akram_al_alaqmi_qdc — أكرم العلاقمي | hafs_an_asim | quranicaudio | failed / لم يبدأ | 39 | 7 | 68 | 0 | 5233 | 227 | لم يطبق |
| ali_al_huthaifi_mp3quran — علي بن عبد الرحمن الحذيفي | hafs_an_asim | mp3quran | v1 مقبول / لم يبدأ | 49 | 3 | 62 | 0 | 5301 | 182 | لم يطبق |
| ayman_swed_muallim_yt — أيمن سويد | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 42 | 6 | 66 | 0 | 4881 | 163 | لم يطبق |
| badr_al_turki_yt — بدر التركي | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 50 | 6 | 58 | 0 | 5589 | 226 | لم يطبق |
| bandar_baleela_qdc — بندر بليلة | hafs_an_asim | quranicaudio | failed / لم يبدأ | 42 | 9 | 63 | 0 | 5284 | 182 | لم يطبق |
| fatih_seferagic_way2quran — فاتح سفراجيك | hafs_an_asim | way2quran | failed / لم يبدأ | 83 | 18 | 13 | 0 | 6167 | 227 | لم يطبق |
| haitham_al_dukhain_mp3quran — هيثم الدخين | hafs_an_asim | mp3quran | v1 مقبول / لم يبدأ | 43 | 14 | 57 | 0 | 5122 | 226 | لم يطبق |
| hani_al_rifai_qdc_128k — هاني الرفاعي | hafs_an_asim | quranicaudio | failed / لم يبدأ | 46 | 13 | 54 | 1 | 5695 | 101 | لم يطبق |
| ibrahim_al_akhdar_drive — إبراهيم الأخضر | hafs_an_asim | drive | source_unavailable / لم يبدأ | 78 | 6 | 30 | 0 | 6106 | 227 | لم يطبق |
| imad_zuhair_hafez_mp3quran — عماد زهير حافظ | hafs_an_asim | mp3quran | v1 مقبول / لم يبدأ | 52 | 3 | 59 | 0 | 5655 | 227 | لم يطبق |
| islam_sobhi_mp3quran — إسلام صبحي | hafs_an_asim | mp3quran | failed / لم يبدأ | 44 | 10 | 51 | 9 | 4683 | 226 | لم يطبق |
| khalid_al_mohana_drive — خالد المهنا | hafs_an_asim | drive | source_unavailable / لم يبدأ | 69 | 4 | 41 | 0 | 5973 | 227 | لم يطبق |
| khalifa_al_tunaiji_tarteel — خليفة الطنيجي | hafs_an_asim | tarteel | failed / لم يبدأ | 59 | 3 | 52 | 0 | 5922 | 227 | لم يطبق |
| maher_al_muaiqly_qdc — ماهر المعيقلي | hafs_an_asim | quranicaudio | failed / لم يبدأ | 59 | 2 | 53 | 0 | 5910 | 227 | لم يطبق |
| mahmoud_abdul_hakam_mp3quran — محمود عبدالحكم | hafs_an_asim | mp3quran | failed / لم يبدأ | 49 | 6 | 59 | 0 | 5660 | 227 | لم يطبق |
| mahmoud_ali_al_banna_qdc — محمود علي البنا | hafs_an_asim | quranicaudio | failed / لم يبدأ | 56 | 4 | 54 | 0 | 5815 | 227 | لم يطبق |
| mahmoud_khalil_al_husary_mp3quran — محمود خليل الحصري | hafs_an_asim | mp3quran | failed / لم يبدأ | 60 | 5 | 49 | 0 | 5907 | 227 | لم يطبق |
| mahmoud_khalil_al_husary_mujawwad_tarteel — محمود خليل الحصري | hafs_an_asim | tarteel | failed / لم يبدأ | 55 | 5 | 54 | 0 | 5656 | 226 | لم يطبق |
| mahmoud_khalil_al_husary_qdc_128k — محمود خليل الحصري | hafs_an_asim | quranicaudio | failed / لم يبدأ | 64 | 3 | 47 | 0 | 5929 | 227 | لم يطبق |
| mishary_rashid_al_afasy_2008_qdc — مشاري بن راشد العفاسي | hafs_an_asim | quranicaudio | failed / لم يبدأ | 47 | 4 | 63 | 0 | 5291 | 150 | لم يطبق |
| mishary_rashid_al_afasy_mp3quran — مشاري بن راشد العفاسي | hafs_an_asim | mp3quran | v2 مقبول / لم يبدأ | 53 | 5 | 56 | 0 | 5404 | 227 | لم يطبق |
| moaz_mahmoud_hamed_qalon_way2quran — معاذ محمود حامد | qalon_an_nafi | way2quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| mohammed_abdulkareem_qdc — محمد عبد الكريم | hafs_an_asim | quranicaudio | v1 مقبول / لم يبدأ | 35 | 12 | 67 | 0 | 4952 | 165 | لم يطبق |
| mohammed_al_luhaidan_mp3quran — محمد اللحيدان | hafs_an_asim | mp3quran | v1 مقبول / لم يبدأ | 44 | 9 | 61 | 0 | 5096 | 182 | لم يطبق |
| mohammed_alghazali_archive — محمد الغزالي | hafs_an_asim | archive_org | v2 مقبول / لم يبدأ | 38 | 8 | 68 | 0 | 5119 | 165 | لم يطبق |
| mohammed_ayyub_drive — محمد أيوب | hafs_an_asim | drive | source_unavailable / لم يبدأ | 51 | 6 | 57 | 0 | 5539 | 227 | لم يطبق |
| mohammed_burhaji_yt — محمد برهجي | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 46 | 6 | 62 | 0 | 5163 | 177 | لم يطبق |
| mohammed_saayed_warsh_mp3quran — محمد سايد | warsh_an_nafi | mp3quran | v1 مقبول / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| mohammed_siddiq_al_minshawi_1967_drive — محمد صديق المنشاوي | hafs_an_asim | drive | source_unavailable / لم يبدأ | 52 | 5 | 57 | 0 | 5689 | 227 | لم يطبق |
| mohammed_siddiq_al_minshawi_mp3quran — محمد صديق المنشاوي | hafs_an_asim | mp3quran | failed / لم يبدأ | 54 | 4 | 56 | 0 | 5766 | 227 | لم يطبق |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran — محمد صديق المنشاوي | hafs_an_asim | mp3quran | failed / لم يبدأ | 43 | 3 | 68 | 0 | 5281 | 227 | لم يطبق |
| muammar_zainal_al_sukaini_way2quran — معمر زينل السكيني | hafs_an_asim | way2quran | failed / لم يبدأ | 59 | 4 | 51 | 0 | 5806 | 227 | لم يطبق |
| mustafa_ismail_mp3quran — مصطفى إسماعيل | hafs_an_asim | mp3quran | failed / لم يبدأ | 62 | 4 | 48 | 0 | 5922 | 227 | لم يطبق |
| nasser_al_qatami_mp3quran — ناصر القطامي | hafs_an_asim | mp3quran | failed / لم يبدأ | 30 | 9 | 75 | 0 | 4518 | 140 | لم يطبق |
| saad_al_ghamdi_tarteel — سعد الغامدي | hafs_an_asim | tarteel | failed / لم يبدأ | 47 | 5 | 62 | 0 | 5481 | 226 | لم يطبق |
| saber_abdulhakam_qalon_way2quran — صابر عبد الحكم | qalon_an_nafi | way2quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| saber_abdulhakam_shubah_way2quran — صابر عبد الحكم | shubah_an_asim | way2quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| saber_abdulhakam_warsh_way2quran — صابر عبد الحكم | warsh_an_nafi | way2quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| saber_abdulhakam_yt — صابر عبد الحكم | hafs_an_asim | youtube | source_unavailable / لم يبدأ | 52 | 6 | 56 | 0 | 5630 | 226 | لم يطبق |
| saud_al_shuraim_mp3quran — سعود الشريم | hafs_an_asim | mp3quran | failed / لم يبدأ | 55 | 12 | 47 | 0 | 5794 | 227 | لم يطبق |
| walid_al_naihi_qalon_mp3quran — وليد النائحي | qalon_an_nafi | mp3quran | failed / لم يبدأ | 0 | 0 | 0 | 114 | 0 | 0 | لم يطبق |
| walid_atef_way2quran — وليد عاطف | hafs_an_asim | way2quran | failed / لم يبدأ | 37 | 6 | 71 | 0 | 4965 | 226 | لم يطبق |
| yasser_al_dosari_archive — ياسر الدوسري | hafs_an_asim | archive_org | failed / لم يبدأ | 38 | 7 | 69 | 0 | 5148 | 182 | لم يطبق |
