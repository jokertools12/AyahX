# K4 — فحص الصوت الآلي الاستشاري

نتيجة هذه البروفة: 69 تلاوة `unverified`، وصفر `auto_verified`، وصفر `confirmed`. نجح V1 لـ30 تلاوة ضمن نطاق المنشأ والبصمة المحدود أدناه. لا توجد نتيجة V2 حقيقية مقبولة حتى الآن، ولا عتبة متحدث مقبولة لـV3/V4. التفاصيل لكل تلاوة في [voice-auto-verification.json](voice-auto-verification.json). لا كتابة على القاعدة ولا اعتماد ترخيص أو نشر أو تغيير علم الإنتاج من هذه الأدوات.

`scripts/auto-verify-voices.py` ينتج تقريرًا من الكتالوج المثبت وأدلة مستقلة، بفاعل `auto-verifier-v1`. دالة القرار لا تملك مسارًا لإنتاج `confirmed`، وتطلب V1+V2، ثم V3/V4 عند توفر النموذج، مع استثناء V4 فقط لقارئ ذي تلاوة واحدة. YouTube بلا ملف صوت مرخص يبقى unverified؛ لا طلب صوت من YouTube.

V1 يستخدم تطابق اسم القارئ/المجلد الوصفي الموثق في المصدر الأصلي، لا خرائط الواجهة القديمة، ويطلب بصمة محتوى موثقة في فصلين على الأقل. فُحصت ملفات B الأصلية الـ144 من48 تلاوة ببصمة الملف الكامل وبصمة PCM لعينة ثابتة. صفر تعارض محتوى بين قارئين مختلفين ضمن هذه الملفات. هذا لا يغطي التلاوات الـ21 الأخرى، ولا يثبت أن محتوى مختلف الترميز أو مختلف نافذة الصوت غير متكرر. الاسم في مجلد أو قناة دليل منشأ؛ ليس إثبات هوية صوتية مطلقة.

ثبت فعليًا محليًا `SpeechBrain==1.0.3` مع `torch==2.5.1+cpu` و`torchaudio==2.5.1+cpu` و`huggingface-hub==0.28.1`؛ البيئة خارج Git في `%TEMP%/ayahx-d4-speaker-env`. النموذج [speechbrain/spkrec-ecapa-voxceleb](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/tree/0f99f2d0ebe89ac095bcc5903c4dd8f72b367286) مثبت على revision `0f99f2d0ebe89ac095bcc5903c4dd8f72b367286`، وSHA لكل ملف نموذج ضمن التقرير. اختير ECAPA صراحة؛ لا نموذج بديل صامت ولا اتصال inference مدفوع.

أول تحميل أخفق لأن `from_hparams` في SpeechBrain1.0.3 يحاول تحميل `custom.py` الاختياري المحلي، ويلتقط ValueError فقط بينما نظام الملفات يعيد FileNotFoundError. النموذج الرسمي لا يحتاج هذا الملف. شُخّص المصدر، ثم استُخدمت خطوات HyperPyYAML/Pretrainer الرسمية مباشرة مع `pretrained_path` إلى snapshot المثبت، و`LocalStrategy.COPY` بدل symlinks. نجح التنفيذ الثاني:144/144 ملفًا، صفر مصدر غير متاح، زمن القياس375.828 ثانية. غياب backend لـtorchaudio ظهر كتحذير؛ القراءة الفعلية تمت بـFFmpeg إلى PCM في الذاكرة، فلم تعتمد على ذلك الـbackend. لم يُحذف أو يُنقل أي ملف سابق، ولم يُنشأ ملف صوت جديد، ولم يُجلب صوت إضافي.

تثبيت البروتوكول سبق قياس التشابه: كل ملفات B المحفوظة، نافذة ثابتة تبدأ10000ms ومدتها25000ms، mono/16000Hz. كل بصمة مصدر كامل تُراجع قبل الفك. تقسيم القراء حسب IDs المرتبة: IDs متناوبة للمعايرة، والباقون للتحقق المستقل؛ الأزواج المختلفة تستخدم السورة نفسها، وأزواج تلاوات القارئ نفسه تستخدم السورة نفسها. لا إعادة اختيار بعد رؤية النتائج.

المعايرة تشمل93 زوجًا موسومًا «القارئ نفسه» و452 زوجًا «قارئان مختلفان» من تسميات الكتالوج، مع506 أزواج تحقق مستقلة. قاعدة استخراج العتبة المعلنة: منتصف أكبر cosine للقارئين المختلفين وأصغر cosine للقارئ نفسه، بشرط الفصل الكامل ثم عدم أخطاء في مجموعة التحقق. لكن الفئتين تداخلتا: أصغر same=0.31218403467271766 (المنشاوي مرتل/مجود، سورة85)، وأكبر different=0.5935472688947608 (المنشاوي/وليد عاطف، سورة97). لذلك `CALIBRATION_CLASSES_OVERLAP`، ولا عتبة تُمنح ولا نجاح V3/V4 يُدعى. درجات الاتساق المقيسة تبقى أدلة استشارية للمراجعة، ولا تعني `mismatch` آليًا. تسميات الأزواج من الكتالوج ليست بديلًا عن عينات ذهبية مؤكدة بشريًا؛ اتساق المتحدث يثبت الاتساق ولا يثبت هوية الاسم المطلقة.

V2: مصدر العقد الحقيقي `server/services/alignmentService.ts:externalProvider` يرسل `providerId/audio/reference/granularity/providerInput` في POST واحد، بلا fallback. الاستجابة الحالية لمحاذاة نص مفروض قد تحتوي words/confidence، لكنها لا تثبت السورة مستقلًا ولا توفر سياسة «ثقة عالية» معايرة. لا اخترعت عتبة V2 ولا استنتجت المحتوى من نجاح HTTP. قبول V2 في التقرير يتطلب استجابة حقيقية مرتبطة ببصمة الصوت والاستجابة، تغطية عينات1/112/36، ودليل تعرف مستقل يطابق المرجع المستورد مع معايرة موثقة للثقة.

أُعد `scripts/verify-voice-aligner-once.py` ليشغله root صراحة: طلب واحد، مهلة45s، رد≤1MiB، بلا redirects أو retry، أسرار endpoint/token من بيئة السيرفر فقط. HTTP402=`ALIGNMENT_QUOTA_PAYMENT_REQUIRED`،429=`ALIGNMENT_RATE_LIMITED` مع Retry-After،503=`ALIGNMENT_PROVIDER_UNAVAILABLE`. لا تسجَّل أجسام أخطاء المزوّد أو URL أو token. الاختيار صريح لـQUA أو `internal_ctc`، والأخير يدعم HTTP داخل `*.railway.internal` فقط وفق العقد الحالي؛ لا fallback بينهما. الحد الافتراضي30000ms؛ وافق root صراحة على حد120000ms لطلب واحد بفاتحة كاملة أصلية مقيسة. ادعاء مدة25s لرابط فصل كامل ليس قصًا ويُرفض `STANDALONE_SAMPLE_BYTES_DURATION_PROOF_REQUIRED_NO_FAKE_CROP`.

أُعد ملف طلب خاص لتلاوة عبد الودود حنيف: فاتحة كاملة32026.067ms بفحص ffprobe جديد، SHA المصدر الكامل `8ff3458a12ec2d994c36695f9acc8ffaf6b138476e361624f8206a498c6c63d6`، وآيات1–7 مستوردة من corpus القانوني ذي البصمةeca6…4fe4 دون تعديل. بصمة طلب JSON الخاص `e83190ac52f9fba9f28b431708219c7574c1a910b3f5aa5122a477bb1447829c`، وdry-run ناجح دون طلب شبكة. نفذ root وحده الطلب الحقيقي المحدود داخل خدمة التطبيق، بعد قراءة endpoint داخليًا دون طباعته؛ الأدلة الفعلية أدناه.

تحديث فعلي2026-10-10T14:16:56.042Z: نفّذ root طلبPOST واحدًا دون retries بعد تشخيصSSH وإيقاظ التطبيق بقراءةhealth. النتيجةHTTP404 `ALIGNMENT_HTTP_404`، وV2 يبقىunverified. السبب التشخيصي المثبت لدىroot: مسارendpoint المضبوط `/`، بينما مسار العامل الحقيقي `/v1/align`؛ لم يُعدّل endpoint ولم يُرسلPOST ثانٍ. رُبط [d4-k4-aligner-probe.json](d4-k4-aligner-probe.json) ببصمة `c59e17ff487d62d8c6b54abaf0cb8dfd82aeeb1364c6312d4ee947bc639ac2cf` وببصمتي الطلب والصوت المذكورتين. هذه404 لا تُفسر وحدها حالة المحرك.

قراءاتGET الفعلية المستقلة2026-10-10T14:24:12.526Z: `/health/live` أعاد200/alive، و`/health/ready` أعاد503/`MODEL_NOT_CONFIGURED`. رُبط [d4-k4-aligner-readiness.json](d4-k4-aligner-readiness.json) ببصمة `2f6c89a3bf828a6a4adfa49b32a6039de103f3b81db9845d40452073529b54f2`؛ يحتوي `alignment_posts=0`. بذلك توجد مشكلة مسار مثبتة فيPOST ومشكلة محرك مثبتة بقراءةready مستقلة؛ لا إعادة طلب ولا مزوّد بديل ولا اعتمادV2. تقرير الصوت يحفظ المشاهدتين وبصماتهما دون استبدال أدلةECAPA الأصلية.

التشغيل الفعلي المحلي، ببيئة Python الموثقة في dev-environment:

```powershell
& $python scripts/measure-voice-speakers.py --identity docs/data/voice-identity-report.json --retained-evidence docs/data/d3-audio-failure-diagnosis-v2.json --ffmpeg $ffmpeg --model-dir "$env:TEMP/ayahx-d4-ecapa-model" --out "$env:TEMP/ayahx-d4-speaker-measurements.json"
& $python scripts/auto-verify-voices.py --catalog "$env:TEMP/ayahx-d2/catalog.json" --identity docs/data/voice-identity-report.json --speakers "$env:TEMP/ayahx-d4-speaker-measurements.json" --out docs/data/voice-auto-verification.json
```

بصمة دليل القياس الكامل الخاص: `766b39869f8195a330863aaaee970b51c5cfce5e328e58237c4bcf7caabb02fe`، خارج Git دون صوت جديد. السكربت المحلي يدعم `--alignment` لتقرير V2 الحقيقي و`--youtube-metadata` لأدلة oEmbed/ملفات مرخصة لاحقة؛ كل إعادة تنتج بصمات المدخلات في التقرير، ولا تغيّر النص القانوني.

K7 قبل القياس: أُصلح العيب الذي كان يمرر `round(score,8)` إلى قرار T7. `raw_compare` يحفظ score الخام ويفصل `score_display`؛ اختبار بإشارة حقيقية مصطنعة يعطي0.949999996999995: المسار السابق يقبل بعد عرضه0.95، والمصحح يرفض. نجحت الاختبارات offline:25 executor و11 preparer و3 host-snapshot، و12 وحدة K4، منها عدم إنتاج confirmed، تغطية الإخوة، رفض معايرة متداخلة، طلب Aligner مرة واحدة مع402/429/503، وحد120000ms الصريح مع مزوّدinternal_ctc، وحجب الخطأ والأسرار، وربط ملاحظاتPOST/GET دون منحV2. لا تغير للmanifest ولا قياس T7 قبل GO منroot بعد K2–K4.

بنود المراجعة: تأكيد صوت كل69 تلاوة، النواقص خارج B، إثبات محتوى V2، معايرة متحدث أوسع بعينات مؤكدة عبر الأنماط، ومقارنة المنشاوي مرتل/مجود المذكورة دون اتهام أنها صوت آخر. الثمانية YouTube تحتاج ملفات مرخصة قبل أي فحص محتوى أو اتساق فعلي.

| التلاوة | V1 | V2 | V3 | V4 | الحالة |
|---|---|---|---|---|---|
| abdul_hamid_ghraio_2025_yt | unverified | unverified | unverified | unverified | unverified |
| abdul_hamid_ghraio_2026_yt | unverified | unverified | unverified | unverified | unverified |
| abdulaziz_al_turki_yt | unverified | unverified | unverified | not_applicable | unverified |
| abdulbasit_abdulsamad_mujawwad_tarteel | passed | unverified | unverified | unverified | unverified |
| abdulbasit_abdulsamad_tarteel | passed | unverified | unverified | unverified | unverified |
| abdulbasit_abdulsamad_warsh_qdc | unverified | unverified | unverified | unverified | unverified |
| abdullah_al_buaijan_2025_yt | unverified | unverified | unverified | not_applicable | unverified |
| abdullah_al_mattrod_qdc | passed | unverified | unverified | not_applicable | unverified |
| abdullah_al_qarafi_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| abdullah_kamel_way2quran | passed | unverified | unverified | not_applicable | unverified |
| abdulwadood_haneef_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| abdur_rashid_sufi_qdc | passed | unverified | unverified | unverified | unverified |
| abdur_rashid_sufi_shubah_qdc | passed | unverified | unverified | unverified | unverified |
| abu_bakr_al_shatri_tarteel | passed | unverified | unverified | not_applicable | unverified |
| adel_al_karbalaei_archive_v2 | unverified | unverified | unverified | not_applicable | unverified |
| ahmad_naseem_ali_ahmad_2019_yt | unverified | unverified | unverified | not_applicable | unverified |
| ahmed_al_ajmi_qdc | passed | unverified | unverified | not_applicable | unverified |
| ahmed_amer_tvquran | unverified | unverified | unverified | not_applicable | unverified |
| ahmed_deban_qalon_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| ahmed_issa_al_maasaraawi_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| ahmed_kaseb_way2quran | passed | unverified | unverified | not_applicable | unverified |
| ahmed_nuayna_qdc | passed | unverified | unverified | not_applicable | unverified |
| ahmed_saleh_rajab_qalon_way2quran | passed | unverified | unverified | not_applicable | unverified |
| ahmed_saud_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| ahmed_shaheen_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| ahmed_talib_bin_humaid_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| akram_al_alaqmi_qdc | passed | unverified | unverified | not_applicable | unverified |
| ali_al_huthaifi_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| ayman_swed_muallim_yt | unverified | unverified | unverified | not_applicable | unverified |
| badr_al_turki_yt | unverified | unverified | unverified | not_applicable | unverified |
| bandar_baleela_qdc | passed | unverified | unverified | not_applicable | unverified |
| fatih_seferagic_way2quran | passed | unverified | unverified | not_applicable | unverified |
| haitham_al_dukhain_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| hani_al_rifai_qdc_128k | passed | unverified | unverified | not_applicable | unverified |
| ibrahim_al_akhdar_drive | unverified | unverified | unverified | not_applicable | unverified |
| imad_zuhair_hafez_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| islam_sobhi_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| khalid_al_mohana_drive | unverified | unverified | unverified | not_applicable | unverified |
| khalifa_al_tunaiji_tarteel | passed | unverified | unverified | not_applicable | unverified |
| maher_al_muaiqly_qdc | passed | unverified | unverified | not_applicable | unverified |
| mahmoud_abdul_hakam_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| mahmoud_ali_al_banna_qdc | passed | unverified | unverified | not_applicable | unverified |
| mahmoud_khalil_al_husary_mp3quran | unverified | unverified | unverified | unverified | unverified |
| mahmoud_khalil_al_husary_mujawwad_tarteel | passed | unverified | unverified | unverified | unverified |
| mahmoud_khalil_al_husary_qdc_128k | passed | unverified | unverified | unverified | unverified |
| mishary_rashid_al_afasy_2008_qdc | passed | unverified | unverified | unverified | unverified |
| mishary_rashid_al_afasy_mp3quran | unverified | unverified | unverified | unverified | unverified |
| moaz_mahmoud_hamed_qalon_way2quran | passed | unverified | unverified | not_applicable | unverified |
| mohammed_abdulkareem_qdc | unverified | unverified | unverified | not_applicable | unverified |
| mohammed_al_luhaidan_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| mohammed_alghazali_archive | passed | unverified | unverified | not_applicable | unverified |
| mohammed_ayyub_drive | unverified | unverified | unverified | not_applicable | unverified |
| mohammed_burhaji_yt | unverified | unverified | unverified | not_applicable | unverified |
| mohammed_saayed_warsh_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| mohammed_siddiq_al_minshawi_1967_drive | unverified | unverified | unverified | unverified | unverified |
| mohammed_siddiq_al_minshawi_mp3quran | unverified | unverified | unverified | unverified | unverified |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | unverified | unverified | unverified | unverified | unverified |
| muammar_zainal_al_sukaini_way2quran | passed | unverified | unverified | not_applicable | unverified |
| mustafa_ismail_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| nasser_al_qatami_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| saad_al_ghamdi_tarteel | passed | unverified | unverified | not_applicable | unverified |
| saber_abdulhakam_qalon_way2quran | passed | unverified | unverified | unverified | unverified |
| saber_abdulhakam_shubah_way2quran | passed | unverified | unverified | unverified | unverified |
| saber_abdulhakam_warsh_way2quran | passed | unverified | unverified | unverified | unverified |
| saber_abdulhakam_yt | unverified | unverified | unverified | unverified | unverified |
| saud_al_shuraim_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| walid_al_naihi_qalon_mp3quran | unverified | unverified | unverified | not_applicable | unverified |
| walid_atef_way2quran | passed | unverified | unverified | not_applicable | unverified |
| yasser_al_dosari_archive | passed | unverified | unverified | not_applicable | unverified |
