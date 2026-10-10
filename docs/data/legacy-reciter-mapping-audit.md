# تدقيق خريطة القراء القديمة — D4 / T5

تدقيق استشاري للمصدر عند `ec593cf689a1402155fe41f2016720c82ef78118` ولـ QUD Release v3.2.0، بتاريخ 2026-10-10T09:54:51.736Z. لا تعديل للواجهة أو الريندر أو القاعدة، ولا قرار تأكيد صوت. الملف [voice-identity-report.json](voice-identity-report.json) يحفظ كل الصفوف والبصمات.

## النتيجة التي تثبتها القراءة

قورنت 70 خانة قديمة مع 69 تلاوة / 57 قارئًا و7765 رابط سورة. عدد روابط/معرّفات الملفات المشتركة بين قارئين مختلفين في الكتالوج: 0. لا يثبت ذلك اختلاف الملفات في روابط مختلفة؛ لم يُجر تدقيق شامل للمحتوى أو استماع بشري. لم يُفحص صوت فعلي للاستماع أو البصمة؛ وجد خطأ resolver أسماء قديمًا يختار معرّف قارئ آخر لكنه غير نشط، كما هو موثق أدناه.

يوجد اختلاف مثبت في **اختيار التسجيل أو وصف الأسلوب**. عندما يفشل QUA، ينتقل PreviewPage إلى EveryAyah ثم الرابط الكامل القديم؛ ليست هذه الروابط بصمات مثبتة لنفس التسجيل. مرحلة Quran Foundation القديمة معطلة فعليًا بـ `legacyQuranFoundationEnabled() => false` (PreviewPage:94)، رغم بقاء المعرفات. ترتيب التنفيذ الفعلي QUA:864، Quran Foundation المعطل:912، EveryAyah:1026، الرابط الكامل:1113. أسماء الحالات القديمة لا تمثل نموذج تلاوة مستقلًا. كما أن معاينة CreatePage:535 تفضّل EveryAyah مباشرة، بينما PreviewPage يفضّل QUA؛ قد يُسمع تسجيلان مختلفان للقارئ نفسه بين الصفحتين.

## خطأ مثبت في resolver أسماء QF القديم (غير نشط)

الدالة الفعلية `resolveRecitationIdByName` في `src/lib/quranFoundationApi.ts:74–93` تحتسب نقاط `Murattal` أو `style=null` حتى إذا كان `nameHit=false`، ثم تقبل كل `score>0`. شُغّلت الدالة دون تعديل عبر TypeScript transpile على استجابة المورد العام الحية HTTP200/12 عند 2026-10-10T09:56:36.573Z:

| الاسم المطلوب | ID الراجع | الاسم الفعلي في قائمة المورد |
|---|---|---|
| Maher Al Muaiqly | 2 | AbdulBaset AbdulSamad |
| Reader Not In Catalog | 2 | AbdulBaset AbdulSamad |
| (فارغ) | null | — |

إذًا يمكن لهذه الدالة **توجيه اسم غير مطابق إلى قارئ آخر**. هذا فشل ربط اسم مثبت، وليس استماعًا أو بصمة صوت. فحص `rg -n resolveRecitationIdByName src server` وجد التعريف فقط، وPreviewPage يعطّل مسار QF. لذلك لا دليل أنه سبب الشكوى الحالية. لم نطلب أي صوت، ولم نغيّر الكود. تسجيل تلاوتين فعليتين لقارئين مختلفين على نفس ملف في الكتالوج لم يحدث؛ نقطة التوقف الخاصة بذلك غير مفعّلة. في D8 تزال هذه الآلية أو ترفض `!nameHit` صراحةً مع اختبار انحدار، دون إصلاح سلوك الواجهة الآن.

## مواضع اختلاف التسجيل/الأسلوب

| الخريطة القديمة | الدليل من المصدر | الأثر المحتمل | حدود الاستنتاج |
|---|---|---|---|
| الحصري مرتل/مجود/ترتيل/معلم | `mahmoud_husary_murattal` / `mahmoud_husary_mujawwad` / `mahmoud_husary_tarteel` / `husary_muallim` كلها `server13.mp3quran.net/husr/001.mp3`؛ المجود يملك QUA tarteel مستقلًا والمعلم EveryAyah مختلفًا | فشل المصدر المتخصص ينقل الاختيار إلى مصدر المرتل المشترك؛ خيارات أسلوب مختلفة تنتهي للصوت نفسه | نفس اسم القارئ؛ ليس دليل هوية قارئ آخر |
| المنشاوي مرتل/مجود | الخانتان `server10.mp3quran.net/minsh/001.mp3`؛ EveryAyah مختلف؛ QUD المجود الحقيقي `minsh/Almusshaf-Al-Mojawwad/001.mp3` | fallback المجود يستعمل المصدر المشترك مع المرتل بدل مجلد المجود | اختلاف تسجيل/أسلوب، لا حكم صوت بشري |
| البنا مرتل/مجود | الخانتان `server8.mp3quran.net/bna/001.mp3`؛ EveryAyah مختلف؛ QUD المتاح QDC murattal | الأسلوب المعلن لا يضمن تسجيلًا مجودًا عند fallback | التسجيل المختلف يحتاج مراجعة بشرية |
| مصطفى إسماعيل مرتل/مجود | كلاهما `server8.mp3quran.net/mustafa/001.mp3` ونفس `mustafa_ismail_mp3quran`؛ QUD يصنفه murattal | اختيار المجود يُحل أصلًا إلى تلاوة QUD المرتل، قبل fallback | اختلاف metadata؛ لا استماع ولا إثبات قارئ آخر |
| ماهر المعيقلي | الواجهة style=مرتل، QUA=`maher_al_muaiqly_qdc` مصنف QUD mujawwad ومجلد `maher_almu3aiqly/year1440`؛ fallback `server12/maher` وEveryAyah مستقلان | وصف الأسلوب/التسجيل يتغير؛ لا يُعدّل QUD أو الواجهة آليًا | احتمال توصيف metadata يحتاج قرارًا بشريًا |

## التلاوات المتعددة للقارئ الواحد

7 قراء لهم أكثر من تلاوة. الاختلافات أدناه مدخلات خيارات إدارة مستقلة؛ لا تسمح باستبدال بينها. 54 أسماء/مجلدات قابلت transliterations أو aliases وصفية، و15 مصدرًا بمعرف opaque لا يثبت الاسم. لا تعني مطابقة المجلد تأكيد صوت.

| القارئ | المصادر / الأساليب / الروايات | سنوات معلومة |
|---|---|---|
| عبدالحميد القريو | abdul_hamid_ghraio_2025_yt: youtube/murattal/hafs_an_asim<br>abdul_hamid_ghraio_2026_yt: youtube/murattal/hafs_an_asim | 2025, 2026 |
| عبد الباسط عبد الصمد | abdulbasit_abdulsamad_mujawwad_tarteel: tarteel/mujawwad/hafs_an_asim<br>abdulbasit_abdulsamad_tarteel: tarteel/murattal/hafs_an_asim<br>abdulbasit_abdulsamad_warsh_qdc: quranicaudio/murattal/warsh_an_nafi | غير معلومة |
| عبد الرشيد صوفي | abdur_rashid_sufi_qdc: quranicaudio/murattal/hafs_an_asim<br>abdur_rashid_sufi_shubah_qdc: quranicaudio/murattal/shubah_an_asim | غير معلومة |
| محمود خليل الحصري | mahmoud_khalil_al_husary_mp3quran: mp3quran/murattal/hafs_an_asim<br>mahmoud_khalil_al_husary_mujawwad_tarteel: tarteel/mujawwad/hafs_an_asim<br>mahmoud_khalil_al_husary_qdc_128k: quranicaudio/murattal/hafs_an_asim | غير معلومة |
| مشاري بن راشد العفاسي | mishary_rashid_al_afasy_2008_qdc: quranicaudio/murattal/hafs_an_asim<br>mishary_rashid_al_afasy_mp3quran: mp3quran/murattal/hafs_an_asim | 2008 |
| محمد صديق المنشاوي | mohammed_siddiq_al_minshawi_1967_drive: drive/murattal/hafs_an_asim<br>mohammed_siddiq_al_minshawi_mp3quran: mp3quran/murattal/hafs_an_asim<br>mohammed_siddiq_al_minshawi_mujawwad_mp3quran: mp3quran/mujawwad/hafs_an_asim | 1967 |
| صابر عبد الحكم | saber_abdulhakam_qalon_way2quran: way2quran/murattal/qalon_an_nafi<br>saber_abdulhakam_shubah_way2quran: way2quran/murattal/shubah_an_asim<br>saber_abdulhakam_warsh_way2quran: way2quran/murattal/warsh_an_nafi<br>saber_abdulhakam_yt: youtube/murattal/hafs_an_asim | غير معلومة |

## جرد الخريطة كاملة

عدم وجود تلاوة مقابلة في المصدر المثبت لا يعني أن القارئ غير موجود أو أن رابطه خطأ. المقابلات غير المباشرة أدناه اقتراحات مطابقة أسماء فقط؛ ليست إثبات تطابق التسجيل. `—` يعني غير مضبوط أو لم يُعثر على مقابل؛ ليس fallback جديدًا.

| ID القديم | الاسم / الأسلوب / الرواية | EveryAyah | QF القديم | QUA المباشر | قارئ الكتالوج المقترح |
|---|---|---|---|---|---|
| mishary_alafasy | مشاري راشد العفاسي / مرتل / حفص عن عاصم | Alafasy_128kbps | 7 | mishary_rashid_al_afasy_mp3quran | mishary_rashid_al_afasy |
| abdul_basit_murattal | عبد الباسط عبد الصمد / مرتل / حفص عن عاصم | Abdul_Basit_Murattal_64kbps | 2 | abdulbasit_abdulsamad_tarteel | abdulbasit_abdulsamad |
| mahmoud_husary_murattal | محمود خليل الحصري / مرتل / حفص عن عاصم | Husary_64kbps | 6 | mahmoud_khalil_al_husary_mp3quran | mahmoud_khalil_al_husary |
| minshawi_murattal | محمد صديق المنشاوي / مرتل / حفص عن عاصم | Minshawy_Murattal_128kbps | 9 | mohammed_siddiq_al_minshawi_mp3quran | mohammed_siddiq_al_minshawi |
| maher_muaiqly | ماهر المعيقلي / مرتل / حفص عن عاصم | MaherAlMuaiqly128kbps | — | maher_al_muaiqly_qdc | maher_al_muaiqly |
| saud_shuraim | سعود الشريم / مرتل / حفص عن عاصم | Saood_ash-Shuraym_128kbps | 10 | saud_al_shuraim_mp3quran | saud_al_shuraim |
| abdul_rahman_sudais | عبد الرحمن السديس / مرتل / حفص عن عاصم | Abdurrahmaan_As-Sudais_192kbps | 3 | — | — |
| abu_bakr_shatri | أبو بكر الشاطري / مرتل / حفص عن عاصم | Abu_Bakr_Ash-Shaatree_128kbps | 4 | abu_bakr_al_shatri_tarteel | abu_bakr_al_shatri |
| saad_ghamdi | سعد الغامدي / مرتل / حفص عن عاصم | Ghamadi_40kbps | — | — | saad_al_ghamdi |
| ahmad_ajmi | أحمد بن علي العجمي / مرتل / حفص عن عاصم | Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net | — | — | ahmed_al_ajmi |
| hani_rifai | هاني الرفاعي / مرتل / حفص عن عاصم | Hani_Rifai_192kbps | 5 | — | hani_al_rifai |
| fares_abbad | فارس عباد / مرتل / حفص عن عاصم | Fares_Abbad_64kbps | — | — | — |
| yasser_dosari | ياسر الدوسري / مرتل / حفص عن عاصم | Yasser_Ad-Dussary_128kbps | 97 | — | yasser_al_dosari |
| nasser_qatami | ناصر القطامي / مرتل / حفص عن عاصم | Nasser_Alqatami_128kbps | — | nasser_al_qatami_mp3quran | nasser_al_qatami |
| bandar_baleela | بندر بليلة / مرتل / حفص عن عاصم | — | — | — | bandar_baleela |
| abdullah_matrood | عبد الله المطرود / مرتل / حفص عن عاصم | Abdullah_Matroud_128kbps | — | — | abdullah_al_mattrod |
| khaled_jaleel | خالد الجليل / مرتل / حفص عن عاصم | — | — | — | — |
| abdulbari_thubaity | عبد الباري الثبيتي / مرتل / حفص عن عاصم | — | — | — | — |
| ali_jaber | علي جابر / مرتل / حفص عن عاصم | Ali_Jaber_64kbps | — | — | — |
| abdullah_awad_juhany | عبد الله عواد الجهني / مرتل / حفص عن عاصم | Abdullaah_3awwaad_Al-Juhaynee_128kbps | — | — | — |
| muhammad_luhaidan | محمد اللحيدان / مرتل / حفص عن عاصم | — | — | — | mohammed_al_luhaidan |
| salah_budair | صلاح البدير / مرتل / حفص عن عاصم | Salah_Al_Budair_128kbps | — | — | — |
| idris_abkar | إدريس أبكر / مرتل / حفص عن عاصم | — | — | — | — |
| islam_sobhi | إسلام صبحي / مرتل / حفص عن عاصم | — | — | islam_sobhi_mp3quran | islam_sobhi |
| raad_kurdi | رعد الكردي / مرتل / حفص عن عاصم | — | — | — | — |
| abdullah_basfar | عبد الله بصفر / مرتل / حفص عن عاصم | Abdullah_Basfar_192kbps | — | — | — |
| mansour_salimi | منصور السالمي / مرتل / حفص عن عاصم | — | — | — | — |
| hazza_albalushi | هزاع البلوشي / مرتل / حفص عن عاصم | Hazza_Al-Balushi_128kbps | — | — | — |
| mahmoud_ali_albanna | محمود علي البنا / مرتل / حفص عن عاصم | mahmoud_ali_al_banna_32kbps | — | mahmoud_ali_al_banna_qdc | mahmoud_ali_al_banna |
| khalifa_tunaiji | خليفة الطنيجي / مرتل / حفص عن عاصم | khalefa_al_tunaiji_64kbps | — | khalifa_al_tunaiji_tarteel | khalifa_al_tunaiji |
| wadih_yamani | وديع اليمني / مرتل / حفص عن عاصم | — | — | — | — |
| abdullah_al_qarafi | عبد الله القرافي / مرتل / حفص عن عاصم | — | — | abdullah_al_qarafi_mp3quran | abdullah_al_qarafi |
| abdulwadood_haneef | عبد الودود حنيف / مرتل / حفص عن عاصم | — | — | abdulwadood_haneef_mp3quran | abdulwadood_haneef |
| abdur_rashid_sufi | عبد الرشيد صوفي / مرتل / حفص عن عاصم | — | — | abdur_rashid_sufi_qdc | abdur_rashid_sufi |
| ahmed_amer | أحمد عامر / مرتل / حفص عن عاصم | — | — | ahmed_amer_tvquran | ahmed_amer |
| ahmed_issa_al_maasaraawi | أحمد عيسى المعصراوي / مرتل / حفص عن عاصم | — | — | ahmed_issa_al_maasaraawi_mp3quran | ahmed_issa_al_maasaraawi |
| ahmed_shaheen | أحمد خليل شاهين / مرتل / حفص عن عاصم | — | — | ahmed_shaheen_mp3quran | ahmed_shaheen |
| ali_al_huthaifi | علي بن عبد الرحمن الحذيفي / مرتل / حفص عن عاصم | — | — | ali_al_huthaifi_mp3quran | ali_al_huthaifi |
| mahmoud_abdul_hakam | محمود عبدالحكم / مرتل / حفص عن عاصم | — | — | mahmoud_abdul_hakam_mp3quran | mahmoud_abdul_hakam |
| mohammed_alghazali | محمد الغزالي / مرتل / حفص عن عاصم | — | — | mohammed_alghazali_archive | mohammed_alghazali |
| mustafa_ismail_murattal | مصطفى إسماعيل / مرتل / حفص عن عاصم | — | — | mustafa_ismail_mp3quran | mustafa_ismail |
| abdul_basit_mujawwad | عبد الباسط عبد الصمد - مجود / مجود / حفص عن عاصم | Abdul_Basit_Mujawwad_128kbps | 1 | — | abdulbasit_abdulsamad |
| mahmoud_husary_mujawwad | محمود خليل الحصري - مجود / مجود / حفص عن عاصم | Husary_128kbps_Mujawwad | 6 | mahmoud_khalil_al_husary_mujawwad_tarteel | mahmoud_khalil_al_husary |
| minshawi_mujawwad | محمد صديق المنشاوي - مجود / مجود / حفص عن عاصم | Minshawy_Mujawwad_192kbps | 8 | — | mohammed_siddiq_al_minshawi |
| mohammad_tablawi | محمد الطبلاوي - مجود / مجود / حفص عن عاصم | Mohammad_al_Tablaway_128kbps | 11 | — | — |
| mahmoud_ali_albanna_mujawwad | محمود علي البنا - مجود / مجود / حفص عن عاصم | Mahmod_Ali_Albanna_128kbps | — | — | mahmoud_ali_al_banna |
| muhammad_rifat | محمد رفعت / مجود / حفص عن عاصم | — | — | — | — |
| mustafa_ismail | مصطفى إسماعيل - مجود / مجود / حفص عن عاصم | Mustafa_Ismail_48kbps | — | mustafa_ismail_mp3quran | mustafa_ismail |
| mahmoud_husary_tarteel | محمود خليل الحصري - ترتيل / ترتيل / حفص عن عاصم | — | 6 | — | mahmoud_khalil_al_husary |
| muhammad_ayyub | محمد أيوب / ترتيل / حفص عن عاصم | Muhammad_Ayyoub_128kbps | — | — | mohammed_ayyub |
| ali_hudhaify | علي الحذيفي / ترتيل / حفص عن عاصم | Hudhaify_128kbps | — | — | ali_al_huthaifi |
| abdulmohsen_qasim | عبد المحسن القاسم / ترتيل / حفص عن عاصم | Muhsin_Al_Qasim_192kbps | — | — | — |
| husary_muallim | محمود خليل الحصري - المعلم / معلم / حفص عن عاصم | Husary_Muallim_128kbps | 12 | — | mahmoud_khalil_al_husary |
| minshawi_muallim | محمد صديق المنشاوي - المعلم / معلم / حفص عن عاصم | Minshawy_Teacher_128kbps | — | — | mohammed_siddiq_al_minshawi |
| ayman_swed | أيمن سويد / معلم / حفص عن عاصم | Ayman_Sowaid_64kbps | — | — | ayman_swed |
| abdul_basit_warsh | عبد الباسط عبد الصمد - ورش / مرتل / ورش عن نافع | warsh/warsh_Abdul_Basit_128kbps | — | — | abdulbasit_abdulsamad |
| ibrahim_dosri_warsh | إبراهيم الدوسري - ورش / مرتل / ورش عن نافع | warsh/warsh_ibrahim_aldosary_128kbps | — | — | — |
| yassin_jazaery_warsh | ياسين الجزائري - ورش / مرتل / ورش عن نافع | warsh/warsh_yassin_al_jazaery_64kbps | — | — | — |
| mahmoud_husary_warsh | محمود خليل الحصري - ورش / مرتل / ورش عن نافع | — | — | — | mahmoud_khalil_al_husary |
| omar_qazabri_warsh | عمر القزابري - ورش / مرتل / ورش عن نافع | — | — | — | — |
| koshi_warsh | العيون الكوشي - ورش / مرتل / ورش عن نافع | — | — | — | — |
| mahmoud_husary_qaloon | محمود خليل الحصري - قالون / مرتل / قالون عن نافع | — | — | — | mahmoud_khalil_al_husary |
| ali_hudhaify_qaloon | علي الحذيفي - قالون / ترتيل / قالون عن نافع | — | — | — | ali_al_huthaifi |
| dokali_qaloon | الدوكالي محمد العالم - قالون / مرتل / قالون عن نافع | — | — | — | — |
| nourin_siddig_duri | نورين محمد صديق - الدوري / مرتل / الدوري عن أبي عمرو | — | — | — | — |
| fateh_zubeir_duri | الفاتح محمد الزبير - الدوري / مرتل / الدوري عن أبي عمرو | — | — | — | — |
| mahmoud_husary_duri | محمود خليل الحصري - الدوري / مرتل / الدوري عن أبي عمرو | — | — | — | mahmoud_khalil_al_husary |
| abdur_rashid_sufi_soosi | عبد الرشيد صوفي - السوسي / مرتل / السوسي عن أبي عمرو | — | — | — | abdur_rashid_sufi |
| muftah_sultany_shubah | مفتاح السلطني - شعبة / مرتل / شعبة عن عاصم | — | — | — | — |
| abdur_rashid_sufi_khalaf | عبد الرشيد صوفي - خلف عن حمزة / مرتل / خلف عن حمزة | — | — | — | abdur_rashid_sufi |

## Quran Foundation / QDC

المصدر العام الفعلي [قائمة recitations](https://api.quran.com/api/v4/resources/recitations?language=en) قُرئ بتاريخ 2026-10-10: المعرفات 1 و2 لعبد الباسط (مجود/مرتل)، 8 و9 للمنشاوي (مجود/مرتل)، 12 للحصري المعلم، 6 للحصري style=null. لا يثبت تكرار 6 أن مجود الحصري صحيح. معرف ياسر الدوسري 97 في الخريطة القديمة لم يظهر في هذه القائمة العامة؛ لا أدعي أنه صوت قارئ آخر أو أن endpoint منفردًا يرفضه، لأن صوت 97 لم يُجلب. خريطة QF معطلة حاليًا أصلًا. قناة catalog quranicaudio وتلاواتها كيان مختلف عن رقم QF legacy؛ لا تُساوى المصطلحات.

## ما لم يُقَس

لا قياس جديد لجودة أو مدة كاملة ولا speaker embeddings. قيم bitrate/sample_rate في JSON بيانات معلنة من الكتالوج فقط. لا نستخدم مدة أول/آخر كلمة كمدة صوت السورة ولا نعد اختلاف الأسلوب mismatch هوية. مجلدات Drive/YouTube/TVQuran الرقمية opaque؛ لا يمكن تأكيد الاسم منها. فحص HEAD الموجود لسورة44 لإسلام صبحي يُظهر redirect إلى islam-sobhi وصوت MPEG متاح؛ لا يؤكد هوية المتحدث. لا تحميل YouTube أو تخزين صوت.

## خطة D8 والمراجعة البشرية اللاحقة

تبقى الخريطة كما هي في D4. في D8 يختار المستخدم recitation مستقلة بإسناد/أسلوب/سنة؛ لا انتقال تلقائي QUA→EveryAyah→رابط آخر. resolver الجديد يرفض الاستبدال بين التلاوات؛ بديل نفس التسجيل فقط بعد إثبات الخادم واعتماد بشري وتدقيق الاستخدام. A2 يعرض هذه الفروق وعينات المصدر الأصلي، وتأكيد الصوت البشري منفصل عن الحالة التقنية وترخيص المصدر. لا ننقل isOpenLicense القديم إلى license_status=permitted.

## إعادة التحقق

فحص محلي للروابط الكاملة ومعرفات Drive/YouTube حسب الخوارزمية المسجلة في JSON، اختبارات مضمنة لعدم دمج فيديوهين أو اختلاف حالة Drive، عد جميع روابط catalog ثم تجميعها بحسب reciter_id، وفحص سلامة بنية JSON وبصمات الملفات. لم تُجر أو تُدّع اختبارات build أو API أو إنتاج في هذه المهمة الوثائقية.
