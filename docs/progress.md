# تقدم الدفعة المصرح بها — D2 ثم التشخيص ثم D3–D6

آخر تحديث: 2026-10-10T00:03:00Z. تطبيق بيانات D2 متحقق على staging والإنتاج. PR #9 اجتاز قبول النشر الكامل؛ PR #10 دُمج وبدأ نشره. إغلاق D2 ينتظر قبول نشر PR #10.

| الخطوة | الحالة | الدليل والحدود |
|---|---|---|
| تنظيف D2 المحلي | manual_cleanup_required | المحاولة الصريحة الوحيدة رفضت بـblocked by policy ولم تنفذ؛ mysqld متوقف والمسار القديم ما زال موجودًا. لا بدائل حذف/نقل/ACL |
| تصحيح status للفشل | طُبّق وتحقق | الثماني المخالفة صُححت؛ failed يلزم needs_review لكل الروايات؛ نتيجة offset الأصلية 8/48/13 ثابتة |
| SQL/البروفة/إعادة staging | نجحت | SQL d3f0db3e…42fe8؛ استعادة 47 جدولًا وبروفة 9.7.2؛ import مرتان وrollback/reapply؛ جلسة واحدة و45 فحص اتصالات قبل statements، COMMIT وSSH exit=0 |
| إنتاج D2 | طبق وتحقق قراءة فقط | نفسSHAالمختبرعلىstaging؛ critical/D1/checksum/collationsثابتة، health/ready200ولوجبلاerrors |
| دمج PR9 ثم PR10 | PR9 مقبول؛ PR10 دُمج وينشر | [PR9](https://github.com/jokertools12/AyahX/pull/9) merge 099d8e7: SUCCESS للخدمات الأربع ونافذة لوجات ≥604s وhealth/ready ومصالحة الإنتاج وsmoke عام 10/10؛ [PR10](https://github.com/jokertools12/AyahX/pull/10) merge 802720b بعد CI 38006592918 على 3455a5b ومراجعة مستقلة للأسرار/startup وحراس DB |
| التشخيص B | تحضير فقط في worktree مستقل | لا تنفيذ قبل إغلاقD2؛ لا استخراج YouTube |
| D3/D4/D5/D6 | لم تبدأ | بالترتيب فقط، لا D7/D8/A2+ |

سجل السياسة الحالية: `plan/DECISIONS.md`. تقارير D2 القديمة ونتيجة8passed/48failed/13source_unavailable محفوظة دون استبدال ادعائي.
