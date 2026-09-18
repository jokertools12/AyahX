# نشر Quran Reels (AyahX) على Railway — دليل التشغيل الاحترافي الخالي من الطوابير

يعتمد المشروع على بنية معمارية هجينة فائقة السرعة (**Zero-Queue Instant Rendering**):
تتم معالجة وتوليد إطارات الفيديو بدقة فائقة على معالج الرسوميات (GPU) مباشرة، بينما يتولى السيرفر التلميع والترميز السحابي الفوري إلى MP4 ستوديو عبر Native FFmpeg في ثانيتين فقط وبدون أي طوابير انتظار أو استهلاك مفرط للذاكرة.

## شكل الخدمات الخفيفة على Railway

```text
المستخدمون (إنتاج متزامن بلا حدود وبدون أي طوابير)
   |
   v
web (الواجهة + واجهة API + محرك معالجة FFmpeg السريع)
   |----------- MySQL (قاعدة البيانات للمستخدمين والاشتراكات)
   |----------- Railway Bucket (اختياري لتخزين الفيديوهات)
```

> **ملاحظة معمارية هامة:**
> تم إلغاء تشغيل Chromium Headless وأخذ لقطات الشاشة المتكررة التي كانت تسبب انهيار الريندر واستهلاك الذاكرة. أصبحت حاوية Docker أصغر بنحو 700MB وأسرع بمقدار 5 أضعاف في النشر والاستجابة على Railway.


## 1) تجهيز نسخة GitHub بأمان

افتح PowerShell داخل مجلد المشروع:

```powershell
cd "C:\Users\cpazi\Downloads\ayah-clip-maker-main - Copy (2)"
git init
git branch -M main
git add .
git status
```

قبل تنفيذ `git commit` تأكد أن القائمة لا تحتوي على:

- `.env`
- `uploads/renders`
- `node_modules`

إذا ظهر أي ملف أسرار، لا تكمل. نفّذ `git reset` ثم أخبر المطور.

أنشئ مستودعاً جديداً وفارغاً في GitHub (Private، ولا تنشئ README أو .gitignore من GitHub لأنهما موجودان محلياً)، ثم نفّذ:

```powershell
git add .
git commit -m "Prepare Railway deployment"
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

استبدل `USERNAME/REPOSITORY` بالقيمة التي يعطيك GitHub. افتح المستودع وتأكد أن `Dockerfile` و`package.json` و`database/schema.sql` موجودة، وأن `.env` غير موجود.

## 2) إنشاء مشروع Railway

1. افتح `https://railway.com` واضغط **Login** ثم سجّل باستخدام GitHub.
2. اختر **New Project** ثم **Deploy from GitHub Repo**.
3. وافق على ربط Railway بـGitHub عند الطلب.
4. اختر المستودع والفرع `main`.
5. سمِّ الخدمة الأولى `web`.
6. افتح الخدمة ثم **Settings → Source**. يجب أن يكون المصدر هو مستودع GitHub، وRoot Directory فارغاً.
7. اترك Dockerfile الافتراضي؛ الملف الموجود في جذر المشروع اسمه بالضبط `Dockerfile`.
8. اترك **Start Command** فارغاً في web؛ سيستخدم Railway الأمر الموجود في Dockerfile: `npm run server`.

قد يظهر أول Deploy فاشلاً قبل إضافة قاعدة البيانات والمتغيرات. هذا متوقع؛ لا تحذف الخدمة.

## 3) إضافة الخدمات بالترتيب

من Project Canvas استخدم **+ New**:

### MySQL

اختر **Database → MySQL** وانتظر حتى تصبح الحالة **Active/Running**. لا تضف Public Domain ولا Public Access لقاعدة البيانات.

### Redis

اختر **Database → Redis** وانتظر حتى تصبح الحالة **Active/Running**. لا تضف له نطاقاً عاماً.

### Bucket

اختر **+ New → Bucket/Storage Bucket**، وسمّه مثلاً `renderstorage` (اسم بلا مسافات أو شرطات لتسهيل المراجع). بعد إنشائه افتح تبويب **Credentials** واحتفظ بالقيم التالية داخل Railway فقط:

- `BUCKET`
- `ACCESS_KEY_ID`
- `SECRET_ACCESS_KEY`
- `REGION`
- `ENDPOINT`
- `urlStyle` أو ما يعادله

لا تجعل الـBucket عاماً؛ التنزيل في التطبيق يتم بروابط موقعة قصيرة العمر.

## 4) متغيرات خدمة web

افتح خدمة `web` ثم **Variables**. استخدم زر **Reference** عند ربط خدمة بخدمة؛ لا تكتب كلمة مرور MySQL يدوياً.

### مراجع MySQL وRedis

إذا كانت أسماء الخدمات هي `MySQL` و`Redis`، فالمراجع تكون هكذا. إن غيّرت الأسماء، استخدم الاسم الظاهر في Canvas بالضبط:

```text
MYSQL_HOST=${{MySQL.MYSQLHOST}}
MYSQL_PORT=${{MySQL.MYSQLPORT}}
MYSQL_USER=${{MySQL.MYSQLUSER}}
MYSQL_PASSWORD=${{MySQL.MYSQLPASSWORD}}
MYSQL_DATABASE=${{MySQL.MYSQLDATABASE}}
REDIS_URL=${{Redis.REDIS_URL}}
```

### قيم ثابتة

```text
NODE_ENV=production
RENDER_QUEUE_DRIVER=bullmq
RENDER_WORKER_CONCURRENCY=1
MAX_CONCURRENT_RENDERS=1
RENDER_STORAGE_DIR=/tmp/renders
OBJECT_STORAGE_DRIVER=s3
OBJECT_STORAGE_FORCE_PATH_STYLE=false
LOG_LEVEL=info
```

Railway يحقن `PORT` تلقائياً؛ لا تضع `PORT=3001` في الإنتاج.

### متغيرات الـBucket

استخدم **Reference** إلى خدمة الـBucket أو انسخ القيم من Credentials إلى هذه الأسماء:

```text
OBJECT_STORAGE_BUCKET=${{renderstorage.BUCKET}}
OBJECT_STORAGE_ACCESS_KEY_ID=${{renderstorage.ACCESS_KEY_ID}}
OBJECT_STORAGE_SECRET_ACCESS_KEY=${{renderstorage.SECRET_ACCESS_KEY}}
OBJECT_STORAGE_REGION=${{renderstorage.REGION}}
OBJECT_STORAGE_ENDPOINT=${{renderstorage.ENDPOINT}}
```

الاسم `renderstorage` هنا مثال؛ استخدم اسم خدمة الـBucket الفعلي. اترك `OBJECT_STORAGE_PUBLIC_BASE_URL` فارغاً.

### الأسرار

ولّد قيمتين عشوائيتين على جهازك:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

شغّل الأمر مرتين، ثم أضف:

```text
JWT_SECRET=<القيمة-الأولى>
METRICS_TOKEN=<القيمة-الثانية>
```

لا تضع هذه القيم في GitHub ولا ترسلها في لقطة شاشة.

### CORS مؤقتاً

بعد توليد Railway Domain لخدمة web، أضف النطاق الذي ظهر لك دون `/` في النهاية:

```text
CORS_ORIGIN=https://your-web-service.up.railway.app
```

بعد ربط نطاقك الخاص، تصبح القيمة مثلاً:

```text
CORS_ORIGIN=https://example.com,https://your-web-service.up.railway.app
```

### مفاتيح اختيارية

انسخ فقط المفاتيح التي تملكها فعلاً، ولا تنسخ قيم localhost أو بيانات MySQL المحلية:

```text
PEXELS_API_KEY=...
GEMINI_API_KEY=...
LOVABLE_API_KEY=...
OPENAI_API_KEY=...
QF_ENV=prelive
QF_CLIENT_ID=...
QF_CLIENT_SECRET=...
```

## 5) تهيئة قاعدة البيانات تلقائياً

أضف إلى خدمة `web` فقط:

1. **Settings → Deploy → Pre-deploy Command**.
2. اكتب:

```text
npm run db:setup
```

3. ضع **Pre-deploy Timeout** على `300` ثانية.
4. احفظ ثم أعد Deploy.

هذا يطبق `database/schema.sql` ويضيف الجداول والفهارس قبل تشغيل API. لا تضع الأمر في Start Command، ولا تضعه في worker.

إذا فشل الأمر، افتح Deploy Logs وابحث عن `Access denied` أو `ECONNREFUSED`. غالباً يكون السبب أن متغيرات MySQL كتبت يدوياً بدلاً من Reference أو أن MySQL لم يصبح Active بعد.

## 6) فحص web

من **Settings → Networking** اضغط **Generate Domain**. بعد نجاح النشر افتح:

```text
https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/health/live
https://YOUR-RAILWAY-DOMAIN.up.railway.app/api/health/ready
```

النتيجة الصحيحة:

- `health/live`: HTTP 200 و`status: alive`.
- `health/ready`: HTTP 200 و`status: ready` و`database: connected`.

في **Settings → Deploy** ضع Healthcheck Path على:

```text
/api/health/ready
```

ثم افتح الجذر `/`. يجب أن تظهر واجهة Quran Reels، وليس JSON. الواجهة والـAPI يعملان من نفس النطاق في هذا المشروع.

## 7) إنشاء render-worker

1. من Canvas اضغط **+ New → GitHub Repo**.
2. اختر نفس المستودع ونفس الفرع `main`.
3. سمِّ الخدمة `render-worker`.
4. اترك Dockerfile هو `Dockerfile`.
5. في **Settings → Deploy → Custom Start Command** اكتب:

```text
npm run worker
```

6. لا تضغط **Generate Domain** لهذه الخدمة.
7. أضف إلى Variables الخاصة بها نفس مراجع MySQL وRedis وBucket، وهذه القيم:

```text
NODE_ENV=production
RENDER_QUEUE_DRIVER=bullmq
RENDER_WORKER_CONCURRENCY=1
MAX_CONCURRENT_RENDERS=1
RENDER_STORAGE_DIR=/tmp/renders
OBJECT_STORAGE_DRIVER=s3
OBJECT_STORAGE_FORCE_PATH_STYLE=false
```

أضف `JWT_SECRET` إذا أردت توحيد الإعدادات، لكنه ليس مطلوباً لبدء العامل. لا تحتاج `CORS_ORIGIN` في worker.

انتظر في Logs رسالة شبيهة بـ:

```text
BullMQ render worker ... started with concurrency 1
```

إذا ظهرت `REDIS_URL is required`، فالـworker لم يرَ مرجع Redis. إذا ظهرت `Object storage credentials are incomplete`، راجع أسماء متغيرات الـBucket.

## 8) ربط النطاق الخاص

نفّذ ذلك بعد نجاح health checks:

1. افتح خدمة `web` فقط.
2. **Settings → Networking → + Custom Domain**.
3. اكتب `example.com` أو النطاق الذي تملكه.
4. سيعرض Railway سجل `CNAME` وسجل `TXT` للتحقق.
5. افتح لوحة DNS لدى مزود النطاق وأضف السجلين كما يظهران حرفياً.
6. للنطاق الفرعي مثل `app.example.com` استخدم CNAME.
7. للنطاق الرئيسي `example.com` استخدم CNAME Flattening أو ALIAS/ANAME إذا طلب مزود DNS ذلك؛ لا تستخدم A record إلى IP ثابت.
8. انتظر حتى تصبح الحالة Verified ويصدر SSL تلقائياً.
9. حدّث `CORS_ORIGIN` بالنطاق الجديد، ثم Redeploy.

لا تربط النطاق بخدمة MySQL أو Redis أو worker.

## 9) اختبار كامل بعد النشر

نفذ الاختبارات بهذا الترتيب:

1. افتح الموقع من النطاق الخاص.
2. أنشئ حساباً جديداً وسجّل الدخول والخروج.
3. أنشئ معاينة Browser Canvas مجانية.
4. أرسل Render واحداً من الخادم.
5. راقب API Logs ثم worker Logs؛ يجب أن ينتقل الطلب `queued → running → succeeded`.
6. نزّل الملف وتأكد أنه يفتح بعد إعادة تحميل الصفحة.
7. أنشئ طلبين متزامنين بحسابين مختلفين؛ لا يجب أن يوقف أحدهما الآخر.
8. ألغِ مهمة ثم استخدم Retry؛ يجب أن تبقى المهمة نفسها ولا يُنشأ Job مكرر.
9. افحص الـBucket وتأكد أن الملف موجود تحت `renders/<userId>/<jobId>.mp4`.
10. اختبر 16:9 و9:16، و720p/1080p للخطة المجانية، و4K/60 FPS للمميزة إذا كان الحساب مميزاً.
11. اختبر طلب الدفع من صفحة الاشتراك ثم راجعه من حساب الأدمن. التفعيل اليدوي بالمحافظ يعتمد على موافقة الأدمن؛ Railway لا ينشئ بوابة دفع تلقائياً.

## 10) تحديث المشروع لاحقاً

بعد أي تعديل محلي:

```powershell
cd "C:\Users\cpazi\Downloads\ayah-clip-maker-main - Copy (2)"
npm run build
npm test
git add .
git commit -m "Describe the change"
git push origin main
```

سيراقب Railway الفرع ويبدأ Deploy تلقائياً لخدمة web وrender-worker. راجع Logs للخدمتين قبل إعلان التحديث للمستخدمين.

## 11) أخطاء شائعة وحلها

| العرض | الحل |
|---|---|
| Build يفشل عند `npm ci` | تأكد أن Railway يستخدم `Dockerfile` من جذر المستودع وأن `package-lock.json` موجود. |
| الصفحة تعرض `Cannot GET /` | تأكد أنك نشرت النسخة التي تحتوي على `dist` static serving، وأن Start Command هو `npm run server`. |
| `health/ready` يعيد 503 | MySQL غير Active أو مراجع `MYSQL_*` خاطئة. |
| `Table ... doesn't exist` | تأكد من `Pre-deploy Command = npm run db:setup` ثم Redeploy. |
| worker لا يلتقط المهام | `RENDER_QUEUE_DRIVER=bullmq` و`REDIS_URL` يجب أن يكونا موجودين في web وworker. |
| فشل رفع الفيديو إلى S3 | راجع Bucket credentials، واجعل `OBJECT_STORAGE_FORCE_PATH_STYLE=false` للـBucket الجديد. |
| Chromium يتوقف أو OOM | أبقِ `RENDER_WORKER_CONCURRENCY=1`، ولا تضف replicas قبل مراقبة RAM. |
| CORS blocked | ضع النطاقين في `CORS_ORIGIN` بدون slash أخير، ثم أعد النشر. |
| النطاق يظهر 404 رغم CNAME | أضف TXT الذي أعطاه Railway؛ كلا السجلين مطلوبان. |
| الفاتورة ترتفع | أوقف replicas الزائدة، راقب CPU/RAM والـBucket، وضع حدود إنفاق من Billing. |

## 12) إعداد البداية المقترح

- web: نسخة واحدة، Healthcheck مفعّل.
- render-worker: نسخة واحدة، concurrency = 1.
- MySQL وRedis: Private فقط.
- Bucket: خاص وروابط تنزيل موقعة.
- لا تضف worker replicas أو 4K بكثافة قبل مراقبة الذاكرة وزمن الطابور.

بعد استقرار الاستخدام، زد worker replicas تدريجياً من إعدادات Railway، وليس `RENDER_WORKER_CONCURRENCY` عشوائياً.
