# تشخيص فشل الصوت والتوقيت — B

نتائج v1 محفوظة. الأنماط العددية لا تثبت السبب وحدها؛ unresolved يعني أن الدليل لا يكفي، لا أنه صوت مختلف أو drift.

VAD هنا كاشف طاقة موثق، وليس نموذجًا لغويًا. فرق المدة يقارن مدة HF المعلنة بمدة مقطعه المفكوك؛ لا يمثل قياس نهاية الآية مستقلًا في المصدر.

الأعداد والتغطية أدناه من البيانات المقاسة. تغطية HF التاريخية لا تحقق اكتمال توقيت Release المطلوب في D3.

v1: {"source_unavailable": 13, "failed": 48, "passed": 8}

الأسباب المستقلة: {"codec_processing_only": 4, "boundary_confounded": 31, "unresolved": 12, "constant_lag": 1}

مرشحو v2 بعد المراجعة: ahmed_saud_mp3quran, mishary_rashid_al_afasy_mp3quran, mohammed_alghazali_archive. لا كتابة قاعدة أو نشر بهذا التقرير.

## حسب provider_group

| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |
|---|---|---|---:|
| archive_org | {'failed': 3} | {'boundary_confounded': 2, 'codec_processing_only': 1} | 1 |
| drive | {'source_unavailable': 4} | {'not_rechecked_v1_source_unavailable': 4} | 0 |
| mp3quran | {'passed': 6, 'failed': 16} | {'not_rechecked_v1_passed': 6, 'boundary_confounded': 8, 'unresolved': 6, 'codec_processing_only': 2} | 2 |
| quranicaudio | {'passed': 2, 'failed': 12} | {'not_rechecked_v1_passed': 2, 'boundary_confounded': 9, 'unresolved': 3} | 0 |
| tarteel | {'failed': 6} | {'codec_processing_only': 1, 'boundary_confounded': 5} | 0 |
| tvquran | {'failed': 1} | {'unresolved': 1} | 0 |
| way2quran | {'failed': 10} | {'boundary_confounded': 7, 'constant_lag': 1, 'unresolved': 2} | 0 |
| youtube | {'source_unavailable': 9} | {'not_rechecked_v1_source_unavailable': 9} | 0 |

## حسب channel

| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |
|---|---|---|---:|
| archive_org | {'failed': 3} | {'boundary_confounded': 2, 'codec_processing_only': 1} | 1 |
| drive | {'source_unavailable': 4} | {'not_rechecked_v1_source_unavailable': 4} | 0 |
| mp3quran | {'passed': 6, 'failed': 16} | {'not_rechecked_v1_passed': 6, 'boundary_confounded': 8, 'unresolved': 6, 'codec_processing_only': 2} | 2 |
| quranicaudio | {'passed': 2, 'failed': 12} | {'not_rechecked_v1_passed': 2, 'boundary_confounded': 9, 'unresolved': 3} | 0 |
| tarteel | {'failed': 6} | {'codec_processing_only': 1, 'boundary_confounded': 5} | 0 |
| tvquran | {'failed': 1} | {'unresolved': 1} | 0 |
| way2quran | {'failed': 10} | {'boundary_confounded': 7, 'constant_lag': 1, 'unresolved': 2} | 0 |
| youtube | {'source_unavailable': 9} | {'not_rechecked_v1_source_unavailable': 9} | 0 |

## حسب audio_category

| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |
|---|---|---|---:|
| by_surah | {'source_unavailable': 13, 'failed': 48, 'passed': 8} | {'not_rechecked_v1_source_unavailable': 13, 'codec_processing_only': 4, 'boundary_confounded': 31, 'not_rechecked_v1_passed': 8, 'unresolved': 12, 'constant_lag': 1} | 3 |

## حسب style

| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |
|---|---|---|---:|
| muallim | {'source_unavailable': 1} | {'not_rechecked_v1_source_unavailable': 1} | 0 |
| mujawwad | {'failed': 4} | {'codec_processing_only': 1, 'unresolved': 1, 'boundary_confounded': 2} | 0 |
| murattal | {'source_unavailable': 12, 'failed': 44, 'passed': 8} | {'not_rechecked_v1_source_unavailable': 12, 'boundary_confounded': 29, 'not_rechecked_v1_passed': 8, 'unresolved': 11, 'constant_lag': 1, 'codec_processing_only': 3} | 3 |

## حسب riwayah

| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |
|---|---|---|---:|
| hafs_an_asim | {'source_unavailable': 13, 'failed': 40, 'passed': 6} | {'not_rechecked_v1_source_unavailable': 13, 'codec_processing_only': 4, 'boundary_confounded': 26, 'not_rechecked_v1_passed': 6, 'unresolved': 9, 'constant_lag': 1} | 3 |
| qalon_an_nafi | {'failed': 5} | {'unresolved': 1, 'boundary_confounded': 4} | 0 |
| shubah_an_asim | {'failed': 2} | {'boundary_confounded': 1, 'unresolved': 1} | 0 |
| warsh_an_nafi | {'passed': 2, 'failed': 1} | {'not_rechecked_v1_passed': 2, 'unresolved': 1} | 0 |

## حسب offset_metadata_source

| المجموعة | v1 | الأسباب المراجعة | مرشحو v2 |
|---|---|---|---:|
| chapter_offsets_ms_present | {'source_unavailable': 12} | {'not_rechecked_v1_source_unavailable': 12} | 0 |
| source_offset_ms_only | {'failed': 48, 'passed': 8, 'source_unavailable': 1} | {'codec_processing_only': 4, 'boundary_confounded': 31, 'not_rechecked_v1_passed': 8, 'unresolved': 12, 'constant_lag': 1, 'not_rechecked_v1_source_unavailable': 1} | 3 |

## كل التلاوات

| التلاوة | الرواية | آيات HF | سور HF كاملة | v1 | نمط عددي B | السبب المراجع | v2 مرشح | النشر |
|---|---|---:|---:|---|---|---|---|---|
| abdul_hamid_ghraio_2025_yt | hafs_an_asim | 6235 | 110 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| abdul_hamid_ghraio_2026_yt | hafs_an_asim | 6235 | 112 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| abdulaziz_al_turki_yt | hafs_an_asim | 6115 | 108 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| abdulbasit_abdulsamad_mujawwad_tarteel | hafs_an_asim | 6236 | 107 | failed | unresolved | codec_processing_only | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| abdulbasit_abdulsamad_tarteel | hafs_an_asim | 6236 | 112 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| abdulbasit_abdulsamad_warsh_qdc | warsh_an_nafi | 6178 | 0 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable |
| abdullah_al_buaijan_2025_yt | hafs_an_asim | 6235 | 113 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| abdullah_al_mattrod_qdc | hafs_an_asim | 6236 | 111 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| abdullah_al_qarafi_mp3quran | hafs_an_asim | 6223 | 105 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| abdullah_kamel_way2quran | hafs_an_asim | 6235 | 88 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| abdulwadood_haneef_mp3quran | hafs_an_asim | 6235 | 99 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| abdur_rashid_sufi_qdc | hafs_an_asim | 6236 | 113 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| abdur_rashid_sufi_shubah_qdc | shubah_an_asim | 6230 | 0 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| abu_bakr_al_shatri_tarteel | hafs_an_asim | 6236 | 80 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| adel_al_karbalaei_archive_v2 | hafs_an_asim | 6236 | 113 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmad_naseem_ali_ahmad_2019_yt | hafs_an_asim | 6236 | 109 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| ahmed_al_ajmi_qdc | hafs_an_asim | 6235 | 95 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmed_amer_tvquran | hafs_an_asim | 6236 | 112 | failed | codec_processing_only | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmed_deban_qalon_mp3quran | qalon_an_nafi | 6190 | 0 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| ahmed_issa_al_maasaraawi_mp3quran | hafs_an_asim | 6234 | 108 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmed_kaseb_way2quran | hafs_an_asim | 6235 | 110 | failed | constant_lag | constant_lag | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmed_nuayna_qdc | hafs_an_asim | 6236 | 113 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmed_saleh_rajab_qalon_way2quran | qalon_an_nafi | 6126 | 0 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| ahmed_saud_mp3quran | hafs_an_asim | 327 | 30 | failed | unresolved | codec_processing_only | نعم | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| ahmed_shaheen_mp3quran | hafs_an_asim | 6236 | 109 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ahmed_talib_bin_humaid_mp3quran | hafs_an_asim | 5561 | 93 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| akram_al_alaqmi_qdc | hafs_an_asim | 6235 | 101 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ali_al_huthaifi_mp3quran | hafs_an_asim | 6236 | 109 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| ayman_swed_muallim_yt | hafs_an_asim | 6236 | 104 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| badr_al_turki_yt | hafs_an_asim | 6236 | 109 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| bandar_baleela_qdc | hafs_an_asim | 6235 | 100 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| fatih_seferagic_way2quran | hafs_an_asim | 6235 | 112 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| haitham_al_dukhain_mp3quran | hafs_an_asim | 6236 | 102 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| hani_al_rifai_qdc_128k | hafs_an_asim | 6233 | 101 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| ibrahim_al_akhdar_drive | hafs_an_asim | 6236 | 111 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable |
| imad_zuhair_hafez_mp3quran | hafs_an_asim | 6236 | 114 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| islam_sobhi_mp3quran | hafs_an_asim | 5275 | 99 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| khalid_al_mohana_drive | hafs_an_asim | 6236 | 112 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable |
| khalifa_al_tunaiji_tarteel | hafs_an_asim | 6236 | 108 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| maher_al_muaiqly_qdc | hafs_an_asim | 6236 | 114 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mahmoud_abdul_hakam_mp3quran | hafs_an_asim | 6236 | 106 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mahmoud_ali_al_banna_qdc | hafs_an_asim | 6236 | 113 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mahmoud_khalil_al_husary_mp3quran | hafs_an_asim | 6236 | 113 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mahmoud_khalil_al_husary_mujawwad_tarteel | hafs_an_asim | 6235 | 105 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mahmoud_khalil_al_husary_qdc_128k | hafs_an_asim | 6236 | 112 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mishary_rashid_al_afasy_2008_qdc | hafs_an_asim | 6236 | 97 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mishary_rashid_al_afasy_mp3quran | hafs_an_asim | 6236 | 103 | failed | unresolved | codec_processing_only | نعم | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| moaz_mahmoud_hamed_qalon_way2quran | qalon_an_nafi | 6175 | 0 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| mohammed_abdulkareem_qdc | hafs_an_asim | 6235 | 107 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| mohammed_al_luhaidan_mp3quran | hafs_an_asim | 6234 | 99 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| mohammed_alghazali_archive | hafs_an_asim | 6236 | 107 | failed | unresolved | codec_processing_only | نعم | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted |
| mohammed_ayyub_drive | hafs_an_asim | 6236 | 110 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable |
| mohammed_burhaji_yt | hafs_an_asim | 6236 | 97 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| mohammed_saayed_warsh_mp3quran | warsh_an_nafi | 6214 | 0 | passed | — | not_rechecked_v1_passed | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable |
| mohammed_siddiq_al_minshawi_1967_drive | hafs_an_asim | 6236 | 107 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable |
| mohammed_siddiq_al_minshawi_mp3quran | hafs_an_asim | 6236 | 111 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | hafs_an_asim | 6236 | 102 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| muammar_zainal_al_sukaini_way2quran | hafs_an_asim | 6229 | 106 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| mustafa_ismail_mp3quran | hafs_an_asim | 6236 | 114 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| nasser_al_qatami_mp3quran | hafs_an_asim | 6235 | 86 | failed | codec_processing_only | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| saad_al_ghamdi_tarteel | hafs_an_asim | 6235 | 101 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| saber_abdulhakam_qalon_way2quran | qalon_an_nafi | 6194 | 0 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| saber_abdulhakam_shubah_way2quran | shubah_an_asim | 6235 | 0 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| saber_abdulhakam_warsh_way2quran | warsh_an_nafi | 6213 | 0 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| saber_abdulhakam_yt | hafs_an_asim | 6236 | 111 | source_unavailable | — | not_rechecked_v1_source_unavailable | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified; catalog_audio_source_unavailable; youtube_extraction_prohibited |
| saud_al_shuraim_mp3quran | hafs_an_asim | 6235 | 110 | failed | unresolved | unresolved | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| walid_al_naihi_qalon_mp3quran | qalon_an_nafi | 6195 | 0 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; non_hafs_canonical_text_unavailable; offset_unverified |
| walid_atef_way2quran | hafs_an_asim | 6235 | 103 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |
| yasser_al_dosari_archive | hafs_an_asim | 6235 | 103 | failed | unresolved | boundary_confounded | لا | D3_timing_completeness_not_accepted; D4_audio_health_and_license_attribution_not_accepted; offset_unverified |

## الأدلة والقيود

- المقاييس لكل عينة والبوابات والأسباب متاحة في تقرير JSON والمراجعة المستقلة المرتبطين بالبصمات أدناه.
- خمس رسوم حقيقية من تلاوات فاشلة فُحصت محليًا؛ بصماتها في b-root-overlay-review.json. الصور والصوت خارج Git.
- بدائل التلاوات غير المتاحة موثقة في d3-source-alternatives.md/json؛ فحص سورة112 لا يعمم على السور الأخرى ولا يثبت الترخيص أو التزامن.
- خطأ scratch المحلي والتشغيل السابق محفوظان منفصلين؛ لا استبدال نتيجة صوتية ولا حذف بديل.
- التنظيف manual_cleanup_required؛ رفض السياسة محفوظ ولا تُجرّب وسيلة تجاوز.

بصمات المدخلات: `{"annotation": "bab3c456e377e643cdbe17b5e2391338800ce8f9c8a891b7c1587c5be8211ee6", "catalog": "b7ee26c2267b086d5758477e21144887c28c6ba884a6ff5157a55cf17df4eed4", "original": "e071bf483c7b44c9157c49cc15287c9aa11ed598d777bfff2bdcb1e8a449a0b9", "raw": "a4b3a518d3daf416e7ce88228450e9634c21b59dcd2c454d899f873410f4fd43", "review": "88138a873f518d77285ca0e662145eae35a8838f26a9d4151af2bf1ae07b03ec"}`
