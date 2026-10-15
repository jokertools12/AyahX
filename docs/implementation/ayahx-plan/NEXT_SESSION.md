# نقطة الاستئناف

الأحدث: الفرع codex/ayahx-server-security-patches يتضمن إصلاحي compression1.8.2
وproxy-addr2.0.8 فقط + HTTP regression4؛ full suite479 pass/6 skip وtsc/build pass.
audit ما زال26 finding؛ التفاصيل DEPENDENCY_AUDIT. افتح PR stacked إلى فرع
codex/ayahx-alignment-approval إلى أن يدمج PR27. PR27 CI أخضر ونشر staging بدأ؛
تحقق من terminal SUCCESS والـrevision bb773db ثم live non-admin reviews=403
قبل الدمج. لا production إلى حين معالجة بقية البوابات؛ pinned42b04fd محفوظ.

آخر تقدم: PR26 مدموج main@5b7b04b بعد CI/staging SUCCESS (76fa649، deployment
40abc3d7-1381-4fb3-b04c-bf688f7cd558) و10 E2E حية. production pinned 42b04fd.
شريحة 1.2 التالية على codex/ayahx-alignment-approval: admin-only timing approval،
27 targeted tests/build/tsc ناجحة، Astra لا high/medium. افتح PR منفصل وأكمل CI
ثم staging/live authorization evidence. فحص DB التاريخي للبيئتين: 0 docs/events.
SOURCE_REVIEW وDEPENDENCY_AUDIT يسجلان حقوق المصادر المعلقة وتنبيهات npm baseline؛
عالج compression/proxy-addr patches ثم مجموعات router/tooling بتحقق مناسب قبل production.
نسخة staging SQL خاصة تم restore لها في ayahx_rehearsal_20261015_f0 بنجاح؛
قاعدة التجربة باقية، لا حذف بيانات أصلية. السجل VERIFICATION يحتوي checksum.

الحالة: التنفيذ الكامل مفعل بطلب المالك بتاريخ 2026-10-15، محليًا وعلى GitHub
وRailway staging ثم production وR2 وقواعد البيانات بعد البوابات. النص أدناه
من جلسة التجهيز تاريخي؛ لا يفرض طلب تفويض روتيني جديد.

الحالي: baseline 42b04fd على codex/ayahx-enterprise-plan. الجرد COVERAGE.md
يربط 47 صفًا بكل المهام الـ28. Luna وAstra عملا فعليًا. أساس 0.1–0.3 مطبق
ومتحقق محليًا فقط: pending-review registry، GET /api/quran/sources للأدمن،
runtime coverage/identity guard، وserver revalidation عبر loader غير موصول بالمخزن بعد.
أصلحت نتيجتا Astra: نطاق التوقيت المعتمد وتمييز interval unknown عن missing.
41 اختبارًا للشريحة؛ full suite 464 pass و6 skip، TypeScript app/node والبناء ناجحة.

التالي: أكمل CI/PR ومراجعة الشريحة، افحص E2E المحلي، ثم staging بعد نجاح البوابات.
افحص pin كل خدمة ومهاجرات preDeploy قبل تغيير المصدر، ولا تنشر production قبل
قبول staging. أكمل source/license reviews ثم canonical font/recording evidence
وربط مخزن approvals/TTL/revision قبل اعتبار 0.1–0.3 مكتملة. راجع schema ثم
backup/rehearsal/dry-run قبل 1.1–1.3، واستكمل بقية صفوف المصفوفة تدريجيًا.

Baseline خارجي: Railway courteous-recreation/6394b364-57bc-4736-8ce1-10dcf382c1e5،
staging e726848b-49ec-45ab-bce8-a1462dd85bc8 وproduction c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6.
لكل بيئة ست خدمات، وSkia وحده عامل الرسم. staging API sleeping على main@42b04fd،
deployment 3d5b8b07-4a06-4883-9f97-f8c170626a6e، وبقية الخدمات SUCCESS وقت الفحص.
Cloudflare account 495659d0e5a689a32e39119fb56190a3: ayahx-audio-staging وayahx-audio-prod؛
r2.dev معطل، CORS محدد للموقع، lifecycle abort multipart 1d فقط ولا object expiry.
staging API بلا OBJECT_STORAGE/R2 vars؛ MYSQL_HOST وREDIS_URL موجودان. افحص
workers وDB settings قبل ربط التخزين. لا credentials في السجل.

عندما يطلب المالك البدء:

1. اقرأ AGENTS.md و.codex/ORCHESTRATION.md وهذه السجلات وحالة Git الفعلية.
2. ثبّت مشروع Desktop والحزمة داخله؛ لا تتبع أمثلة Downloads القديمة.
3. اقرأ المراجع الأساسية المذكورة في .codex/prompts/start-enterprise.ar.md.
4. Sol يراجع المصدر مقابل كل صف في FEATURE_COVERAGE.ar.md. استخدم Luna لفحص
   ملفات محددة إذا كان ذلك يوفر إعادة قراءة فعلية. أعد استخدام الأدلة الحالية.
5. قسّم أول مهمة ناقصة من المرحلة 0 لشريحة قابلة للتحقق؛ عيّن مالكًا لكل ملف،
   وراجع قرارات الهوية/التسجيل والترخيص مع Astra عند الحاجة. لا تنسخ SQL المسودة
   إلى قاعدة حية ولا تفعّل adapters دون مراجعة endpoint/license/consent.
6. بعد كل شريحة حدّث STATUS وDECISIONS وVERIFICATION وهذه النقطة. اذكر آخر
   task/feature IDs والملفات والأوامر والخطوة الدقيقة. استمر حسب الاعتماديات.

إذا تعذر custom role في سطح الأدوات، استخدم معرف النموذج الصريح والسياق الجديد
مع تعليمات ملف دوره كما تسمح قواعد الجلسة، وسجّل طريقة التفويض. لا تخفِ عدم توفر
نموذج ولا تخلط بين إعدادات coding agent ومزود AI الخاص بالتطبيق.

للتشغيل لاحقًا من PowerShell: `.\tooling\codex.ps1 -Mode Start`.
للفحص فقط: `.\tooling\codex.ps1 -Mode Check`؛ الافتراضي Preview دون تنفيذ.
