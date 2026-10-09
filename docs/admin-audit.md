# جرد لوحة الأدمن — A0

تاريخ الجرد: 2026-10-09 (Africa/Cairo)
المستودع: `C:\Users\cpazi\Downloads\ayahX`
المرجع التنفيذي: `docs/plan/00_MASTER_PROMPT.md` ثم `docs/plan/02_ADMIN_PLAN.md`
الحالة: قراءة فقط؛ لا migrations ولا endpoints ولا UI جديدة.

## تقرير المرحلة A0 — جرد الأدمن (قراءة فقط)

### 1. ما الذي تغيّر (ملفات/جداول/endpoints)

- أُضيف هذا الملف فقط لتوثيق A0.
- لم تتغير واجهة المستخدم أو الخادم أو قاعدة البيانات.
- commit الحالي `456d1da8b682dc907471e114743ae0983b1e2ca8` على `main`، ولا يوجد admin worktree متصل.

### 2. ما الذي تحققت منه فعلياً (أوامر + مخرجات/لقطات)

#### واجهة المستخدم الحالية

- `src/App.tsx` يحتوي routes عامة وحسابية فقط؛ لا يوجد `/admin/*`.
- لا يوجد `src/pages/AdminPage.tsx` ولا `src/components/admin` ولا hook إدارة مخصص.
- `src/components/ProtectedRoute.tsx` حماية تسجيل دخول عامة، وليست RBAC للأدمن.
- `src/lib/api.ts` يعرف الأدوار `admin | moderator | user` فقط؛ لا توجد أدوار الخطة (`super_admin`, `content_manager`, `finance_manager`, `support`, `analyst`).
- git history يثبت إزالة `server/routes/admin.ts` (637 سطراً)، `src/pages/AdminPage.tsx` (1316)، `src/hooks/useAdmin.ts` وملفات إعدادات الإدارة في commit `1d5b42d38a409fc5da264e509c439b052ec52b66` بعنوان إزالة لوحة الأدمن القديمة وواجهاتها. لا يجوز اعتبار تلك الملفات جزءاً من النظام الحالي.

#### endpoints الحالية

`server/index.ts` يركب:

```text
/api/auth
/api/videos
/api/users
/api/subscriptions
/api/achievements
/api/social
/api/services
/api/render-jobs
/api/quran
/api/alignments
```

لا يوجد `/api/admin/*`. توجد فحوصات محدودة داخل المسارات الحالية تعتمد `req.user.role === 'admin'` لملكية بعض عمليات alignments/render jobs، لكنها ليست middleware RBAC أو audit trail.

#### قاعدة البيانات وmigrations الحالية

`database/schema.sql` يحتوي 21 جدولاً حالياً:

`users`, `profiles`, `user_roles`, `saved_videos`, `video_comments`, `video_likes`, `user_follows`, `subscriptions`, `payment_requests`, `daily_video_usage`, `daily_cloud_render_usage`, `daily_render_engine_usage`, `achievements`, `user_achievements`, `favorite_surahs`, `favorite_reciters`, `favorite_performers`, `notifications`, `render_jobs`, `system_settings`.

المسارات الموجودة في `server/db/migrations` هي:

- `addAlignmentTables.ts`
- `addRenderJobsTable.ts`
- `ensurePlanEntitlementSchema.ts`

لا توجد migrations لـ `audit_logs`, `permissions`, `role_permissions`, `admin_sessions`, `app_settings`, `feature_flags`, CMS، الإشعارات الإدارية، المدفوعات/الكوبونات، style/background/font catalog، AI governance، reports، storage/backup/job runs، أو featured ayah sets المذكورة في الخطة. `system_settings` خدمة مستخدمة حالياً، لكنها ليست `app_settings` ذات version/audit المقترحة.

#### التصميم والـ RTL

- `tailwind.config.ts` و`src/index.css` يقدمان CSS variables الحالية (`--primary` وغيرها)، Cairo للواجهة و`.font-quran` بخط Amiri.
- مكونات shadcn الحالية و`components.json` هي مصدر النمط؛ لا يوجد `docs/design-tokens.md` مستقل.
- `public/render-harness.html` يختبر خطوطاً عربية محلية (Amiri, Amiri Quran, Noto Naskh Arabic, Scheherazade وغيرها).
- لا توجد tokens أو shell أدمن حالية يمكن إعادة استخدامها؛ أي لوحة جديدة يجب أن تستخرج هذه القيم وتحافظ على RTL والـ responsive/keyboard/reduced motion بدلاً من اختراع هوية.

#### مصفوفة الربط المطلوبة مقابل الحالة

| مجال خطة الأدمن | الحالة في checkout الحالي | الدليل |
|---|---|---|
| auth/JWT/RBAC/Zod/audit | غير منفذ كطبقة admin؛ auth عام فقط | `server/index.ts`, `server/middleware/auth.ts` |
| Dashboard و`/admin/*` | غير موجود | `src/App.tsx` وغياب AdminPage |
| users/content/Quran catalog | لا توجد admin endpoints | routes الحالية أعلاه |
| finance/plans/coupons | `subscriptions` و`payment_requests` عامة فقط | schema الحالي |
| settings/flags/CMS/notifications | `system_settings` و`notifications` فقط | schema + settingsService |
| styles/backgrounds/fonts | أصول/خطوط ثابتة، بلا CRUD admin | `public/fonts`, render harness |
| AI providers/logs/prompts | لا admin governance route/table | لا ملفات admin حالية |
| reports/storage/backups/jobs | `render_jobs` فقط | migration الحالية |

### 3. نتائج الاختبارات

خط الأساس المشترك موثق بالتفصيل في [data-audit.md](C:\Users\cpazi\Downloads\ayahX\docs\data-audit.md): Vitest `426 passed / 6 skipped`، TypeScript exit 0، public E2E `10/10`، وlint exit 1 بسبب خطأين و1051 تحذيراً. لم تُشغّل migrations أو Express startup لأن ذلك يكتب إلى قاعدة البيانات ويخالف A0.

### 4. ما لم يكتمل أو يحتاج قراري، وسببه

- لا يمكن تأكيد “فرع admin”؛ لا يوجد فرع/worktree إداري في checkout أو worktree list، والتاريخ يثبت إزالة النظام القديم.
- لا توجد جداول أو endpoints أو UI يمكن توصيلها الآن؛ تنفيذها ينتمي إلى A1 بعد موافقة المستخدم.
- لا توجد لقطات production أو اختبار ضد خدمة حية؛ ذلك محظور في هذه المرحلة.

### 5. المخاطر المعروفة

- إعادة استخدام الاسم `user_roles` دون migration/قيود واضحة قد يخلط صلاحيات المنتج الحالية مع RBAC الإداري.
- غياب audit logs وadmin sessions يعني أن أي A1 يجب أن يبدأ بسياسة owner authorization وidempotent migrations قبل CRUD.
- التصميم الحالي يعتمد tokens في `index.css`/Tailwind؛ إنشاء shell مستقل سيسبب تعارضاً بصرياً وRTL إن لم يُشتق من المصدر.
- lint غير أخضر، وأي إضافة admin ستزيد سطح الاختبار والصلاحيات.

### 6. الخطوة التالية المقترحة

انتظار موافقة المستخدم قبل A1. عند الموافقة، يُقترح أولاً اعتماد مصفوفة الأدوار/الصلاحيات ونطاق الجداول الإدارية، ثم كتابة migrations idempotent وmiddleware RBAC وaudit logging، وبعدها shell `/admin` متسق مع tokens الحالية. لا يوجد نشر أو اتصال إنتاجي ضمن هذا الجرد.
