# دمج خطة AyahX Enterprise مع Complete Master Plan

هذا الملف يربط `AyahX_Complete_Master_Plan` بالحالة الفعلية للمستودع. الحزمة
الجديدة محفوظة كمرجع untracked؛ لا تُعامل ملفات Prisma أو Docker أو Railway أو
R2 فيها كإعدادات جاهزة للتطبيق.

## ما تم تجاوزه لأنه منفذ ومثبت

| بند الخطة الجديدة | الدليل الحالي |
| --- | --- |
| أساس React/Vite + Express/TypeScript + MySQL + Redis/BullMQ | المصدر الحالي وCI؛ لا إعادة بناء stack |
| إزالة DDL من startup وpre-deploy | PR34/PR35، وAPI pre-deploy فارغ في staging |
| RBAC وowner/audit وruntime principals | migrations 001/002، PR41/42، staging evidence؛ production لم يتغير |
| مصدر inventory وواجهة `/api/quran/sources` | `server/services/quranSourceRegistry.ts` وGET المحمي للأدمن |
| ledger لمحاولات حل المصادر | migration 003، repository، PR43، staging apply evidence |
| fallback صارم وهوية Quran | `resolveSource` و`validateResolutionCandidate`، PR43/47 |
| اختبارات التطبيق والرندر الحالية | آخر تشغيل محلي: 103 ملفات، 869 ناجحًا، 6 متخطاة |

## ما يدمج مع قيود المشروع الحالية

| بند الخطة الجديدة | قرار الدمج |
| --- | --- |
| مصادر QUL/QUD/Quran.com/MP3Quran/EveryAyah وغيرها | تبقى inventory candidates؛ لا adapter أو download أو activation قبل evidence قانوني وتقني مكتمل. بوابة `isQuranSourceActivationReady` تمنع التفعيل الناقص. |
| Hugging Face QUD | يُستخدم لاحقًا كـ adapter اختياري للـdraft/provisional مع `HF_TOKEN` على الخادم فقط؛ لا إرسال ملفات خاصة ولا paid calls دون موافقة. |
| Browser/Remotion/WebCodecs | مسار browser المحلي للمعاينة/التصدير فقط. لا Cloud Browser worker على Railway. |
| Skia + FFmpeg | Skia هو renderer الخادمي؛ FFmpeg mux/encode بعد artifact حقيقي. لا قبول من mocks أو health فقط. |
| R2 permanent/temp-48h | يُنفذ بعد reauthentication وفحص الحساب/bucket الحاليين، ثم lifecycle وDB reconciliation في staging. لا نستخدم config الحزمة مباشرة. |
| Admin Studio والقوالب البصرية | نعيد استخدام ما هو موجود ونضيف slices صغيرة قابلة للاختبار؛ الصور والمواصفات مرجع تصميم، وليست دليل تنفيذ أو ترخيص. |

## عناصر متعارضة تُستبعد حتى قرار معماري صريح

- Prisma/PostgreSQL وRailway Postgres: المشروع الحالي MySQL ومهاجراته وruntime
  grants موثقة. لا نبدل قاعدة البيانات أو نضيف خدمة جديدة لمجرد وجودها في الحزمة.
- Cloud Browser server وChromium داخل Railway: يتعارضان مع قرار Skia-only الخادمي
  الحالي. Chromium يبقى ضمن أدوات browser المحلية إن لزم.
- أي `HF_TOKEN` أو `SUPER_ADMIN_INITIAL_PASSWORD` أو R2 secret داخل ملفات الخطة:
  أمثلة فقط، ولا تُنسخ إلى Git أو `VITE_*` أو سجلات Railway.
- ادعاءات 99.99% أو “No placeholders” لا تُعد معايير قبول؛ البديل لا يحدث إلا
  داخل نفس الرواية/المصحف/العد/البصمات وبسجل محاولة دائم.

## ترتيب التنفيذ بعد الدمج

1. ربط resolver بحد خدمة موثوق ومُحقّق، مع adapter واحد مُراجع فقط؛ ثم اختبارات
   persistence/idempotency تحت MySQL staging.
2. إكمال recording coverage وcanonical text/font identity قبل أي مصدر حي.
3. فحص Cloudflare R2 بعد إعادة المصادقة، ثم تطبيق prefixes/lifecycle/CORS على
   staging فقط مع دليل object/DB expiry.
4. قبول artifact حقيقي من Skia ثم FFmpeg مع فحص الصورة والتشكيل والصوت والتوقيت
   وسجلات العامل؛ بعدها فقط مراجعة نشر staging ثم production.

لا يغيّر هذا الدمج أي خدمة خارجية أو متغير سري، ولا يعلن اكتمال الخطة.
