# تقدم الدفعة المصرح بها — D2 ثم التشخيص ثم D3–D6

آخر تحديث: 2026-10-09T23:54:00Z. تطبيق بيانات D2 متحقق على staging والإنتاج. PR #9 دُمج والخدمات الأربع SUCCESS؛ نافذة قبول العشر دقائق جارية قبل دمج PR #10.

| الخطوة | الحالة | الدليل والحدود |
|---|---|---|
| تنظيف D2 المحلي | manual_cleanup_required | المحاولة الصريحة الوحيدة رفضت بـblocked by policy ولم تنفذ؛ mysqld متوقف والمسار القديم ما زال موجودًا. لا بدائل حذف/نقل/ACL |
| تصحيح status للفشل | طُبّق وتحقق | الثماني المخالفة صُححت؛ failed يلزم needs_review لكل الروايات؛ نتيجة offset الأصلية 8/48/13 ثابتة |
| SQL/البروفة/إعادة staging | نجحت | SQL d3f0db3e…42fe8؛ استعادة 47 جدولًا وبروفة 9.7.2؛ import مرتان وrollback/reapply؛ جلسة واحدة و45 فحص اتصالات قبل statements، COMMIT وSSH exit=0 |
| إنتاج D2 | طبق وتحقق قراءة فقط | نفسSHAالمختبرعلىstaging؛ critical/D1/checksum/collationsثابتة، health/ready200ولوجبلاerrors |
| دمج PR9 ثم PR10 | PR9 SUCCESS وقبوله تحت المراقبة؛ PR10 مسودة | [PR9](https://github.com/jokertools12/AyahX/pull/9) merge 099d8e7؛ [PR10](https://github.com/jokertools12/AyahX/pull/10) base main؛ CI 38006236601 أخضر على 9fce4d3؛ فحص أسرار/startup سليم؛ smoke عام 10/10 |
| التشخيص B | تحضير فقط في worktree مستقل | لا تنفيذ قبل إغلاقD2؛ لا استخراج YouTube |
| D3/D4/D5/D6 | لم تبدأ | بالترتيب فقط، لا D7/D8/A2+ |

سجل السياسة الحالية: `plan/DECISIONS.md`. تقارير D2 القديمة ونتيجة8passed/48failed/13source_unavailable محفوظة دون استبدال ادعائي.
