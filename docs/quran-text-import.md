# تشغيل D1 واسترجاعه

## مصدر النص

`server/data/quran-text/v3.2.0-source.json` يثبت URL وSHA-256 لملفي script وsurah_info من QUD Release. لا يؤخذ النص القانوني من HF. تُحفظ الكلمات الأصلية كما هي؛ ornament النهائي `۝<رقم>` يُستبعد من عدد الكلمات لأنه علامة رقم آية، و`text_simple` حقل بحث مشتق فقط، لا يستبدل `text_uthmani`.

## dry-run

```powershell
npx tsx scripts/import-quran-text.ts --manifest server/data/quran-text/v3.2.0-source.json --output "$env:TEMP/ayahx-d1/corpus.json"
```

الافتراضي dry-run بلا اتصال DB. يقارن hash الملفين، وكل آية وكلمة بالمرجع، ويحسب checksum وأعداد المصدر. يحتاج output parent directory موجوداً.

## تطبيق محلي صريح

أنشئ قاعدة اختبار محلية تبدأ `ayahx_d1_`، ثم:

```powershell
npx tsx scripts/import-quran-text.ts --manifest server/data/quran-text/v3.2.0-source.json --apply --db-host 127.0.0.1 --db-port 33319 --db-name ayahx_d1_acceptance_972
```

migration `001_addQuranTextTables.ts` لا تستدعى في startup. DDL idempotent بترتيب parents ثم dependants؛ MySQL DDL له implicit commit. استيراد البيانات transaction واحدة ويستخدم IDs حتمية، ثم يتحقق من checksum النص والكلمات المخزنة قبل commit. لا ينشر أي تلاوة ولا يغيّر UI/ريندر.

## اختبار القبول الحقيقي

```powershell
npx tsx scripts/test-quran-text-db.ts --corpus "$env:TEMP/ayahx-d1/corpus.json" --db-host 127.0.0.1 --db-port 33319 --db-name ayahx_d1_acceptance_972 --out "$env:TEMP/ayahx-d1/db-acceptance.json"
```

هذا الأمر يرفض أي إصدار غير MySQL **9.7.2**، ومخصص لقاعدة اختبار محلية قابلة للمسح: يطبق migration مرتين، يستورد مرتين، يتحقق من عدم التكرار، يختبر رفض فساد النص، ثم rollback وإعادة التطبيق. يفحص information_schema لكل عمود نصي؛ ويثبت اختلاف كلمتين بالحركات في DISTINCT وفي مفتاح فريد على جدول اختبار مؤقت. لإلزام اختبار join مع users على نسخة الإنتاج المستعادة، أضف `--require-existing-users`.

## rollback

خذ backup أولاً إن كانت بيانات مطلوب الحفاظ عليها. rollback الصريح يحذف الجداول السبعة بترتيب FK العكسي؛ لا يمس `users` أو الجداول الحالية. ليس transaction rollback، ولا يستدعى تلقائياً:

```powershell
npx tsx scripts/import-quran-text.ts --manifest server/data/quran-text/v3.2.0-source.json --rollback-schema --confirm-drop-d1-tables --db-host 127.0.0.1 --db-port 33319 --db-name ayahx_d1_acceptance_972
```

rollback المدمّر مسموح محليًا فقط. لا يُنفذ على Railway؛ التفويض الحالي لجذر الإنتاج يقتصر على CREATE TABLE IF NOT EXISTS للجداول الجديدة وINSERT فيها وقراءات التحقق.

## SQL حتمي ومسار Railway المنفصل

جرد الإنتاج أثبت أن كل الجداول والأعمدة النصية القائمة تستخدم `utf8mb4_unicode_ci` رغم افتراضي الخادم `0900_ai_ci`. migration تحدد unicode صراحة على الجداول والأعمدة الجديدة؛ عمودا `text_uthmani` يستخدمان `utf8mb4_bin`. لا FK إلى جدول سابق، ولا ALTER له، ولا ربط بالـ startup.

```powershell
npx tsx scripts/import-quran-text.ts --manifest "$env:TEMP/ayahx-d1/source-manifest.json" --sql-output "$env:TEMP/ayahx-d1-mysql-9.7.2/d1-import.sql"
npx tsx scripts/apply-quran-text-railway.ts --target railway-production --inventory docs/data/d1-railway-inventory.json --corpus "$env:TEMP/ayahx-d1/corpus.json" --sql "$env:TEMP/ayahx-d1-mysql-9.7.2/d1-import.sql" --backup-verification docs/data/d1-backup-verification.json --rehearsal-report docs/data/d1-restored-rehearsal.json
```

الثاني dry-run يتصل للقراءة فقط. التطبيق الصريح أمر منفصل بإضافة `--apply --confirm-production --out docs/data/d1-railway-production-verification.json`. يرفض تغير هوية القاعدة أو أعداد الجداول الحرجة أو تصادم الأسماء، ويشترط backup مستعادًا وبروفة ناجحة. يُمرّر SQL عبر SSH stdin إلى mysql داخل الخدمة باتصال واحد ودفعات 500 صف؛ كلمة المرور تُحل داخل الخدمة، ولا public TCP أو إعدادات جديدة. staging تحتاج `--production-inventory` لإثبات اختلاف server_uuid، ولا تنفذ عليها الاختبارات المدمرة.

SQL الخام والـ dump وأي corpus/cache/audio تبقى خارج Git. الـ dump ونسخته المستعادة يحتويان بيانات خاصة: خارج المستودع والمجلدات المتزامنة، ويُحذفان بعد إغلاق المرحلة حسب قرار المستخدم. أدلة الأعداد والـ hashes والبنية فقط في `docs/data/`. سجل العمليات الفعلي في `docs/railway-ops-log.md`.
