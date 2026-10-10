# تقدم الدفعة المصرح بها — D2 ثم التشخيص ثم D3–D6

آخر تحديث: 2026-10-10T00:55:27Z. D2 مغلق بأدلة تطبيق البيانات وقبول نشر PR9/10. B جارٍ؛ نقطة حفظ واحدة كاملة من48، ولا كتابة D3 قبل قبول B.

| الخطوة | الحالة | الدليل والحدود |
|---|---|---|
| تنظيف D2 المحلي | manual_cleanup_required | المحاولة الصريحة الوحيدة رفضت بـblocked by policy ولم تنفذ؛ mysqld متوقف والمسار القديم ما زال موجودًا. لا بدائل حذف/نقل/ACL |
| تصحيح status للفشل | طُبّق وتحقق | الثماني المخالفة صُححت؛ failed يلزم needs_review لكل الروايات؛ نتيجة offset الأصلية 8/48/13 ثابتة |
| SQL/البروفة/إعادة staging | نجحت | SQL d3f0db3e…42fe8؛ استعادة 47 جدولًا وبروفة 9.7.2؛ import مرتان وrollback/reapply؛ جلسة واحدة و45 فحص اتصالات قبل statements، COMMIT وSSH exit=0 |
| إنتاج D2 | طبق وتحقق قراءة فقط | نفسSHAالمختبرعلىstaging؛ critical/D1/checksum/collationsثابتة، health/ready200ولوجبلاerrors |
| دمج PR9 ثم PR10 | قبول النشرين ناجح، D2 مغلق | [PR9](https://github.com/jokertools12/AyahX/pull/9) merge 099d8e7: SUCCESS ونافذة ≥604s؛ [PR10](https://github.com/jokertools12/AyahX/pull/10) merge 802720b: SUCCESS للخدمات الأربع ونافذة ≥619s، app232/MySQL0/errors0 وworkers بلا أخطاء جديدة، health/ready200، مصالحة مستقلة، smoke10/10 لكل نشر؛ CI 38006592918 أخضر |
| التشخيص B | جارٍ، 1/48 محفوظة | أصلحت حدود RMS وشبكة STFT وVAD عند EOF؛31 اختبارًا ناجحًا، ثم7 اختبارات مراجعة مستقلة. إعادة فك أول15عينة تطابقv1 بالضبط والمقاييس الإضافية ضمن1e−7. عطل مكتبة الرسم أوقف configالثاني قبلcheckpoint؛ ثُبّت matplotlib فيTEMP ونجح إخراجPNG واختبارات الحساب، ثمresumeبنفسSHA. مصدر VAD لا يزال مانعًا في الأولى؛ دليل packet/nativeقيدالمراجعة، ولم يعتمدv2. بدائل13 مفحوصة لعينة112 فقط؛ لا حذف بديل أو استخراجYouTube |
| D3/D4/D5/D6 | لم تبدأ | بالترتيب فقط، لا D7/D8/A2+ |

سجل السياسة الحالية: `plan/DECISIONS.md`. تقارير D2 القديمة ونتيجة8passed/48failed/13source_unavailable محفوظة دون استبدال ادعائي.
