# تقدم الدفعة المصرح بها — D2 ثم التشخيص ثم D3–D6

آخر تحديث: 2026-10-10T03:33:12.398224+00:00. D2 وB مغلقان؛ D3 توقف إلزامي رقم5 بسبب سعة MySQL. لا كتابة D3 على stage/prod؛ D4–D6 لم تبدأ.

| الخطوة | الحالة | الدليل والحدود |
|---|---|---|
| تنظيف D2 المحلي | manual_cleanup_required | المحاولة الصريحة الوحيدة رفضت بـblocked by policy ولم تنفذ؛ mysqld متوقف والمسار القديم ما زال موجودًا. لا بدائل حذف/نقل/ACL |
| تصحيح status للفشل | طُبّق وتحقق | الثماني المخالفة صُححت؛ failed يلزم needs_review لكل الروايات؛ نتيجة offset الأصلية 8/48/13 ثابتة |
| SQL/البروفة/إعادة staging | نجحت | SQL d3f0db3e…42fe8؛ استعادة 47 جدولًا وبروفة 9.7.2؛ import مرتان وrollback/reapply؛ جلسة واحدة و45 فحص اتصالات قبل statements، COMMIT وSSH exit=0 |
| إنتاج D2 | طبق وتحقق قراءة فقط | نفسSHAالمختبرعلىstaging؛ critical/D1/checksum/collationsثابتة، health/ready200ولوجبلاerrors |
| دمج PR9 ثم PR10 | قبول النشرين ناجح، D2 مغلق | [PR9](https://github.com/jokertools12/AyahX/pull/9) merge 099d8e7: SUCCESS ونافذة ≥604s؛ [PR10](https://github.com/jokertools12/AyahX/pull/10) merge 802720b: SUCCESS للخدمات الأربع ونافذة ≥619s، app232/MySQL0/errors0 وworkers بلا أخطاء جديدة، health/ready200، مصالحة مستقلة، smoke10/10 لكل نشر؛ CI 38006592918 أخضر |
| التشخيص B | مغلق | 48/48 و720 عينة؛ v1 مطابق720/720. أسباب4codec/1constant_lag/31boundary/12unresolved، لا drift مثبت. ثلاث تلاوات مقبولةv2 بقرار مستقل؛ لا DB/publish بعد. [التقرير](data/d3-audio-failure-diagnosis.md)، [قرارv2](data/d3-offset-v2-accepted.json)، [108 اختبارات](data/b-root-tests-108.json). إعادةsegments75 مرجعًا ضمن نطاق صريح، وخمسة overlays فعلية خارجGit |
| D3 | غير مغلق — توقف إلزامي5 | تحضير69/422463؛ البديل24/143590؛ payload223.1MB مقابل118.5MB حرة. نسخة age51 جدولًا متحققة؛ [التقرير](data/d2-d6-storage-stop-report.ar.md)، [قياسالحجم](data/d3-local-binary-size-measurement.json)، [جدول69](data/d3-recitation-status-at-stop.md). 483pass/6skip/0fail وtsc/lint المتغير ناجحان. لا migration أو import عن بُعد |
| D4/D5/D6 | لم تبدأ | ينتظر قرار السعة/النطاق ثم قبول D3؛ لا D7/D8/A2+ |

سجل السياسة الحالية: `plan/DECISIONS.md`. تقارير D2 القديمة ونتيجة8passed/48failed/13source_unavailable محفوظة دون استبدال ادعائي.
