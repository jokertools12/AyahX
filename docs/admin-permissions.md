# صلاحيات الأدمن

مولّد من `server/admin/adminPermissions.ts`. القرارات الفعلية تُقرأ من قاعدة البيانات في كل طلب.

الجداول المنطقية: roles ← admin_roles، role_permissions ← admin_permissions، permissions سجل التعريفات الجديد. تُحفظ الأدوار والمنح التاريخية؛ المنح ذات permission_key فارغ لا تمنح وصولًا إلى المسارات الجديدة.

| الصلاحية | الوصف | super_admin | admin | content_manager | moderator | support | finance | analyst |
|---|---|---|---|---|---|---|---|---|
| dashboard.read | قراءة صحة النظام والمؤشرات | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| reciters.read | قراءة القراء | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| reciters.write | تعديل بيانات وترتيب القراء | ✓ | ✓ | ✓ | — | — | — | — |
| reciters.visibility | إظهار وإخفاء القراء | ✓ | ✓ | ✓ | — | — | — | — |
| reciters.merge | دمج القراء بخريطة صريحة | ✓ | ✓ | ✓ | — | — | — | — |
| recitations.read | قراءة التلاوات | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| recitations.write | تعديل بيانات وترتيب التلاوات | ✓ | ✓ | ✓ | — | — | — | — |
| recitations.visibility | تغيير الظهور العام للتلاوات | ✓ | ✓ | ✓ | — | — | — | — |
| recitations.move | نقل تلاوة إلى قارئ آخر | ✓ | ✓ | ✓ | — | — | — | — |
| sources.read | قراءة المصادر وصحة الروابط | ✓ | ✓ | ✓ | — | — | — | ✓ |
| sources.write | تفعيل وتعطيل وفحص المصادر | ✓ | ✓ | ✓ | — | — | — | — |
| providers.read | قراءة المزوّدين والأدلة | ✓ | ✓ | ✓ | — | — | — | ✓ |
| providers.license.decide | قرار ترخيص المزوّد: super_admin فقط | ✓ | — | — | — | — | — | — |
| quran.read | قراءة النص القانوني وتكامله | ✓ | ✓ | ✓ | — | — | — | ✓ |
| quran.riwayah.write | تفعيل وتعطيل الروايات | ✓ | ✓ | ✓ | — | — | — | — |
| timings.read | قراءة التوقيتات ومدققاتها | ✓ | ✓ | ✓ | — | — | — | ✓ |
| review.read | قراءة المراجعات البشرية | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| review.decide | قرار المراجعة البشرية | ✓ | ✓ | ✓ | — | — | — | — |
| launch.manage | تغيير علم إطلاق الكتالوج | ✓ | ✓ | — | — | — | — | — |
| storage.manage | إدارة التخزين المرخّص | ✓ | ✓ | — | — | — | — | — |
| render.test | اختبار الريندر الحقيقي، D7 | ✓ | ✓ | — | — | — | — | — |
| settings.read | قراءة سجل الإعدادات | ✓ | ✓ | — | — | — | — | ✓ |
| settings.write | تعديل الإعدادات المسجّلة | ✓ | ✓ | — | — | — | — | — |
| flags.read | قراءة أعلام الميزات | ✓ | ✓ | — | — | — | — | ✓ |
| flags.write | تعديل أعلام الميزات | ✓ | ✓ | — | — | — | — | — |
| audit.read | قراءة وتصدير التدقيق | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| roles.read | قراءة الأدوار والصلاحيات | ✓ | ✓ | — | — | — | — | ✓ |
| roles.manage | تعديل الأدوار والصلاحيات: super_admin فقط | ✓ | — | — | — | — | — | — |
| users.read | قراءة قائمة المستخدمين والأدوار | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| security.self | إدارة جلساتي و2FA | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| security.sessions.manage | إنهاء جلسات الأدمن الأخرى: super_admin فقط | ✓ | — | — | — | — | — | — |

super_admin مطلوب بالإضافة إلى الصلاحية لقرارات ترخيص المزوّد وتعديل الأدوار وإدارة جلسات الآخرين. لا يمكن تقليل منح super_admin أو إزالة دوره من الحسابات الموجودة.

الرموز الحالية للواجهة العامة تحتفظ بتمثيل admin للحسابات super_admin؛ هوية جلسة الأدمن وصلاحياتها تبقى منفصلة وتُقرأ كاملة.

## render.test — قبول D7 الإنتاجي

الصلاحية وحدها لا تكفي: RenderLabService يشترط دورadmin أوsuper_admin صراحةً؛grant عرضية لأي من الأدوار الخمسة الأخرى لا تفتح الأداة. POST `/api/admin/render-lab/jobs` وGET `/:id` يطبقان المصادقة القائمة؛POST يطبقOrigin/rate/schema/audit،qa:true فقط،≤90ثانية وتزامن عالمي1. CLI الخادم مسارroot-operated صريح،يستخدم خدمة القبول نفسها وهويةsuper_admin القائمة دون إنشاء جلسة بشرية أو تعديل حساب.

migration007 الإنتاجية أضافت التعريف العالمي أولًا؛**فُعّلت المنحتان لـadmin وsuper_admin فقط** بعدSUCCESS للخدمات الأربع فيPR21،مع تطابق بصمات الحسابات وuser_roles وD1/D3. [دليل التفعيل](data/d7-render-lab-activation-proof.json). قبلrollback للكود القديم تُسحبgrantIDs الخاصة بـ007 أولًا لأن النسخة القديمة ترفض صلاحية مجهولة. لاstartupseed ولاتغييرuser_roles. [قبولRBACالمحلي](data/d7-render-lab-rbac-proof.json)،[حالةD7](data/render-verification-report.md).


قبول 12 أكتوبر: تسعة فيديوهات فعلية عبر CLI بنفس RenderLabService وهوية الأدمن القائمة، ورفضان صحيحان؛ دون جلسة مصطنعة أو تغيير حسابات. GET غير المصادق عليه للـlab أعاد401/no-store على production، وRBAC لسبعة أدوار و13تحققًا مثبت محليًا. [المصفوفة الإنتاجية](data/d7-production-matrix-proof.json)، [فحص القراءة](data/d7-live-read-smoke-proof.json).
