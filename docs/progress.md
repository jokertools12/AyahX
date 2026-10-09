# تقدم الدفعة المصرح بها — D2 ثم التشخيص ثم D3–D6

آخر تحديث: 2026-10-09T23:39:38.255Z. D2 تطبيق البيانات نجح، ويتبقى الدمج ومراقبة النشر.

| الخطوة | الحالة | الدليل والحدود |
|---|---|---|
| تنظيف D2 المحلي | manual_cleanup_required | المحاولة الصريحة الوحيدة رفضت بـblocked by policy ولم تنفذ؛ mysqld متوقف والمسار القديم ما زال موجودًا. لا بدائل حذف/نقل/ACL |
| تصحيح status للفشل | الكود متحقق، التطبيق لم يبدأ | commit727cd33؛ 16/16 اختبار وlint/TypeScript ناجحان؛ failed يلزم needs_review لجميع الروايات |
| SQL/البروفة/إعادة staging | جار التحضير | SQL القديم محفوظ؛ SQL d3f0db3e…42fe8؛ استعادة47جدولًا وبروفة9.7.2 نجحت: تصحيح8حالات، importمرتان وrollback/reapply؛ transport قيد الاختبار |
| إنتاج D2 | طبق وتحقق قراءة فقط | نفسSHAالمختبرعلىstaging؛ critical/D1/checksum/collationsثابتة، health/ready200ولوجبلاerrors |
| دمج PR9 ثم PR10 | لم يبدأ | CI وفحص أسرار أولًا؛ SUCCESS وhealth/ready و10min logs بعد كل merge؛ rollback عند regression |
| التشخيص B | تحضير فقط في worktree مستقل | لا تنفيذ قبل إغلاقD2؛ لا استخراج YouTube |
| D3/D4/D5/D6 | لم تبدأ | بالترتيب فقط، لا D7/D8/A2+ |

سجل السياسة الحالية: `plan/DECISIONS.md`. تقارير D2 القديمة ونتيجة8passed/48failed/13source_unavailable محفوظة دون استبدال ادعائي.
