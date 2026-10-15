# نقطة الاستئناف

آخر تحديث 2026-10-15. التنفيذ الكامل وتفويض GitHub/Railway/R2/المهاجرات الآمنة
مفعلان بطلب المالك؛ لا طلب جديد للخطوات الروتينية. المشروع Desktop والحزمة
المرجعية داخله محفوظة دون تعديل. الهدف ما زال نشطًا والخطة غير مكتملة.

## Git والنشر

- baseline للاستعادة: 42b04fd98912081d6c967ac7ec7cb931ce4519ab.
- PR26 الأساس مدموج main@5b7b04b، وPR27 اعتماد التوقيت للأدمن مدموج main@92b8f62.
- PR28 HTTP security patches مدموج main@0219c0a؛ head b628a8b265dae780759aa1f9b469f51d4ed1ad76.
  CI contracts/public-ui SUCCESS. staging deployment d51ef7ff-e7dc-4185-b8a1-951ac7ef0bc2 SUCCESS؛
  runtime compression1.8.2/proxy-addr2.0.8 وGET rootgzip200/ready200.
- staging السابق bb773db (deployment71d82d6b-2597-4ec2-88be-d7e857339a8f) SUCCESS.
  live user approved/rejected=403، draft على وثيقة غير موجودة=404؛ admin invalid=400
  وapproved على وثيقة غير موجودة=404. لا بيانات أضيفت. moderator فحص محلي فقط لغياب fixture حي.
- أساس staging76fa649: deployment40abc3d7-1381-4fb3-b04c-bf688f7cd558 SUCCESS؛
  GET sources admin200/visitor401، 13disabled؛ public E2E10/10 محلي وحي.
- production code services جميعًا pinned42b04fd؛ لم تنشر تغييرات Enterprise عليه بعد.

## العمل الحالي والملكية

الفرع المحلي codex/ayahx-data-foundation مبني على security-patches/main المحدث.
Sol الفرعي catalog_migration يملك فقط أربعة ملفات migration جديدة: SQL تحت
 database/migrations/ وenterpriseCatalog.ts وCLI scripts/enterprise-catalog-migration.ts
 واختباره. لا يطبق SQL ولا ينشر. المنسق يملك السجلات والتكامل والموارد الخارجية.
Astra راجع تصميم الجداول الخمسة وأكد composite pointer FK والهوية الثنائية
والـreceipts المربوطة بالهدف/المهاجرة وimmutability/revocation. يجب مراجعة التنفيذ
قبل تطبيقه، وتجربته على restored scratch أولًا. لا تحميل migrations عند startup.

## التالي الدقيق

1. قبول PR28 اكتمل كما أعلاه. حافظ على production pin والبوابات.
2. راجع تنفيذ migration من Sol مقابل ملاحظات Astra. عقد الإتاحة هو
   shared/recordingAvailability.ts. لا تمس alignment_documents الموجود المتعارض
   مع مسودة الحزمة ولا جداول المستخدمين/الرندر. لا approvals mutation بهذه الشريحة.
3. جهّز receipts مرتبطة بmigrationSHA وtarget/serverUUID/schema/baseline وbackupSHA،
   ثم rehearsal ودry-run وAstra قبل staging apply. Docker المحلي غير موجود؛
   scratch ayahx_rehearsal_20261015_f0 على MySQL staging مستعاد من backup معروف.
4. أكمل source reviews والخرائط canonical/font hashes وtrusted repository integration؛
   0.1–0.3 ما زالت جزئية. لا توصل snapshot عميل بوصفه سلطة ولا تتجاوز approval.
5. استكمل مهام STATUS/COVERAGE الـ28 كلها، بما فيها9Admin و5Studio و36preset
   والرندر الحقيقي بالصوت والتوقيت، ثم production بعد البوابات.

## الأدلة والقيود

- full local suite بعد HTTP patches:479pass/6skip، app tsc/build pass.
  approval-focused27، foundation-focused41. الأدلة VERIFICATION.md.
- npm audit بعد إصلاحي compression1.8.2/proxy-addr2.0.8:26finding
  (4critical/14high/8moderate). لا audit clean؛ DEPENDENCY_AUDIT يحدد المسارات.
- backup SQL خاص ignored: tooling/reports/enterprise-baseline/staging-before-foundation.sql.
  SHA256843B73766B831500D3E69CD8A8C01F3C4A916A6CF4088D0BA8ADE77C0F90B28B.
  restored scratch:24tables/10achievements/4users. لا تستنتج counts من approximateRows.
- frozen backup INSERT statements12 طابقت restored dump حرفيًا؛ checksum موثق فيVERIFICATION.
  schemaSHOWCREATE يختلف بتصريح CHARACTER SET utf8mb4 زائد بعدrestore؛ Sol يصلح
  normalization الضيق ويحفظ COLLATE/types/defaults/index/FKs. لا تبدأ DDL قبل
  اكتمال هذا الإصلاح وتطابق baseline المقبول. current runtime capacity heartbeat
  يختلف عنbackup، وبقية table checksums/counts متطابقة في فحص المصدر الحي.
- staging/production alignment history counts=0docs/0events وقت الفحص؛ لا revocations عشوائية.
- R2 account495659d0e5a689a32e39119fb56190a3: ayahx-audio-staging/prod، r2.dev معطل،
  CORS محدد؛ lifecycle abort multipart1d فقط. API staging بلاR2/storage env؛
  workers وDB storage integration تحتاج فحصًا. لا تطبق48h على كل bucket.
- HF auth يعمل بحساب مختلف عنGitHub؛ model_search tool غير متاح منtools/list،
  لا استدلال أو jobs أو نقل وسائط. استعمل الوثائق الرسمية بديلًا حتى يصل دور AI.
- آخر usage check12% مستخدم أسبوعيًا؛ لا resets أو شراء رصيد تلقائيًا.

### Task 1.1 update

Implementation and Astra review complete for inactive five-table slice. Restored rehearsal and staging dry-run PASS; 18 tests/lint/strict TS PASS. Current private receipt lives in catalog-rehearsal-result.json (report.receipt), with exact target/server UUID/backup SHA/schema digest/SQL SHA and 24-hour backup freshness gate. Next: finish CI/build, commit/PR, green CI, then apply same reviewed SQL to named staging schema using receipt and verify all prior schema/rows, idempotent dry-run. New source activation and runtime repository remain separate unfinished work. Refresh backup/rehearsal if receipt expires; do not drop failed scratch or user data.
