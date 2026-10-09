# بيئة التطوير المحلية — D0/D1

هذه الملاحظات تصف بيئة الفحص بتاريخ 2026-10-09 ولا تغيّر ملفات dependencies المتتبعة.

## خط أساس D0

- `npm ci` تعثر بـ `EPERM` عند حذف `node_modules/@esbuild/win32-x64/esbuild.exe` مع وجود عمليات Node/esbuild. لم تُقتل عمليات المستخدم ولم يتغير lockfile.
- استُخدم مؤقتاً `npm install --no-save --ignore-scripts --prefer-offline vite@5.4.19 vitest@3.2.4 typescript@5.8.3 eslint@9.32.0` لتوفير أدوات الفحص محلياً؛ لا تغيير tracked بسبب ذلك.
- `--ignore-scripts` ترك binary الخاص بـ ffmpeg-static ناقصاً؛ تم تشغيل `node node_modules/ffmpeg-static/install.js`، والتحقق من FFmpeg 6.1.1. ملفات binary محلية ignored.
- lint العام ليس أخضر: خطآن و1051 تحذيراً. حسب قرار المستخدم، D1 يفحص الملفات المتغيرة فقط ويمنع أي رسالة جديدة؛ لا إصلاح لـ Brand Studio أو التحذيرات العامة.

## MySQL اختبار D1

- لا توجد MySQL محلية على 3306. استُخدم ZIP رسمي MySQL 8.4.11 خارج المستودع تحت `%TEMP%/ayahx-d1/mysql`؛ تحقق MD5 الرسمي `2e833921898a9a030ea6bfe81bd811bc`.
- data directory مؤقت منفصل، وbind على `127.0.0.1:33317`، وMySQL X معطل. لم تُقرأ إعدادات `.env` ولم تُستخدم قاعدة التطبيق أو أي خدمة إنتاج.
- قاعدة الاختبار الوحيدة: `ayahx_d1_acceptance`. importer يرفض أي write target غير loopback أو لا يبدأ `ayahx_d1_`، والـ rollback يتطلب flag صريحاً.
- هذه بيئة اختبار مؤقتة، وليست migration مطبقة على قاعدة التطبيق.

## أدوات تدقيق مؤقتة

### مرجع البروفة المعتمد بعد قراءة الإنتاج

استُبدلت البروفة السابقة بـ **MySQL 9.7.2 بالضبط** دون تغيير dependencies أو ملفات tracked للبيئة. ZIP رسمي خارج المستودع: `%TEMP%/ayahx-d1-mysql-9.7.2`، SHA-256 `5592ea38e53edd67f5baa68303e7fcf2f0a40fc08978fdb4a7b0c38d12baea17`. bind محلي `127.0.0.1:33319` وmysqlx=0، max_connections=60 وpacket=64MiB، UTC؛ لا إعدادات `.env`. server collation افتراضي 0900 كما في Railway، بينما migration تصرح unicode/bin على الجداول والأعمدة. Windows يستخدم lower_case_table_names=1، وtimezone المحلي +00:00 مقابل SYSTEM/UTC في الإنتاج؛ أسماء الجداول lowercase والتوقيت UTC في الحالتين. الأدلة الجديدة `data/d1-mysql-9.7.2-acceptance.json` و`data/d1-restored-rehearsal.json`. نتائج 8.4.11 أعلاه تاريخية فقط.

`duckdb` و`fonttools` مثبتان في `%TEMP%/ayahx-d1-python` لتدقيق أعمدة HF Parquet وفحص cmap الكامل. لم يتغير requirements أو package-lock. corpus/cache/raw recited text خارج Git. E2E يستخدم Amiri المحلي داخل fixture فقط لتجنب الاعتماد على تحميل Google Fonts أثناء الفحص.
