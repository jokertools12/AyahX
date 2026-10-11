# D4 — تدقيق المدة من الأدلة المحفوظة

التدقيق في 2026-10-10T15:00:59.374Z: 144 مدة ملف فصل كامل مثبتة من 144 عينة محفوظة، موزعة على 48 تلاوة. البصمة والحجم أعيد فحصهما من الملفات الأصلية المحفوظة، وقياسات ffprobe هي القياسات المؤرخة في voice-identity-report. لم يُنزّل صوت ولم يُشغّل خدمة أو يُكتب DB أو يُحذف ملف.

مقارنة آخر كلمة مخزنة متاحة لـ90 فصلًا فقط؛ 7 تحذيرات تتجاوز 5% حسب abs(duration-end)/end بالقيم الخام. انتهى تحويل التوقيت لدى الجذر عبر toRenderTimeline وحده. بداية مورد الفصل المستقل مرجع حسابي لصفر الملف في هذا الفحص فقط؛ هذا لا يثبت صحة الـoffset أو المحاذاة، ولا ينشر التلاوة. فقدان mapping لا يُعالج باختلاق index.

الجرد 7765 فصلًا في 69 تلاوة؛ 7621 مدة فصل كامل غير متاحة. HEAD/Range يثبت وصول الرابط فقط، ولا يعطي مدة من Content-Length؛ لا حساب CBR ولا تعميم VBR ولا استعارة مدة مقطع آية/HF. الجدول التالي يجعل البقية غير المتحققة صريحة.

مصادر الدليل: voice-identity-report.json.duration_quality_comparison.measurements؛ link-scan-final.json.last_checks؛ تصدير الجذر الخاص source_end_ms وendpoint_scope؛ d3-audio-failure-diagnosis-v2.json لتحديد الملفات الكاملة المحفوظة. بصمات الملفات المدخلة في JSON المرافق؛ لا صوت أو URLs أو مسارات scratch في التقرير العام.

أسباب تعذر المقارنة: `{"TIMELINE_WORD_INVALID":52,"TIMELINE_WORDS_REQUIRED":2}`.

التشخيص الأول محفوظ ببصمة 13d9601c49aa140a4c3584cf1542a7edd4e34abac076dc57f769d6f500471aef: 0 تحويلًا متاحًا و144 حالة CHAPTER_OFFSET_UNAVAILABLE. التصدير اللاحق استخدم مرجع بداية مورد الفصل المستقل المشروط بتطابق URL مع المصدر الكامل غير YouTube، لغرض مقارنة النهاية المتوقع فقط. لم يُمسح التشخيص الأول ولم تتحول أي حالة offset فاشلة إلى نجاح.

| تحذير: التلاوة | السورة | مدة المصدر ms | نهاية المخزّن ms | الفرق ms | النسبة % | offset_verified في الجرد |
|---|---:|---:|---:|---:|---:|---|
| ahmed_saud_mp3quran | 101 | 68257.5 | 61531 | 6726.5 | 10.932 | true |
| ahmed_saud_mp3quran | 102 | 61559.438 | 55115 | 6444.438000000002 | 11.693 | true |
| ahmed_saud_mp3quran | 105 | 49075.5 | 44985 | 4090.5 | 9.093 | true |
| islam_sobhi_mp3quran | 97 | 40547.378 | 38295 | 2252.377999999997 | 5.882 | false |
| maher_al_muaiqly_qdc | 107 | 64062.917 | 60460 | 3602.9170000000013 | 5.959 | false |
| mahmoud_khalil_al_husary_mp3quran | 97 | 66803.125 | 62060 | 4743.125 | 7.643 | false |
| mustafa_ismail_mp3quran | 97 | 46479.813 | 43655 | 2824.813000000002 | 6.471 | false |

| التلاوة | فصول الجرد | مدة كاملة | مقارنة النهاية | تحذير >5% | نهاية غير متاحة بعد قياس المدة | مدة كاملة غير متاحة |
|---|---:|---:|---:|---:|---:|---:|
| abdul_hamid_ghraio_2025_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| abdul_hamid_ghraio_2026_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| abdulaziz_al_turki_yt | 112 | 0 | 0 | 0 | 0 | 112 |
| abdulbasit_abdulsamad_mujawwad_tarteel | 114 | 3 | 1 | 0 | 2 | 111 |
| abdulbasit_abdulsamad_tarteel | 114 | 3 | 1 | 0 | 2 | 111 |
| abdulbasit_abdulsamad_warsh_qdc | 114 | 0 | 0 | 0 | 0 | 114 |
| abdullah_al_buaijan_2025_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| abdullah_al_mattrod_qdc | 114 | 3 | 1 | 0 | 2 | 111 |
| abdullah_al_qarafi_mp3quran | 114 | 0 | 0 | 0 | 0 | 114 |
| abdullah_kamel_way2quran | 114 | 3 | 0 | 0 | 3 | 111 |
| abdulwadood_haneef_mp3quran | 114 | 3 | 0 | 0 | 3 | 111 |
| abdur_rashid_sufi_qdc | 114 | 3 | 1 | 0 | 2 | 111 |
| abdur_rashid_sufi_shubah_qdc | 114 | 3 | 0 | 0 | 3 | 111 |
| abu_bakr_al_shatri_tarteel | 114 | 3 | 1 | 0 | 2 | 111 |
| adel_al_karbalaei_archive_v2 | 114 | 3 | 2 | 0 | 1 | 111 |
| ahmad_naseem_ali_ahmad_2019_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| ahmed_al_ajmi_qdc | 114 | 3 | 2 | 0 | 1 | 111 |
| ahmed_amer_tvquran | 114 | 3 | 3 | 0 | 0 | 111 |
| ahmed_deban_qalon_mp3quran | 114 | 3 | 0 | 0 | 3 | 111 |
| ahmed_issa_al_maasaraawi_mp3quran | 114 | 3 | 3 | 0 | 0 | 111 |
| ahmed_kaseb_way2quran | 114 | 3 | 3 | 0 | 0 | 111 |
| ahmed_nuayna_qdc | 114 | 3 | 3 | 0 | 0 | 111 |
| ahmed_saleh_rajab_qalon_way2quran | 114 | 3 | 0 | 0 | 3 | 111 |
| ahmed_saud_mp3quran | 30 | 3 | 3 | 3 | 0 | 27 |
| ahmed_shaheen_mp3quran | 114 | 3 | 2 | 0 | 1 | 111 |
| ahmed_talib_bin_humaid_mp3quran | 107 | 3 | 3 | 0 | 0 | 104 |
| akram_al_alaqmi_qdc | 114 | 3 | 2 | 0 | 1 | 111 |
| ali_al_huthaifi_mp3quran | 114 | 0 | 0 | 0 | 0 | 114 |
| ayman_swed_muallim_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| badr_al_turki_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| bandar_baleela_qdc | 114 | 3 | 3 | 0 | 0 | 111 |
| fatih_seferagic_way2quran | 114 | 3 | 3 | 0 | 0 | 111 |
| haitham_al_dukhain_mp3quran | 114 | 0 | 0 | 0 | 0 | 114 |
| hani_al_rifai_qdc_128k | 114 | 3 | 2 | 0 | 1 | 111 |
| ibrahim_al_akhdar_drive | 114 | 0 | 0 | 0 | 0 | 114 |
| imad_zuhair_hafez_mp3quran | 114 | 0 | 0 | 0 | 0 | 114 |
| islam_sobhi_mp3quran | 106 | 3 | 3 | 1 | 0 | 103 |
| khalid_al_mohana_drive | 114 | 0 | 0 | 0 | 0 | 114 |
| khalifa_al_tunaiji_tarteel | 114 | 3 | 3 | 0 | 0 | 111 |
| maher_al_muaiqly_qdc | 114 | 3 | 2 | 1 | 1 | 111 |
| mahmoud_abdul_hakam_mp3quran | 114 | 3 | 2 | 0 | 1 | 111 |
| mahmoud_ali_al_banna_qdc | 114 | 3 | 3 | 0 | 0 | 111 |
| mahmoud_khalil_al_husary_mp3quran | 114 | 3 | 3 | 1 | 0 | 111 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | 114 | 3 | 2 | 0 | 1 | 111 |
| mahmoud_khalil_al_husary_qdc_128k | 114 | 3 | 3 | 0 | 0 | 111 |
| mishary_rashid_al_afasy_2008_qdc | 114 | 3 | 3 | 0 | 0 | 111 |
| mishary_rashid_al_afasy_mp3quran | 114 | 3 | 3 | 0 | 0 | 111 |
| moaz_mahmoud_hamed_qalon_way2quran | 114 | 3 | 0 | 0 | 3 | 111 |
| mohammed_abdulkareem_qdc | 114 | 0 | 0 | 0 | 0 | 114 |
| mohammed_al_luhaidan_mp3quran | 114 | 0 | 0 | 0 | 0 | 114 |
| mohammed_alghazali_archive | 114 | 3 | 3 | 0 | 0 | 111 |
| mohammed_ayyub_drive | 114 | 0 | 0 | 0 | 0 | 114 |
| mohammed_burhaji_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| mohammed_saayed_warsh_mp3quran | 114 | 0 | 0 | 0 | 0 | 114 |
| mohammed_siddiq_al_minshawi_1967_drive | 114 | 0 | 0 | 0 | 0 | 114 |
| mohammed_siddiq_al_minshawi_mp3quran | 114 | 3 | 3 | 0 | 0 | 111 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | 114 | 3 | 2 | 0 | 1 | 111 |
| muammar_zainal_al_sukaini_way2quran | 114 | 3 | 2 | 0 | 1 | 111 |
| mustafa_ismail_mp3quran | 114 | 3 | 3 | 1 | 0 | 111 |
| nasser_al_qatami_mp3quran | 114 | 3 | 2 | 0 | 1 | 111 |
| saad_al_ghamdi_tarteel | 114 | 3 | 2 | 0 | 1 | 111 |
| saber_abdulhakam_qalon_way2quran | 114 | 3 | 0 | 0 | 3 | 111 |
| saber_abdulhakam_shubah_way2quran | 114 | 3 | 0 | 0 | 3 | 111 |
| saber_abdulhakam_warsh_way2quran | 114 | 3 | 0 | 0 | 3 | 111 |
| saber_abdulhakam_yt | 114 | 0 | 0 | 0 | 0 | 114 |
| saud_al_shuraim_mp3quran | 114 | 3 | 2 | 0 | 1 | 111 |
| walid_al_naihi_qalon_mp3quran | 114 | 3 | 0 | 0 | 3 | 111 |
| walid_atef_way2quran | 114 | 3 | 2 | 0 | 1 | 111 |
| yasser_al_dosari_archive | 114 | 3 | 3 | 0 | 0 | 111 |

مخاطر القراءة: المقدمة والبسملة والصمت والخاتمة واختلاف التسجيل أو نقص الكلمات قد تفسر فرق المدة؛ التحذير يستلزم مراجعة ولا يمنح قبول offset/هوية/توقيت. الصفوف وتفاصيل ms متاحة في JSON المرافق. جميع الـoffset التي لم تثبت تبقى غير مثبتة. المرحلة D5 خارج هذه المهمة.
