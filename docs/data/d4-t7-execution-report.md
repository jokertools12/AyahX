# D4 K7: تقرير التنفيذ الحقيقي للتحديد المثبّت

انتهت المحاولات الـ35 المثبّتة في 2026-10-11: **3 passed-v1، و26 failed، و6 source_unavailable**. لا pending ولا نجاح v2. القياسات الفعلية **435/525**؛ المصادر الستة غير المتاحة لها صفر قياسات، لذلك `real_measurements_complete=false` محفوظ دون إعادة تفسيره. هذا دليل عددي للمراجعة في K8، وليس قبولًا بشريًا ولا تأكيد هوية أو رخصة أو نشر.

## ما تغيّر

- أصلح عيب تقريب NCC قبل القفل: القيمة الخام `0.949999997` تفشل، حتى إن ظهرت `0.95` في العرض. الانحدار الصوتي المصطنع ينتج `0.949999996999995` ويثبت الفشل الصحيح.
- أضيف حارس موافقة K2–K4 وقيود مضيف Archive المصادق/خمس قفزات وحراسة المصادر الموقعة قبل GO؛ لم تتغيّر الحاسبة أو العيّنة أو المعايير أثناء القياس.
- أضيف مُصدّر دليل عام للقراءة فقط يحفظ درجات العينات الخام وإحصاءات الجلسات السابقة وبصمة index، ويستبعد مسارات الصوت والروابط الموقعة. لم تُكتب قاعدة بيانات أو تتغيّر حالة نشر.

## ما تحققت منه فعليًا

قُفلت القرارات قبل القياس: commit `8c89443`، وتصحيح توقيت القفل `f9cb245` يثبت `2026-10-10T14:34:56Z`. البداية 2026-10-10T14:41:18.300063+00:00، وآخر invocation 2026-10-11T07:22:10.687165+00:00.

تمت إعادة فحص البايتات الستة للحاسبة وFFmpeg قبل التشغيل والاستئناف. التنفيذ استخدم ملفات ROOT المطلقة المطابقة للقفل؛ بعض نسخ worktree القديمة لها CRLF، فلم تُستعمل بديلًا غير مطابق.

| المدخل | SHA-256 |
|---|---|
| manifest ملف | `c8c312564c3203c99d808508df8ea4f448e950ad93a39a06ad6bb69d4d26287a` |
| selection | `3a730736876c66045219bb7bc761b7c8245c965659519b48213c0d2d6abe1df5` |
| مضيفون مصادقون | `66bfa5ed70d66ae4fc4a02957cc2e27b3d55dad86d09c29270863099258bd9df` |
| FFmpeg | `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00` |
| HF index الفعلي (142461 bytes) | `5a53f7a24f5799e85174154e4e16628bff338a5ab91ff0a6314242e8156abcf2` |
| checkpoint762 الملف | `ca4095d45b3b2be4cb174ed4e86636461f1b9c1640d289598d045edd8cdcb36b` |
| checkpoint762 self hash | `6b1f6ad47a9e27038fbeb0815abcec471d5c6fb12970389eae114dc635abc797` |
| هذا JSON الخام العام | `67b841a0ddcb702322f1514065e9da4e47800f06bf24c5d4865b0f18fd561934` |
| diagnose-qud-audio.py | `79363d0f2e6a51e5947f79c570b1a2d6dac3414b82dc431f0a5264cf2c3bfd65` |
| execute_qud_t7.py | `ae93ac7bb9de242bed5143c432cefc04f599ad2cb46496e28ece529ed951e0a3` |
| lib/acoustic_diagnostics.py | `de4dc87cadb8a1a1bcbff960f9aaed12cc227e679837c6f41bd3149707f8c9fa` |
| lib/hf_serial_ranges.py | `41533931c3228c9d64259e1a6725805fc67336ca2c2781dd9e3619ef2e6482b9` |
| lib/t7_offset_execution.py | `9c1ce774bb0488dff516c794662eb2ee64931a58dfca76854d4ea5e7516b094e` |
| verify-qud-offsets.py | `6125db0ede40c7c009cbe3d836f0d1fed51d9bbc270fb5934fa9fb3da9489429` |

المدخل الإحداثي المثبّت يحتفظ بـ `catalog_chapter_offset_ms` لكل عينة، وقياس HF يحتفظ بـ `source_offset_ms` بالمللي ثانية. لا تغيير إزاحة أو إعادة اختيار. الـ15 عينة لكل تلاوة مقيسة موزعة على ثلاث سور، خمس آيات لكل سورة وفق manifest.

v1 يطلب NCC الداخلي **الخام ≥0.95**، و|lag الداخلي| و|lag الكامل| **≤30ms**، وفرق المدة الكاملة **≤30ms**، ونافذة المصدر الكاملة. تشذيب 300ms المثبّت للتحليل الداخلي لا يستبدل فحص المدة والنافذة الكاملين. NCC الكامل محفوظ للتشخيص؛ لم تُضف له بوابة جديدة. v2 لا يقبل مرشحًا عدديًا وحده؛ يحتاج إثبات السبب وهوية المصدر المحفوظ، ولم يثبت هنا لأي تلاوة.

## ترتيب التشغيل والاستئناف

1. session42097 بدأت في 10 أكتوبر؛ أوقفت إداريًا بـ Ctrl+C قبل Drive لفرض ترتيب 31 boundary ثم4 Drive. checkpoint4: عينة AbdBasit pending وصفر قياسات. لا يُسمّى هذا فشل مصدر.
2. session44437 شغّلت 30 boundary عدا AbdBasit، وأكملت checkpoint711 في `2026-10-10T15:36:41.244522Z`: 420 قياسًا، 3 passed/25 failed/2 مصادر HF غير متاحة، وAbdBasit فقط pending. هذه الجلسة أكملت مستقلّة أثناء توقف حصة الوكيل؛ لم تُعد تلاوة فاشلة عند الاستئناف.
3. session54767 استأنفت AbdBasit فقط من checkpointه: 15 قياسًا/failure، ثم checkpoint737 في `2026-10-11T07:12:33.221538Z`. الفاصل بين نافذتي HF له `59361.754462s`، أكبر من 1800s. صار جميع31 boundary نهائيًا: 3/26/2.
4. session26201 نفّذت Drive الأربعة فقط مرة واحدة بعد31 النهائيين: كل مصدر أعاد محتوى غير صوتي، وسُجّل `SOURCE_NOT_AUDIO_NO_DRIVE_CONFIRMATION_BYPASS`. آخر checkpoint762. لم تُتجاوز صفحة تأكيد/كوكيز/حصة ولم تُعد أي محاولة.

الفاصل الجداري 60052.387 ثانية يتضمن توقف حصة الوكيل والانتظار الإداري؛ ليس زمن CPU أو نقل مستمر، ولا قياس تكلفة. الفترات النهائية والأعداد محفوظة أدناه، والتكلفة يثبتها root من فاتورة Railway فقط.

استخدمت كل الجلسات الحاسبة ذاتها بهذه الوسائط المشتركة (البيانات الخاصة بقيت في TEMP):

```powershell
$env:PYTHONDONTWRITEBYTECODE="1"
$env:OPENBLAS_NUM_THREADS="1"
$env:PYTHONPATH="$env:TEMP/ayahx-d4-duckdb-1.5.6;$env:TEMP/ayahx-d2-python;$env:TEMP/ayahx-d1-python;$env:TEMP/ayahx-d3-python"
$python = "C:/Users/cpazi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
$base = @(
 "C:/Users/cpazi/Downloads/ayahX/scripts/execute_qud_t7.py",
 "--manifest", "$env:TEMP/ayahx-d4-t7-selection-prepared.json",
 "--manifest-sha", "c8c312564c3203c99d808508df8ea4f448e950ad93a39a06ad6bb69d4d26287a",
 "--source-hosts", "$env:TEMP/ayahx-d4-t7-provider-hosts-locked-20261010.json",
 "--source-hosts-sha", "66bfa5ed70d66ae4fc4a02957cc2e27b3d55dad86d09c29270863099258bd9df",
 "--scratch", "$env:TEMP/ayahx-d4-t7-20261010T1440Z-scratch",
 "--checkpoints", "$env:TEMP/ayahx-d4-t7-20261010T1440Z-checkpoints",
 "--ffmpeg", "C:/Users/cpazi/Downloads/ayahX/node_modules/ffmpeg-static/ffmpeg.exe",
 "--execute", "--approved-k2-k4")
# الأولى: & $python @base ; أوقفت إداريًا قبل أي Drive.
$m = Get-Content "$env:TEMP/ayahx-d4-t7-selection-prepared.json" -Raw | ConvertFrom-Json
$boundaryArgs = @()
foreach ($slug in $m.boundary_cohort) {
 if ($slug -ne "abdulbasit_abdulsamad_tarteel") { $boundaryArgs += @("--config", $slug) }
}
# session44437: & $python @base @boundaryArgs
# session54767: & $python @base --config abdulbasit_abdulsamad_tarteel
$driveArgs = @()
foreach ($slug in $m.drive_retry_cohort) { $driveArgs += @("--config", $slug) }
# session26201: & $python @base @driveArgs
```

هذه أوامر إثبات ما نُفّذ، وليست تعليمات لإعادة المصادر الفاشلة. checkpoints append-only محفوظة؛ لا تنظيف محلي.

## إحصاءات النقل المثبتة

| الجلسة/checkpoint النهائي | HF requests /bytes | مصدر requests /bytes | Drive requests /bytes | أدنى فاصل HF المرصود | retries داخل الطلب |
|---|---|---|---|---|---|
| 711 | 956 /3145379301 | 114 /245678521 | 0 /0 | 2.0s | 0 |
| 737 | 30 /92402756 | 3 /9275566 | 0 /0 | 2.0s | 0 |
| 762 | 148 /471196401 | 0 /0 | 4 /0 | 2.0s | 0 |

آخر جلسة Drive: أربع محاولات منفصلة؛ أدنى فاصل بينها 101.56200000003446s، والحد المثبّت 5s وسرعة النقل المحددة 80KiB/s. صفر بيانات صوتية Drive مُقاسة.
إحصاءات HF المسجلة لا تحتوي HTTP500 أو HTTP429 أو retry داخل الطلب. مصدرا HF غير المتاحين فشلا بـ `HTTPException` في مرحلة HF؛ checkpoint711 يحفظ آخر صنف نقل `URLError`، لكن لا يحفظ جسم/رسالة أصلية في هذه الحالة. لذلك لا تُنسب إلى 500/حصة ولا سبب أدق غير محفوظ. لم تُعد المحاولة. الجزء الإداري الأول توقف قبل final transport statistics؛ ظهر في الكونسول requests25/bytes48748956، فلا يُدمج كقياس كامل أو تكلفة فاتورة.

## جدول النتائج الـ35

كل رقم NCC أدناه مأخوذ من الخام، والـJSON يحتوي كل عينة دون تقريب للحكم. lag هو الأكبر بين |الداخلي| و|الكامل|. أسباب الفشل متداخلة: NCC /lag /duration /window، ولا تعني مجموع تلاوات مستقلة.

| التلاوة | الرواية | النتيجة | عينات/سور | min NCC داخلي خام | min NCC كامل | max lag ms | max Δمدة ms | عينات v1 ناجحة | أسباب NCC/lag/مدة/نافذة |
|---|---|---|---|---|---|---|---|---|---|
| abdulbasit_abdulsamad_tarteel | hafs_an_asim | failed | 15/3 | 0.8598965890992302 | 0.18660690494674664 | 44.0 | 261.875 | 6 | 8/2/2/0 |
| abdullah_al_mattrod_qdc | hafs_an_asim | failed | 15/3 | 0.9832974437935507 | 0.18555248074776357 | 63.625 | 273.75 | 12 | 0/2/3/0 |
| abdullah_kamel_way2quran | hafs_an_asim | failed | 15/3 | 0.8713731427891552 | 0.26954394350829225 | 31.75 | 274.0 | 6 | 6/1/2/0 |
| abdulwadood_haneef_mp3quran | hafs_an_asim | failed | 15/3 | 0.7858695618601962 | 0.7859298634889509 | 0.5 | 375.875 | 4 | 10/0/1/0 |
| abdur_rashid_sufi_shubah_qdc | shubah_an_asim | failed | 15/3 | 0.9101975410936674 | 0.2933104652533175 | 50.75 | 273.5 | 9 | 3/3/2/0 |
| abu_bakr_al_shatri_tarteel | hafs_an_asim | failed | 15/3 | 0.8847335793427824 | 0.27926045599959004 | 31.625 | 273.875 | 6 | 8/2/2/0 |
| adel_al_karbalaei_archive_v2 | hafs_an_asim | failed | 15/3 | 0.9692341980613056 | 0.1670207014866795 | 56.75 | 257.875 | 12 | 0/3/3/0 |
| ahmed_al_ajmi_qdc | hafs_an_asim | failed | 15/3 | 0.9283726848136977 | 0.33369011416819006 | 28.25 | 61.5 | 9 | 5/0/1/0 |
| ahmed_issa_al_maasaraawi_mp3quran | hafs_an_asim | failed | 15/3 | 0.9297868276862635 | 0.9285344699022818 | 0.375 | 23.875 | 14 | 1/0/0/0 |
| ahmed_nuayna_qdc | hafs_an_asim | failed | 15/3 | 0.9136555423869078 | 0.2811502799726198 | 29.0 | 273.75 | 12 | 2/0/1/0 |
| ahmed_saleh_rajab_qalon_way2quran | qalon_an_nafi | passed | 15/3 | 0.9500900168209179 | 0.9501966957523832 | 25.5 | 25.125 | 15 | 0/0/0/0 |
| ahmed_shaheen_mp3quran | hafs_an_asim | failed | 15/3 | 0.8319527507704102 | 0.8317486191503123 | 0.5 | 299.625 | 6 | 8/0/1/0 |
| ahmed_talib_bin_humaid_mp3quran | hafs_an_asim | failed | 15/3 | 0.9542601722302959 | 0.9581081395282751 | 0.5 | 34.0 | 14 | 0/0/1/0 |
| akram_al_alaqmi_qdc | hafs_an_asim | passed | 15/3 | 0.9547904566666984 | 0.9530756411854028 | 25.5 | 22.0 | 15 | 0/0/0/0 |
| bandar_baleela_qdc | hafs_an_asim | failed | 15/3 | 0.9125879661183767 | 0.9126404323998766 | 25.375 | 25.375 | 12 | 3/0/0/0 |
| fatih_seferagic_way2quran | hafs_an_asim | failed | 15/3 | 0.9757260391864526 | 0.2527863917586543 | 32.875 | 92.25 | 14 | 0/1/1/0 |
| hani_al_rifai_qdc_128k | hafs_an_asim | failed | 15/3 | 0.9160306927648831 | 0.9187930699940091 | 25.5 | 20.625 | 11 | 4/0/0/0 |
| ibrahim_al_akhdar_drive | hafs_an_asim | source_unavailable | 0/0 | — | — | — | — | 0 | SOURCE_NOT_AUDIO_NO_DRIVE_CONFIRMATION_BYPASS |
| khalid_al_mohana_drive | hafs_an_asim | source_unavailable | 0/0 | — | — | — | — | 0 | SOURCE_NOT_AUDIO_NO_DRIVE_CONFIRMATION_BYPASS |
| khalifa_al_tunaiji_tarteel | hafs_an_asim | failed | 15/3 | 0.971507292245167 | 0.1808806114691133 | 79.0 | 223.25 | 0 | 0/15/1/0 |
| mahmoud_abdul_hakam_mp3quran | hafs_an_asim | failed | 15/3 | 0.9473599244414296 | 0.9479233703005009 | 0.375 | 66.5 | 13 | 1/0/1/0 |
| mahmoud_khalil_al_husary_mujawwad_tarteel | hafs_an_asim | failed | 15/3 | 0.9752215961302041 | 0.18795017443199719 | 26.25 | 275.0 | 14 | 0/0/1/0 |
| mahmoud_khalil_al_husary_qdc_128k | hafs_an_asim | failed | 15/3 | 0.9031388610661475 | 0.903954912448247 | 25.5 | 24.75 | 12 | 3/0/0/0 |
| mishary_rashid_al_afasy_2008_qdc | hafs_an_asim | source_unavailable | 0/0 | — | — | — | — | 0 | HTTPException |
| moaz_mahmoud_hamed_qalon_way2quran | qalon_an_nafi | failed | 15/3 | 0.8699272166915131 | 0.6234916443773096 | 30.125 | 271.5 | 13 | 1/1/1/0 |
| mohammed_ayyub_drive | hafs_an_asim | source_unavailable | 0/0 | — | — | — | — | 0 | SOURCE_NOT_AUDIO_NO_DRIVE_CONFIRMATION_BYPASS |
| mohammed_siddiq_al_minshawi_1967_drive | hafs_an_asim | source_unavailable | 0/0 | — | — | — | — | 0 | SOURCE_NOT_AUDIO_NO_DRIVE_CONFIRMATION_BYPASS |
| mohammed_siddiq_al_minshawi_mujawwad_mp3quran | hafs_an_asim | failed | 15/3 | 0.9193867685922478 | 0.9193794325302969 | 25.5 | 26.125 | 12 | 3/0/0/0 |
| muammar_zainal_al_sukaini_way2quran | hafs_an_asim | failed | 15/3 | 0.9307955099408567 | 0.4413420325838968 | 29.75 | 180.125 | 11 | 3/0/1/0 |
| nasser_al_qatami_mp3quran | hafs_an_asim | passed | 15/3 | 0.979078100137601 | 0.9779256394145976 | 0.5 | 26.25 | 15 | 0/0/0/0 |
| saad_al_ghamdi_tarteel | hafs_an_asim | failed | 15/3 | 0.9473097882653108 | 0.1853268498682184 | 49.875 | 267.5 | 12 | 2/1/1/0 |
| saber_abdulhakam_qalon_way2quran | qalon_an_nafi | failed | 15/3 | 0.9540497863308743 | 0.3532227414640072 | 31.5 | 274.125 | 13 | 0/1/2/0 |
| walid_al_naihi_qalon_mp3quran | qalon_an_nafi | failed | 15/3 | 0.9058094585714593 | 0.3897515150482668 | 30.125 | 274.25 | 9 | 4/1/1/0 |
| walid_atef_way2quran | hafs_an_asim | source_unavailable | 0/0 | — | — | — | — | 0 | HTTPException |
| yasser_al_dosari_archive | hafs_an_asim | failed | 15/3 | 0.8799912401461873 | 0.19830343515585294 | 29.75 | 273.5 | 12 | 2/0/1/0 |

إجمالي أسباب العينات المتداخل: NCC منخفض 77؛ lag أكبر من30ms 33؛ فرق مدة أكبر من30ms 30؛ نافذة غير مكتملة 0. جميع435 نافذة المصدر المقيسة كاملة. هذه أسباب قياسية؛ لا يثبت ذلك وحده codec أو اختلاف التسجيل.
الـ29 المقيسة مصنفة `unresolved/unproven_old_source` في تشخيص السبب لأن تطابق SHA لمصدر المرجع القديم غير مثبت للسور الجديدة المختارة. هذه حالة هوية مجهولة وليست دليلًا على اختلاف التسجيل؛ تمنع منح v2. الدرجات الجديدة لا تحذف الدليل القديم، بما فيه retained_v1_status=failed في المرشحين الثلاثة الجدد.

## نتائج الاختبارات

```text
python -m unittest test_execute_qud_t7 test_prepare_qud_t7_manifest test_t7_host_snapshot
  test_voice_auto_verification test_voice_aligner_once test_report_qud_t7_execution
Ran 55 tests in 0.446s
OK
```

هذه اختبارات offline للوحدات والحراس، منفصلة عن435 قياسًا حقيقيًا أعلاه. تحقق مُصدّر JSON من manifest SHA ومن self hash لكل checkpoint711/737/762 ومن مساواة binding بين الجلسات، واختبار CLI يرفض checkpoint سابقًا مختلف binding ويطابق SHA المعلن مع بايتات الملف على Windows/Linux، وأثبت عدم وجود URL/مسار صوت خاص في JSON. التحقق الكلي:35 نتيجة نهائية،29×15=435،6×0،ولا pending. نسخة DuckDB القديمة كانت namespace بلا connect أو distribution؛ ثُبّت 1.5.6 في مسار TEMP مستقل يوافق httpfs الموجود، واجتازت connect/SELECT42/LOADhttpfs مع autoload/autoinstall معطّلين. لا إعادة كتابة dependencies ولا حذف القديم.

## ما لم يكتمل والمخاطر

-90 عينة لم تُقَس لتعذّر ستة مصادر؛ لا استبدال ولا نجاح تقديري. تبقى needs_review وفق قبول root، ولا تُعاد هذه المحاولات من تلقاء الوكيل.
-لا v2 مقبول أو قبول بشري/تأكيد قارئ. فحص الصوت K4 ما يزال69 unverified؛ POST الحقيقي404 وGET readiness503/MODEL_NOT_CONFIGURED محفوظان في voice-auto-verification، والـECAPA الأصلي له تداخل calibration فلا عتبة قبول مختلقة.
-لم تُنفّذ هنا كتابة DB أو نشر أو تغيير رخص/بسملة؛ `surah_start_basmala_audio_status=unverified` لكل35. لا يُستنتج نشر من offset وحده.
-الخروج1 من executor يحمل نتائج سلبية مصدرة كما صُمم، وليس دليلًا على crash أو خطأ حساب؛ لم تتغيّر المعايير لتخضيره.

## الخطوة التالية والقرارات الذاتية

تسليم الأدلة إلى root لتسجيل K8 advisory metadata والحفاظ على الأدلة السابقة؛ يمنح v1 فقط للمرشحين المثبتين وفق بوابات القبول المستقلة، ويترك v2 للمراجعة البشرية. القرارات الذاتية: استعمال بايتات ROOT المطابقة بدل CRLF المختلف، حفظ نتيجة التوقف الإداري كـpending ثم الاستئناف فقط، فصل النقل الناقص عن التكلفة، عدم إعادة المصادر الستة، وإضافة حفظ إحصاءات الجلسات إلى التقرير العام دون تعديل الحاسبة. لا بدء D5/A1 أو تنظيف محلي.
