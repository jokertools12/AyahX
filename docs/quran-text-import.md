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
npx tsx scripts/import-quran-text.ts --manifest server/data/quran-text/v3.2.0-source.json --apply --db-host 127.0.0.1 --db-port 33317 --db-name ayahx_d1_acceptance
```

migration `001_addQuranTextTables.ts` لا تستدعى في startup. DDL idempotent بترتيب parents ثم dependants؛ MySQL DDL له implicit commit. استيراد البيانات transaction واحدة ويستخدم IDs حتمية، ثم يتحقق من checksum النص والكلمات المخزنة قبل commit. لا ينشر أي تلاوة ولا يغيّر UI/ريندر.

## اختبار القبول الحقيقي

```powershell
npx tsx scripts/test-quran-text-db.ts --corpus "$env:TEMP/ayahx-d1/corpus.json" --db-host 127.0.0.1 --db-port 33317 --db-name ayahx_d1_acceptance --out "$env:TEMP/ayahx-d1/db-acceptance.json"
```

هذا الأمر مخصص لقاعدة اختبار قابلة للمسح: يطبق migration مرتين، يستورد مرتين، يتحقق من عدم التكرار، يختبر رفض فساد النص، ثم rollback وإعادة التطبيق.

## rollback

خذ backup أولاً إن كانت بيانات مطلوب الحفاظ عليها. rollback الصريح يحذف الجداول السبعة بترتيب FK العكسي؛ لا يمس `users` أو الجداول الحالية. ليس transaction rollback، ولا يستدعى تلقائياً:

```powershell
npx tsx scripts/import-quran-text.ts --manifest server/data/quran-text/v3.2.0-source.json --rollback-schema --confirm-drop-d1-tables --db-host 127.0.0.1 --db-port 33317 --db-name ayahx_d1_acceptance
```

تطبيق قاعدة التطبيق أو الإنتاج يبقى إجراء منفصلاً غير منفذ في D1.
