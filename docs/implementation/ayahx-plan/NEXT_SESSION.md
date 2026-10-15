# نقطة الاستئناف — 2026-10-15

الهدف Enterprise الكامل نشط وغير مكتمل. طلب المالك في attachment38097f07 يجيز
GitHub/Railway/R2/migrations مع gates؛ لا تشغيل أو شراء reset/credits تلقائيًا.
الهدف Desktop checkout والحزمة المرجعية محفوظة دون تعديل/untracked.

## Git والقبول

- repo jokertools12/AyahX؛ baseline42b04fd98912081d6c967ac7ec7cb931ce4519ab.
- PR26 الأساس وPR27 admin-only timing وPR28 HTTP patches مدموجة.
- PR29 الجداول الخمسة الخاملة مدموج main90bf8f8273c335e1086b33778329d8a6823d26d7.
  tests497pass/6skip، focused18pass، lint/types/build، CI contracts/public-uiSUCCESS.
- PR30 trusted read-only loader مدموج main58d0f5a1e76321df38aa2e6a2eb6688496a7eb10؛
  headcdba88f4c107e2d4ed619f8332e3ac0844822448؛ focused95pass (44new)، lint/types/build
  وCI contracts/public-uiSUCCESS؛ Astra لا high/medium في الشريحة المعزولة.
- الفرع الحالي codex/ayahx-catalog-access مبني على main58d0f5a.

## قاعدة البيانات الفعلية

- staging project6394b364-57bc-4736-8ce1-10dcf382c1e5 / env e726848b-49ec-45ab-bce8-a1462dd85bc8.
- MySQL serverUUID6e077998-c7b7-11f1-8cb6-a2aac0196f86، version9.7.2، schema railway.
- backupخاص staging-before-foundation.sql SHA843b73766b831500d3e69cd8a8c01f3c4a916a6cf4088d0ba8ade77c0f90b28b.
- restored scratch ayahx_rehearsal_20261015_f0؛ 12INSERTs frozenbackupمطابقة،
  canonical24table schemaSHA49d7536844d05fd3f0dbbc5250208754f3d5f47e12cbf62a38fd716f3aab088f.
- migration SQLSHA7c2285c32aaa29fa1d321fa48ddea09382a882d5b4efe51645684a6fbb4cc433:
  rehearsal/6constraintnegativechecks/dry-run ثم stagingapplyPASS، pending0؛
  24originalschemas و23nonvolatile rowdigests محفوظة؛ capacityheartbeatمستثنى منrowcomparison.
  catalogsources/recordings0، disabledCHECKsباقية. لاproductionSQL.
- receipts/rawproof ignored tooling/reports/enterprise-baseline/. Backup freshness24h؛
  أيmigrationتالية تحتاج backup/rehearsal/receiptجديدة؛ لاdropللـscratch أوuserdata.

## Railway والبوابة المعلقة

- staging API1ff57ef9-b793-4130-ae60-ce8392172cf8 ما زال b628a8b265dae780759aa1f9b469f51d4ed1ad76،
  deploymentd51ef7ff-e7dc-4185-b8a1-951ac7ef0bc2 سبق SUCCESS وقديدخلSLEEPING.
- source patch64461cfe-41b1-41b8-86cb-7a32db50792d يحتوي exactly2fields branchmain+
  commit90bf8f8 فقط؛ accept-deploy رفض برسالة userdidnotapprove. سُئل المالك عبرasync؛
  لاbypassCLI أوretryحتىحلapproval. inspectpendingpatchقبلأيقبول.
- productioncode services كلهاbaseline42b04fd، دونEnterprisepromotion؛ السلسلةSkia-only.
- SSHأعاد accountdiscoveryJSON عندsleep بدلruntime؛ لا تعتمد exit0. أظهرlistdeployments
  SLEEPING ثم publicready200/connected أعاد التنفيذ. markerثمCOPY_VERIFIED مطلوبة.
  actualnewloader SQLprobe علىstagingنجح 1query/0rows/null/0authoritycalls/no writes.
  هذاemptyreadفقط، ليسapproved-row/exportacceptance. Public ready200 بعدschemaapply.

## الشريحة الحالية والملكية

- Solchild catalog_migration يملك ONLY server/services/catalogAccessPolicy.ts
  وsrc/test/catalogAccessPolicy.test.ts: matrixread_only/editor/approver/owner،
  injectedfreshgrants، defaultdeny، noDB/routes/bootstrap. لا تفويض متداخل.
- Luna font_inventory يملك ONLY AUDIO_SOURCE_REVIEW.md لمراجعة Quran.com/EveryAyah.
- المنسق يملك docs/CI/integration/resources؛ لاكتابةمتزامنةلنفسملف.
- Astra راجع Task1.2design: separate catalog_role_grants + append-only catalog_audit_events،
  atomic grant/target locks+audit، exactsubject/context/capability، requestreplay/conflict،
  one-timeauditedownerbootstrap/lastowner. SQL/transactionimplementationباقية.
- سؤال ownerbootstrapaccount صريح (email/userID +staging/production) معلق؛
  لا تختارfirstadmin أوتمنحكلadminowner. Existinguser_rolesتبقىكماهي.

## الاعتماديات التالية

1. استلمpolicy/tests، افحص/CI/راجع، ثم نفذgrants/audit/evidence ومهاجرة إضافية آمنة.
2. loader الحالي defaultauthoritydeny؛ لاactualevidencestore/approvedrows/route/exportwiring.
   freshsequentialchecks ليستatomicexportauthorization؛ verifier/workertransactionلاحقًا.
3. أكمل Task0.1sourceحقوق/endpoint/CORS/rates/revisions و0.2canonicalmushaf/counts/fontbindings.
   TEXT_SOURCE_REVIEW: QULresource-specificrights/hashes/numberingpending، exactQUDuniversalayahs404.
   QUA/cpfairmetadata licenses منفصلةعنrecordingaudiorights. FontsOFLcandidatehashesفقط.
4. Task1.1partial: audit/assets/templates/attempts لمتُهاجر. Task1.2أصلحadminapprovalفقطحتىالآن.
5. أكملCOVERAGE/28tasks:9Admin/5Studio/36realpresets، Browserlocalexport وSkiaMP4/audio/timing/logs،
   R2privateprefixes48hDB/providerexpiry، productionبعدgates. لاrealrenderacceptanceبعد.
6. dependency auditباقٍ26finding (HTTP2fixed فقط)؛ لاproductionجاهز. R2bucketsموجودةprivate
   لكنruntimeلاOBJECT_STORAGEvars و48hexpiryلمتُطبق. لاتفعلمصادر/AIprovidersبصمت.

التحقق التفصيلي والتاريخ في VERIFICATION.md/DECISIONS.md. التقارير والوسائط/private
traces محليةignored، لاcredentials/rowpayloadsفيGit. آخرusagecheck19%weeklyused؛ لاresets.
