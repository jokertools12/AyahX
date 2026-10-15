# سجل القرارات

## 2026-10-15 — أساس منشور وقرار الاعتماد البشري

PR26 اجتاز CI contracts/public-ui ونشر staging عند 76fa649 و10 public E2E
حية وGET مصادر للأدمن قبل الدمج main@5b7b04b. جميع خدمات production البرمجية
فُحصت pinned 42b04fd قبل الدمج؛ لا نشر production ضمن هذه الشريحة.

المصدر أثبت أن POST alignment reviews يسمح للمالك العادي بـapproved ثم يصدر
attestation. Astra أكد الخلل. القاعدة: approved/rejected للأدمن الحالي فقط؛
needs_review للمالك بعد تحقق الملكية، وهوية المراجع من auth. roles التفصيلية لاحقًا.
حالة UI لا تمنح صلاحية؛ API يرفض قبل قراءة الوثيقة. فحص live staging/production
وجد 0 alignment documents و0 events؛ لا historical rows تحتاج إلغاء وقت الفحص.

تقرير npm audit كشف 28 تنبيهًا baseline (5 critical/15 high/8 moderate) دون تغيير
اعتماديات في PR26. DEPENDENCY_AUDIT.md يميز runtime/dev ومسار التصحيح؛ تعالج
الإصلاحات المحددة قبل production، ولا يشغل npm audit fix --force دون مراجعة.

## 2026-10-15 — تفعيل التنفيذ والتفويض الخارجي

طلب المالك المرفق supersedes قرار التجهيز فقط أدناه. التنفيذ محلي وعلى موارد
AyahX المتحقق منها: GitHub push/PR/CI/merge مع حماية الفروع، Railway staging
ثم production بعد التحقق، R2، ومهاجرات DB/Redis الإضافية بعد backup/rehearsal.
Sol يملك الموارد الخارجية والملفات المشتركة بالتتابع. لا حذف نهائي أو توسعة
مدفوعة كبيرة دون قرار. consent صاحب الوسائط للوجهة واعتماد الأدمن للتوقيت باقيان.
المسار Desktop نهائي. سجلات الإعداد أدناه تاريخية ولا تلغي التفويض الحالي.

أول شريحة 0.1–0.3: سجل مصادر خادمي لا يفعّل مصدرًا لم تراجع حقوقه، وعقود runtime
للرواية/المصحف/العد والتسجيل والتغطية. لا تستنتج بيانات كاملة من اسم القارئ،
ولا تحول isOpenLicense أو aggregate coverage إلى دليل ترخيص أو إتاحة.

## 2026-10-15 — تجهيز فقط

المالك اختار «تجهيز التشغيل فقط» بعد طلب تنسيق Sol/Astra/Luna. لا يبدأ تنفيذ
المنتج في جلسة الإعداد. تسجيل مسار المشروع يعلو على أمثلة الحزمة التاريخية:
`C:\Users\cpazi\Desktop\ayahX` والحزمة داخله.

## 2026-10-15 — تنسيق Codex الأصلي

Sol/medium للمنسق والتنفيذ، Luna/medium للعمل المحدد، Astra/low للمراجعة الحساسة.
سقف وكيلين فرعيين. ملفات الأدوار أصلية لـCodex، دون API router أو API keys جديدة.
إعداد المستخدم الشخصي لا يتغير. لا نفترض أن تغيير ملفات الإعداد يغير نموذج
محادثة قائمة أو يجبر المنسق على استخدام الثلاثة في كل مهمة.

هذه سياسة ابتدائية، ليست benchmark أو وعدًا بنسبة توفير. سجّل سبب أي تصعيد
ومخرجاته عند التنفيذ. لا تستخدم نماذج أخرى أو provider fallback بصمت.

## 2026-10-15 — القرارات المعمارية محفوظة

قرار الحزمة بتاريخ 15 أكتوبر هو المرجع: React/Vite + Express/MySQL، Browser
client preview/local export، Skia للرسم على السيرفر وFFmpeg للترميز والمزج.
fallback للمصادر المتطابقة فقط؛ نتائج AI مسودات حتى اعتماد الأدمن. لا تغيير لهذه
القرارات في مهمة تجهيز Codex. المجموعات الست في المرحلة 4 تغطي أقسام Admin التسعة.

النشر والبيانات الحية وpush/merge والاتصالات المدفوعة لمزودي التطبيق والرفع الخاص
تحتاج طلبًا يخص الفعل والوجهة. رسائل الوكلاء لا تمنح تلك الصلاحيات.

## 2026-10-15 Task 1.1 inactive foundation acceptance

Astra reviewed the new five-table design and implementation. Keep existing alignment_documents unchanged. Persist snapshot identity/revision as canonical validated JSON with SHA, separate approval/revocation evidence, and composite same-recording current-revision FK. No writer/activation is exposed yet. Run additive DDL explicitly with verified target and backup/restoration/rehearsal receipt, strict SQL and FK checks enabled; DDL is not transactional. A failed initial rehearsal requires a fresh restored scratch. A receipt-backed apply may resume only exact compatible partial schema. Preserve raw SHOW CREATE evidence; normalize only redundant explicit charset implied by the next matching collation and table AUTO_INCREMENT counters.

## 2026-10-15 catalog trust boundary (Task0.3)

Fresh read-only loader will independently validate both audio and canonical-text source approvals, profile/font/count identity and coverage checksums. Embedded approved flags and matching SHA cannot prove reviewer authority. Inject a fresh approval-evidence verifier that defaults to denial until authoritative audit-backed approvals exist. No writer, activation or export-route bypass in this slice. Current disabled CHECKs remain. Reuse a pure canonical JSON/SHA helper without SQL/filesystem imports; preserve existing hashes. Future export must pin revisions and revalidate at worker start, not trust a client snapshot.

## Task1.2 proposed authorization overlay (Astra design review)

Use separate server-read catalog grants (read_only/editor/approver/owner) and append-only catalog audit/evidence events; do not mutate user_roles or infer owner from legacyadmin, firstrow, body/JWTclaims. Current auth LIMIT1 role selection is unsuitable for new overlay because existing schema allows multiple roles. Atomic mutations lock activegrant+target and write audit in sametransaction; audit failure rolls back. Subject/revision/SHA + full context/capability bind approval, current revocation checked eachload. Explicit revocation policy is separate from later actor-role loss. Enforce append-only at DB; request-id retries bind exact payload and conflictingreuse rejects. Guard lastowner.

Bootstrap requires explicitly designated existing account in exact environment and one-time audited bootstrap; user identity clarification pending (email/userID + whether same staging/production). Do not select an existingadmin arbitrarily or grant owner to alladmins. This design has not been implemented or applied. SourceactivationCHECKs remain unchanged; destructive/private-media consent boundaries stillapply.

## Task1.2 runtime obligations before owner bootstrap

Current auth account deletion at server/routes/auth.ts:273-307 deletes users directly after password verification. Before enabling owner grants, protect last active owner against deletion as well as grant revocation, using the same transaction/locks; otherwise existing account deletion bypasses a grant-only guard. Two confirmed owner identities are privately resolved, one existing account per environment.

Audit triggers enforce ordinary UPDATE/DELETE rejection, but the current app database credential may hold schema privileges. Before production authority activation, split explicit privileged migrations/bootstrap from application credentials lacking DROP/TRUNCATE/trigger operations; inventory startup/preDeploy DDL first. Do not remove app privileges while startup still requires schema changes. No credential changes or owner bootstrap in the inactive002 slice.

## Task1.2 accepted grant-management boundary

Owner identities were explicitly designated by the human and privately matched to one existing account in each environment. No account removal is needed. Implement audited bootstrap only for those exact matches; never infer ownership from legacy admin.

Historical grant validity uses grantedAt <= eventTime and revokedAt >= eventTime, with same-millisecond ties trusting server transaction order under the global membership/migration lock. Current authorization rejects every revoked grant. Later role loss or account removal does not erase correctly authorized historical actions. No cryptographic guarantee against privileged database compromise is claimed; production credential isolation remains a gate.

Astra implementation review found no high/medium issue; real MySQL clone23checks cover contention/rollback/deletion versus revocation. Preserve immutable grants/audit evidence and synthetic clone fixtures. Owner bootstrap on application staging follows reviewed merged deployment and live verification of deletion protection. Production remains gated separately.