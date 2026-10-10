# تقدم الدفعة المصرح بها — D2 ثم التشخيص ثم D3–D6

آخر تحديث: 2026-10-10T00:19:17Z. D2 مغلق بأدلة تطبيق البيانات وقبول نشر PR9/10؛ تبدأ الآن مرحلة B للتشخيص الصوتي المحلي. لا كتابة D3 قبل قبول B.

| الخطوة | الحالة | الدليل والحدود |
|---|---|---|
| تنظيف D2 المحلي | manual_cleanup_required | المحاولة الصريحة الوحيدة رفضت بـblocked by policy ولم تنفذ؛ mysqld متوقف والمسار القديم ما زال موجودًا. لا بدائل حذف/نقل/ACL |
| تصحيح status للفشل | طُبّق وتحقق | الثماني المخالفة صُححت؛ failed يلزم needs_review لكل الروايات؛ نتيجة offset الأصلية 8/48/13 ثابتة |
| SQL/البروفة/إعادة staging | نجحت | SQL d3f0db3e…42fe8؛ استعادة 47 جدولًا وبروفة 9.7.2؛ import مرتان وrollback/reapply؛ جلسة واحدة و45 فحص اتصالات قبل statements، COMMIT وSSH exit=0 |
| إنتاج D2 | طبق وتحقق قراءة فقط | نفسSHAالمختبرعلىstaging؛ critical/D1/checksum/collationsثابتة، health/ready200ولوجبلاerrors |
| دمج PR9 ثم PR10 | قبول النشرين ناجح، D2 مغلق | [PR9](https://github.com/jokertools12/AyahX/pull/9) merge 099d8e7: SUCCESS ونافذة ≥604s؛ [PR10](https://github.com/jokertools12/AyahX/pull/10) merge 802720b: SUCCESS للخدمات الأربع ونافذة ≥619s، app232/MySQL0/errors0 وworkers بلا أخطاء جديدة، health/ready200، مصالحة مستقلة، smoke10/10 لكل نشر؛ CI 38006592918 أخضر |
| التشخيص B | بدأ بعد قبول D2 | worktrees مستقلة؛ metrics/بدائل مشروعة فقط. تعطيل حذف scratch الآلي لأن محاولة الحذف رُفضت؛ لا استخراج YouTube |
| D3/D4/D5/D6 | لم تبدأ | بالترتيب فقط، لا D7/D8/A2+ |

سجل السياسة الحالية: `plan/DECISIONS.md`. تقارير D2 القديمة ونتيجة8passed/48failed/13source_unavailable محفوظة دون استبدال ادعائي.
