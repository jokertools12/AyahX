# تقرير المرحلة D3 — الدفعة 1: توقف مالي قبل الاستيراد

## 1. ما الذي تغيّر

سُجلت قرارات المستخدم الأحدث في DECISIONS.md أولًا: MySQL لكل البيانات، النطاق 69 تلاوة، بوابة JSON_STORAGE_SIZE+50%≤60%من الحرة، حماية حساب الأدمن، وتفويض الدفعة 1 وحدها. تحديث توثيق وأدلة قراءة فقط؛ لا تغيير كود أو schema أو بيانات أو UI أو renderer. أنشئ launch-blockers.md بعد إثبات غيابه؛ لا ادعاء قراءة وثيقة غير موجودة.

## 2. ما الذي تحققت منه فعليًا

Railway describe-service/describe-environment: volume5000MB، MySQL9.7.2 SUCCESS، لا TCP proxy ولا domain عام للقاعدة، ولا staged changes. df -B1 --output=size,used,avail,pcent /var/lib/mysql الساعة 04:15:41UTC:

| القياس | bytes |
|---|---:|
| الحجم الفعلي لـfilesystem | 4,685,873,152 |
| المستخدم | 325,705,728 |
| المتاح قبل التنفيذ | 4,350,103,552 |
| حد 60%من المتاح | 2,610,062,131.2 |
| بعد الاستيراد | لم ينفذ؛ لا قياس بعدي يُختلق |

الفرق بين 5000MB المخصص وحجم filesystem لا يعني فشل التوسعة. استخدام df7%. du datadir=325,570,560، railway=100,470,784، redo=104,861,696، undo_001/undo_002 كل 16,777,216 bytes. MySQL uptime=61,844s و Threads_connected=2/max_connections60 و max_allowed_packet67,108,864. @@log_bin=0، retention الحالي 2,592,000s. SHOW REPLICAS و SHOW REPLICA STATUS بلا صفوف. binlog معطل، فلا ملفات لتنظيفها ولا كتابة مضاعفة منه؛ لم ينفذ SET PERSIST أو PURGE بلا أثر مفيد، وأثر التنظيف 0 bytes. لم يُدّع جرد CDC كاملًا من هذين الأمرين.

أحجام information_schema للجداول القائمة (metadata، DATA_FREE قد يخص tablespace ولا يُجمع كحجم مستخدم):

| الجدول القائم | DATA_LENGTH | INDEX_LENGTH | DATA_FREE |
|---|---:|---:|---:|
| quran_words | 18432000 | 15319040 | 4194304 |
| quran_ayahs | 5783552 | 1916928 | 4194304 |
| recitations | 5783552 | 65536 | 4194304 |
| recitation_chapters | 2637824 | 1589248 | 4194304 |
| render_jobs | 1458176 | 98304 | 4194304 |
| render_job_audit | 114688 | 98304 | 0 |
| saved_videos | 16384 | 114688 | 0 |
| admin_permissions | 49152 | 65536 | 0 |
| quran_audio_assets | 16384 | 81920 | 0 |
| render_manifests | 16384 | 81920 | 0 |
| admin_invitations | 16384 | 65536 | 0 |
| alignment_documents | 16384 | 65536 | 0 |
| video_comments | 16384 | 65536 | 0 |
| admin_sessions | 16384 | 49152 | 0 |
| audit_logs | 16384 | 49152 | 0 |

جداول D3 غير موجودة؛ حجمها الفعلي على production غير متاح وليس تقديرًا. لم يُقَس JSON_STORAGE_SIZE لكل 69: القياس السابق 24 تلاوة/143590 صفًا فقط،223,071,669 bytespayload؛ لا تعميم له ولا ادعاء اجتياز 60%.

### التكلفة — نقطة التوقف الملزمة

railway usage الحالي 17.83406514740877 دولار؛ hardLimit18 و softLimit5 و isOverLimit=false؛ المتبقي 0.16593485259123 دولار. تقدير نهاية دورة 19 سبتمبر–19 أكتوبر 23.073205267590637 دولار، ويتجاوز الحد القائم. هذا تقدير Railway العام، لا تكلفة استيراد D3 محسوبة، ولا ادعاء أن الحد بلغ الآن. حالة مالية غير متوقعة قبل عملية كبيرة تفعّل نقطةالتوقف 6؛ لا رفع limit أو ترقية خطة أو إنفاق جديد.

Railway usage projects يعرض تكلفة MySQL volume الفعلية للدورة حتى القراءة 0.06269965184712994 دولار، وتكلفة MySQL الإجمالية 5.813558654074766. السعر الشهري المنشور رسميًا 0.15 دولار/GB/month؛ تكلفة 5GB مستخدمة طوال شهر 0.75 دولار حساب مشتق، وليست فاتورة شهرية مقاسة للتوسعة. المصدر [Railway pricing](https://docs.railway.com/pricing/plans). يظهر backup0.010062073438499275 دولار كاستخدام قائم؛ لم ينشئ الوكيل snapshot أو backup خدمة مدفوعًا.

### تحقق Production قراءة فقط

D1=114/6236/77433؛ البصمة eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4. جداول D3 الثلاثة غائبة. سجل الحماية وجد صفين بدور admin؛ حُفظت البصمة دون IDs أو بيانات شخصية، وكل حسابات admin محمية لأن أي اختيار لأحدهما كحساب المستخدم غير مثبت. لا DELETE/UPDATE أو تنظيف userdata، ولا حساب أُعدل.

| الجدول | production عند التوقف |
|---|---:|
| users | 13 |
| subscriptions | 16 |
| payment_requests | 3 |
| saved_videos | 7 |
| render_jobs | 72 |
| system_settings | 13 |
| user_roles | 13 |
| notifications | 49 |

/api/health و/api/health/ready200، database connected. لوجات 04:10:00–04:17:15UTC: AyahX2 سطور/MySQL0، أخطاء 0. ليست نافذة قبول نشر 10 دقائق؛ لم يحدث نشر في الدفعة. الأدلة: d3-batch1-capacity-before.json، d3-batch1-billing.json، d3-batch1-production-readonly.json، d3-batch1-admin-protection.json، d3-batch1-services-readonly.json.

## 3. نتائج الاختبارات

لم تُشغّل tsc/lint/npm test/build أو بروفة DB في هذه الدفعة بعد تفعيل التوقف؛ ملفات التغيير توثيق فقط. نتائج الدفعة السابقة المحفوظة:483pass/6skip/0fail،12D3 مستهدفًا و 108B ناجحة و tsc/lint متغير ناجحان. تلك نتائج تاريخية، وليست تشغيلًا جديدًا أو قبولًا لـ D3.

البروفة المدمرة الحقيقية، التشغيل مرتين، قتل العملية والاستئناف، رفض الفساد، down/reapply، goldenfixtures مع فحص DB، EXPLAIN<50ms، ووجود السبعة بحالتها داخل قاعدة الاختبار: لم تنفذ في هذه الدفعة. لا نتائج mocks تُقدّم بديلًا عنها.

## 4. ما لم يكتمل أو يحتاج قرارك، وسببه

D3 غير مغلق. لا migration003 ولا dry-run/apply على production، لا BullMQ فعلي أو coverageupdate أو ANALYZE. تحذير المساحة health/ready لم يُضف. لا دمج/نشر/PR جديد؛ لا CI أو روابط نشر جديدة. لا dump جديد لأنه لا عملية هدم/كتابة بدأت؛ نسخة age السابقة المتحققة محفوظة ولا يُدعى تحديثها. شرط 60%لم يُختبر على 69 تلاوة بعد.

عدد المحضّر السابق 422463 صفًا في 69 تلاوة؛ المستورد في production0. زمن الاستيراد غير متاح لأنه لم يبدأ. الآتي مرجع التحضير السابق بتاريخ 2026-10-10T03:23:15.529Z فقط، وليس coverage قاعدة أو قبول timing_complete/is_complete. المخطط لم يتغير:

| التلاوة | الرواية | ready/المحضّر | كلمات موقّتة/قانونية | needs_review |
|---|---|---:|---:|---:|
| abdul_hamid_ghraio_2025_yt | hafs_an_asim | 6071/6236 | 76981/77433 | 165 |
| abdul_hamid_ghraio_2026_yt | hafs_an_asim | 6080/6236 | 76985/77433 | 156 |
| abdulaziz_al_turki_yt | hafs_an_asim | 5686/6115 | 74609/76082 | 429 |
| abdulbasit_abdulsamad_mujawwad_tarteel | hafs_an_asim | 5629/6236 | 74526/77433 | 607 |
| abdulbasit_abdulsamad_tarteel | hafs_an_asim | 5828/6236 | 75534/77433 | 408 |
| abdulbasit_abdulsamad_warsh_qdc | warsh_an_nafi | 0/6214 | مرجع قانوني غير متوفر | 6214 |
| abdullah_al_buaijan_2025_yt | hafs_an_asim | 6168/6236 | 77211/77433 | 68 |
| abdullah_al_mattrod_qdc | hafs_an_asim | 5898/6236 | 76355/77433 | 338 |
| abdullah_al_qarafi_mp3quran | hafs_an_asim | 5765/6236 | 75662/77433 | 471 |
| abdullah_kamel_way2quran | hafs_an_asim | 4515/6236 | 71790/77433 | 1721 |
| abdulwadood_haneef_mp3quran | hafs_an_asim | 5511/6236 | 75427/77433 | 725 |
| abdur_rashid_sufi_qdc | hafs_an_asim | 5995/6236 | 76426/77433 | 241 |
| abdur_rashid_sufi_shubah_qdc | shubah_an_asim | 0/6236 | مرجع قانوني غير متوفر | 6236 |
| abu_bakr_al_shatri_tarteel | hafs_an_asim | 4379/6236 | 73004/77433 | 1857 |
| adel_al_karbalaei_archive_v2 | hafs_an_asim | 6052/6236 | 76815/77433 | 184 |
| ahmad_naseem_ali_ahmad_2019_yt | hafs_an_asim | 5481/6236 | 74540/77433 | 755 |
| ahmed_al_ajmi_qdc | hafs_an_asim | 4780/6236 | 73104/77433 | 1456 |
| ahmed_amer_tvquran | hafs_an_asim | 5893/6236 | 75913/77433 | 343 |
| ahmed_deban_qalon_mp3quran | qalon_an_nafi | 0/6214 | مرجع قانوني غير متوفر | 6214 |
| ahmed_issa_al_maasaraawi_mp3quran | hafs_an_asim | 5971/6236 | 76514/77433 | 265 |
| ahmed_kaseb_way2quran | hafs_an_asim | 5925/6236 | 76565/77433 | 311 |
| ahmed_nuayna_qdc | hafs_an_asim | 6015/6236 | 76586/77433 | 221 |
| ahmed_saleh_rajab_qalon_way2quran | qalon_an_nafi | 0/6213 | مرجع قانوني غير متوفر | 6213 |
| ahmed_saud_mp3quran | hafs_an_asim | 325/327 | 1359/1363 | 2 |
| ahmed_shaheen_mp3quran | hafs_an_asim | 5503/6236 | 74698/77433 | 733 |
| ahmed_talib_bin_humaid_mp3quran | hafs_an_asim | 4951/5561 | 65329/67052 | 610 |
| akram_al_alaqmi_qdc | hafs_an_asim | 5233/6236 | 73973/77433 | 1003 |
| ali_al_huthaifi_mp3quran | hafs_an_asim | 5301/6236 | 74013/77433 | 935 |
| ayman_swed_muallim_yt | hafs_an_asim | 4881/6236 | 72807/77433 | 1355 |
| badr_al_turki_yt | hafs_an_asim | 5589/6236 | 74786/77433 | 647 |
| bandar_baleela_qdc | hafs_an_asim | 5284/6236 | 74382/77433 | 952 |
| fatih_seferagic_way2quran | hafs_an_asim | 6167/6236 | 77216/77433 | 69 |
| haitham_al_dukhain_mp3quran | hafs_an_asim | 5122/6236 | 73893/77433 | 1114 |
| hani_al_rifai_qdc_128k | hafs_an_asim | 5695/6236 | 76067/77433 | 541 |
| ibrahim_al_akhdar_drive | hafs_an_asim | 6106/6236 | 76995/77433 | 130 |
| imad_zuhair_hafez_mp3quran | hafs_an_asim | 5655/6236 | 74998/77433 | 581 |
| islam_sobhi_mp3quran | hafs_an_asim | 4683/5334 | 61761/63841 | 651 |
| khalid_al_mohana_drive | hafs_an_asim | 5973/6236 | 76377/77433 | 263 |
| khalifa_al_tunaiji_tarteel | hafs_an_asim | 5922/6236 | 76254/77433 | 314 |
| maher_al_muaiqly_qdc | hafs_an_asim | 5910/6236 | 75957/77433 | 326 |
| mahmoud_abdul_hakam_mp3quran | hafs_an_asim | 5660/6236 | 74973/77433 | 576 |
| mahmoud_ali_al_banna_qdc | hafs_an_asim | 5815/6236 | 75656/77433 | 421 |
| mahmoud_khalil_al_husary_mp3quran | hafs_an_asim | 5907/6236 | 76107/77433 | 329 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | hafs_an_asim | 5656/6236 | 75095/77433 | 580 |
| mahmoud_khalil_al_husary_qdc_128k | hafs_an_asim | 5929/6236 | 75839/77433 | 307 |
| mishary_rashid_al_afasy_2008_qdc | hafs_an_asim | 5291/6236 | 74622/77433 | 945 |
| mishary_rashid_al_afasy_mp3quran | hafs_an_asim | 5404/6236 | 74969/77433 | 832 |
| moaz_mahmoud_hamed_qalon_way2quran | qalon_an_nafi | 0/6177 | مرجع قانوني غير متوفر | 6177 |
| mohammed_abdulkareem_qdc | hafs_an_asim | 4952/6236 | 73300/77433 | 1284 |
| mohammed_al_luhaidan_mp3quran | hafs_an_asim | 5096/6236 | 74389/77433 | 1140 |
| mohammed_alghazali_archive | hafs_an_asim | 5119/6236 | 73766/77433 | 1117 |
| mohammed_ayyub_drive | hafs_an_asim | 5539/6236 | 74229/77433 | 697 |
| mohammed_burhaji_yt | hafs_an_asim | 5163/6236 | 74699/77433 | 1073 |
| mohammed_saayed_warsh_mp3quran | warsh_an_nafi | 0/6214 | مرجع قانوني غير متوفر | 6214 |
| mohammed_siddiq_al_minshawi_1967_drive | hafs_an_asim | 5689/6236 | 75222/77433 | 547 |
| mohammed_siddiq_al_minshawi_mp3quran | hafs_an_asim | 5766/6236 | 75510/77433 | 470 |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | hafs_an_asim | 5281/6236 | 73501/77433 | 955 |
| muammar_zainal_al_sukaini_way2quran | hafs_an_asim | 5806/6236 | 75660/77433 | 430 |
| mustafa_ismail_mp3quran | hafs_an_asim | 5922/6236 | 76001/77433 | 314 |
| nasser_al_qatami_mp3quran | hafs_an_asim | 4518/6236 | 72390/77433 | 1718 |
| saad_al_ghamdi_tarteel | hafs_an_asim | 5481/6236 | 75006/77433 | 755 |
| saber_abdulhakam_qalon_way2quran | qalon_an_nafi | 0/6214 | مرجع قانوني غير متوفر | 6214 |
| saber_abdulhakam_shubah_way2quran | shubah_an_asim | 0/6236 | مرجع قانوني غير متوفر | 6236 |
| saber_abdulhakam_warsh_way2quran | warsh_an_nafi | 0/6214 | مرجع قانوني غير متوفر | 6214 |
| saber_abdulhakam_yt | hafs_an_asim | 5630/6236 | 75267/77433 | 606 |
| saud_al_shuraim_mp3quran | hafs_an_asim | 5794/6236 | 75932/77433 | 442 |
| walid_al_naihi_qalon_mp3quran | qalon_an_nafi | 0/6214 | مرجع قانوني غير متوفر | 6214 |
| walid_atef_way2quran | hafs_an_asim | 4965/6236 | 72980/77433 | 1271 |
| yasser_al_dosari_archive | hafs_an_asim | 5148/6236 | 73928/77433 | 1088 |

أسباب needs_review المجمّعة من التحضير السابق (قد يحمل الصف أكثر من سبب؛ لا تجمعها كعدد صفوف مستقل). ready=321473، needs_review=100990:

| سبب التحضير | العدد |
|---|---:|
| CANONICAL_TEXT_UNAVAILABLE | 62146 |
| SPOKEN_TEXT_UNAVAILABLE | 62146 |
| SPOKEN_WORD_COUNT_MISMATCH | 62146 |
| CANONICAL_WORD_COVERAGE_INCOMPLETE | 38518 |
| WORD_DIFF_UNMAPPED | 2808 |
| INVALID_WORD_INTERVAL | 426 |
| MISSING_SOURCE_AYAH | 43 |

الصفوف السبعة المعيبة config HF خارجي al_hussayni_al_azazy_kids_qdc وليس ضمن Release 69. تبقى fixtures حقيقية منفصلة؛ لا اختلاق صفوف Release أو ادعاء وجودها في production. خطة تنفيذها يجب أن تميز مصدر التدقيق بوضوح دون استعارة نص حفص لغير حفص.

## 5. المخاطر المعروفة

الهامش المالي أقل من 0.17 دولار؛ قد يوقف hardLimit الخدمات لاحقًا مع الاستهلاك القائم. قراءة حجم volume لا تلغي حد الميزانية أو تثبت تكلفة الاستيراد. allocation النهائي والفهارس غير مقاسة. السماح بحذف testdata لا يسمح لمس admin؛ لم يحتج هذا الفحص أي حذف. snapshot يبقى مرفوضًا بسبب Pro، ورفض الحذف المحلي محفوظ بلا محاولات بديلة. B/offset والبسملة والنشر لم تتغير.

## 6. الخطوة التالية المقترحة

قرار المستخدم بشأن حد الإنفاق القائم وتقدير الدورة أولًا؛ لم أطلب ترقية أو أُنفّذ تغيير ميزانية. بعد حسم القيد يُستأنف D3 فقط: قياس 69+50%، بروفة 9.7.2، dry-run ثم apply وتحقق كل تلاوة، ثم قبول الاختبارات والنشر كما فُوّض. لا D4 أو أي مرحلة بعدها. العمل متوقف الآن.

قرارات ذاتية: تفعيل بند التوقف المالي عند ثبوت الهامش والتقدير؛ عدم PURGE مع binlog معطل؛ حماية كل صفوف admin دون اختيار هوية غير مثبتة؛ إنشاء launch-blockers كتوثيق جديد؛ الحفاظ على الأدلة التاريخية وعدم إعادة تسميتها نتائج حالية؛ عدم تشغيل وكلاء جدد لتجاوز usage limit الذي أوقف الوكلاء السابقين.
