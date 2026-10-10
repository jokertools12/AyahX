# بدائل مصادر التلاوات غير المتاحة — التشخيص B

فُحصت الحالات المستخرجة من دليل D2 الأصلي، دون كتابة DB أو Railway أو طلبات محاذاة أو اتصال بـ HF datasets. مرجع المصدر QUD Release `v3.2.0`، وبصمة catalog هي `b7ee26c2267b086d5758477e21144887c28c6ba884a6ff5157a55cf17df4eed4`. يثبت التقرير JSON أن دليل v1 في Git لم يتغير منذ `f171d98`. بصمة دليل الجذر المحتفظ به هي `e071bf483c7b44c9157c49cc15287c9aa11ed598d777bfff2bdcb1e8a449a0b9`، وحجمه 530675 بايت، مقابل 530676 بايت لنسخة Windows و514561 بايت لـ Git. اختلاف البصمات سببه CRLF وnewline نهائية؛ نجح حارسا `semantic_equal=true` و`newline_normalized_equal=true`، ولم تتغير النتائج الأصلية.

أعاد Aligner العام `GET /audio-recitations` عددًا فعليًا قدره 2163 سجلًا، و`GET /recitations` عددًا قدره 93 سجلًا. الحالات الـ13 موجودة كلها في القائمة المراجَعة، بتطابق slug وreciter_id ومجموعة أرقام السور مع catalog المثبت. لا تظهر أي منها في قائمة audio-only، وهذا يطابق تعريف API: تلك القائمة تخص التلاوات ذات الصوت دون مقاطع مراجَعة.

عقد API الصحيح هو [openapi.json تحت /api/v1](https://hetchyy-quranic-universal-aligner.hf.space/api/v1/openapi.json)؛ ملف `/openapi.json` في الجذر عقد Gradio آخر. بصمة العقد الصحيح: `c9a042f6f6f4e4482d22d2542c987b2d641f2e0e9e5a254f37e4c245d546f430`.

لكل حالة، أعاد `GET /recitations/{slug}/chapters/112/audio` رابطًا عامًا غير موقّع على Space نفسه. نجحت HEAD بالرمز 200 و`audio/mpeg`، وGET مع `Range: bytes=0-1023` بالرمز 206؛ وقُرئت 1024 بايت في الذاكرة فقط لكل تلاوة. لم يتبع هذا الفحص أي redirect ولم يحفظ صوت Space محليًا. يُظهر [كود route المثبت](https://huggingface.co/spaces/hetchyy/quranic-universal-aligner/raw/ad3222b8870ffe9faf6b48d1bac9d32a16a8b10d/src/ui/preload_audio_route.py) أن مسار الجلب المصرح به يقرأ MP3 موجودًا من mount للقراءة فقط ويعيد FileResponse؛ لا طلب قص أو استخراج YouTube. المصدر الأصلي للقنوات مسجل كما هو، ولا تُستنتج منه رخصة جديدة.

| تلاوة QUD | القناة الأصلية | سور metadata، QUD/Space | HEAD / Range لسورة 112 | حجم MP3 على Space، بايت | Drive العام |
|---|---|---:|---|---:|---|
| `abdul_hamid_ghraio_2025_yt` | youtube | 114/114 | 200 / 206 | 342444 | مستبعد من أي جلب YouTube |
| `abdul_hamid_ghraio_2026_yt` | youtube | 114/114 | 200 / 206 | 363134 | مستبعد من أي جلب YouTube |
| `abdulaziz_al_turki_yt` | youtube | 112/112 | 200 / 206 | 589992 | مستبعد من أي جلب YouTube |
| `abdullah_al_buaijan_2025_yt` | youtube | 114/114 | 200 / 206 | 526044 | مستبعد من أي جلب YouTube |
| `ahmad_naseem_ali_ahmad_2019_yt` | youtube | 114/114 | 200 / 206 | 495952 | مستبعد من أي جلب YouTube |
| `ayman_swed_muallim_yt` | youtube | 114/114 | 200 / 206 | 830736 | مستبعد من أي جلب YouTube |
| `badr_al_turki_yt` | youtube | 114/114 | 200 / 206 | 537956 | مستبعد من أي جلب YouTube |
| `ibrahim_al_akhdar_drive` | drive | 114/114 | 200 / 206 | 494293 | صفحة تأكيد Virus scan؛ لم تُتبع |
| `khalid_al_mohana_drive` | drive | 114/114 | 200 / 206 | 501687 | صفحة تأكيد Virus scan؛ لم تُتبع |
| `mohammed_ayyub_drive` | drive | 114/114 | 200 / 206 | 519988 | صفحة تأكيد Virus scan؛ لم تُتبع |
| `mohammed_burhaji_yt` | youtube | 114/114 | 200 / 206 | 444542 | مستبعد من أي جلب YouTube |
| `mohammed_siddiq_al_minshawi_1967_drive` | drive | 114/114 | 200 / 206 | 447050 | تنزيل MP3 عام كامل، عينة فقط |
| `saber_abdulhakam_yt` | youtube | 114/114 | 200 / 206 | 600024 | مستبعد من أي جلب YouTube |

فحص Drive استعمل رابط `/file/d/{id}/view` المثبت، ثم التنزيل العام العادي `/uc?export=download&id={id}`، دون كوكيز أو توكن أو معاملات confirm. ثلاثة ملفات أعادت HTTP 200 مع HTML بعنوان `Google Drive - Virus scan warning`؛ لم تُتبع نماذج التأكيد، ولم تُستخدم طريقة أخرى لتجاوز حماية أو حصة. هذه استجابة متاحة تحتاج تأكيدًا، وليست إثباتًا أن التسجيل اختفى أو أن الوصول البرمجي ممنوع بشروط المصدر.

ملف `mohammed_siddiq_al_minshawi_1967_drive` لسورة 112 نُزّل كاملًا: 446380 بايت، وبصمة `6ea6a4fe677fbd41ad3ee051066c84a0f2674d9e44663eec2478ff60d9b44b89`. نجح ffprobe بالرمز 0: MP3، قناتان، 44100 Hz، ومدة 18599 ms. حد القراءة 81920 بايت/ثانية. هذا تدقيق محلي؛ لم يُرفع الصوت أو يُعاد استضافته.

فحوص Space متتابعة، بهدف فاصل 4000 ms، وأقل فاصل بداية مُلاحظ 3988 ms. فحوص Drive وredirects الطبيعية بفاصل مستهدف 5000 ms. لكل ملف محاولة تنزيل مستقلة واحدة؛ لا تسارع ولا إعادة محاولة لحالة تأكيد.

هذه بدائل متاحة لعينة سورة واحدة لكل تلاوة، وليست قبول offset أو ترخيص نشر. تبقى نتائج v1 `source_unavailable` كما هي؛ ولا تُصبح التلاوات منشورة بسبب نجاح HEAD/Range. تطابق metadata لا يثبت تطابق الموجة الصوتية أو الحقوق. يجب التحقق من الصوت الذي سيُخدم فعلًا أو إعادة محاذاته في D5، ثم تدقيق license/attribution والفصول التي ستُنشر.

يختلف أصل الإحداثيات: Space يخدم ملف سورة منفصلًا، بينما catalog قد يشير إلى ملف مشترك مع chapter_offset. أمثلة سورة 112: الأخضر 3762170 ms، والمهنا 3757655 ms، وأيوب 3770130 ms. لا يُطبق source_offset القديم تلقائيًا على الرابط البديل، ولا يُضاف تحويل إحداثيات خارج المكان المعتمد في الخطة.

لم يُكتشف في هذا المسار شرط استخدام جديد صريح يمنع الوصول البرمجي. لم تُراجع حقوق تسجيلات الصوت مراجعة مكتملة، ولذلك بقي `audio_license_verified=false` في التقرير. YouTube مستبعد مسبقًا؛ صفر طلبات إلى صفحاته أو media، وصفر extraction أو POST.

حالة التنظيف `manual_cleanup_required`: لا محاولة حذف أو نقل أو تعديل ACL. بقي ملف الصوت الوحيد ومخرجات metadata العامة في scratch الخاص `%TEMP%\ayahx-d3-source-alternatives` وفق تعليمات الجذر بعد الرفض السابق. لا صوت أو Parquet أو روابط موقعة أو credentials في Git.

الأدلة التفصيلية وتوقيتات GET/HEAD/Range وبصمات الردود في [d3-source-alternatives.json](d3-source-alternatives.json). يمكن إعادة فحص العينة دون محاذاة باستخدام GET لنقطة `.../chapters/112/audio` ثم HEAD وGET Range للرابط المعاد؛ ولا يحفظ هذا التدقيق أي رابط موقّع في Git أو يتبع مضيفًا غير معتمد.
