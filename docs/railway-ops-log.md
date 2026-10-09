# سجل عمليات Railway — D1/D2

## 2026-10-09 — فحص D1 قبل الكتابة: متوقف

الطلب المعتمد: إغلاق D1 أولًا، ثم D2؛ استيراد البيانات إلى الرئيسية مسموح فقط بعد اجتياز بروتوكول المطابقة والنسخة الاحتياطية والبروفة. نشر كود التطبيق وتغيير متغيرات/إعدادات الخدمات غير مصرّح بهما.

- المشروع: `courteous-recreation` (`6394b364-57bc-4736-8ce1-10dcf382c1e5`).
- البيئة الرئيسية: `production` (`c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6`).
- خدمة القاعدة: `MySQL` (`2b03e60f-d2fc-446c-b278-f340d472dfd4`).
- CLI: `railway 5.57.9`؛ الدخول متاح، وأدوات Railway محدثة.
- زمن توثيق الفحص: `2026-10-09T10:40:17Z`.
- جميع عمليات القاعدة في هذه الجلسة للقراءة فقط. لم تُجرَ migrations أو imports أو اختبارات مدمرة، ولم يُنشر التطبيق.

### الأوامر والنتائج

استخدمت أوامر CLI سياق telemetry ثابتًا: `RAILWAY_CALLER=skill:use-railway@1.2.6` و`RAILWAY_AGENT_SESSION=ayahx-d1-d2-20261009`. هذه معرفات تشغيل وليست أسرارًا.

| الأمر | النتيجة الفعلية |
|---|---|
| `railway --version` | exit 0؛ الإصدار `5.57.9` |
| `railway whoami --json` | exit 0؛ المستخدم مسجل الدخول؛ لم يُنسخ البريد الشخصي إلى هذا السجل |
| `railway status --json` (مرتان، الثانية ملخصة) | exit 0؛ production وstaging موجودتان؛ صورة MySQL في كلتيهما `mysql:9`؛ مصدر تطبيق الإنتاج GitHub وفرعه `main` |
| `railway variables --help` | exit 0؛ تحذير CLI بأن JSON/KV يتضمنان القيم السرية؛ لذلك تُلتقط القيم في ذاكرة العملية فقط |
| `railway --help` مع استخراج `Agent tooling:` | exit 0؛ المهارات وMCP موجودان ومحدثان |
| `railway variable list --project 6394b364-57bc-4736-8ce1-10dcf382c1e5 --environment c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6 --service 2b03e60f-d2fc-446c-b278-f340d472dfd4 --json` (مرتان) | القراءة نجحت؛ القيم بقيت في الذاكرة ولم تُطبع أو تُحفظ. مسار الاتصال العام لم يتوفر: `MYSQL_PUBLIC_URL` غير موجود. محاولة الفحص المحلي توقفت قبل إنشاء اتصال أو تنفيذ SQL: `PUBLIC_DATABASE_ACCESS_UNAVAILABLE`، exit 1 |
| `railway ssh --help` | exit 0؛ اتصال SSH مباشر بالخدمة مدعوم |
| أمر SSH التالي | exit 0؛ استخدم مفتاح SSH مسجّلًا موجودًا؛ لم يُنشأ أو يُسجل مفتاح جديد. نفّذ SELECT واحدًا فقط |

الأمر الذي قرأ الإعدادات داخل الخدمة (المتغيرات تُحل على الخادم؛ لا توجد قيمة سرية في النص):

```sh
railway ssh --project 6394b364-57bc-4736-8ce1-10dcf382c1e5 \
  --environment c8224c72-2cb3-4c1b-bf4e-85fe5e5309c6 \
  --service 2b03e60f-d2fc-446c-b278-f340d472dfd4 -- \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --batch --raw --skip-column-names -u root "$MYSQL_DATABASE" -e "SELECT JSON_OBJECT('\''mysql_version'\'',VERSION(),'\''sql_mode'\'',@@sql_mode,'\''character_set_server'\'',@@character_set_server,'\''collation_server'\'',@@collation_server,'\''max_allowed_packet'\'',@@max_allowed_packet,'\''global_time_zone'\'',@@global.time_zone,'\''session_time_zone'\'',@@session.time_zone,'\''system_time_zone'\'',@@system_time_zone,'\''max_connections'\'',@@max_connections,'\''max_user_connections'\'',@@max_user_connections,'\''schema_character_set'\'',(SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()),'\''schema_collation'\'',(SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()));"'
```

### نتيجة المطابقة

| الحقل | Railway production | المرجع/الشرط |
|---|---|---|
| MySQL | `9.7.2` | اختبار D1 السابق على `8.4.11`؛ اختلاف إصدار رئيسي |
| character_set_server / schema | `utf8mb4` / `utf8mb4` | مطابق للترميز المطلوب |
| collation_server / schema | `utf8mb4_0900_ai_ci` / `utf8mb4_0900_ai_ci` | **مختلف عن `utf8mb4_unicode_ci` المطلوب** |
| sql_mode | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` | مقروء فعلًا؛ المقارنة الكاملة بمتغيرات المحلي لم تُستكمل بعد مانع collation |
| max_allowed_packet | `67108864` bytes (64 MiB) | مقروء فعلًا |
| global/session time_zone | `SYSTEM` / `SYSTEM` | system_time_zone=`UTC` |
| max_connections | `60` | مقروء فعلًا |
| max_user_connections | `0` | مقروء فعلًا |

الدليل المنظم: [d1-railway-preflight.json](data/d1-railway-preflight.json).

### نقطة التوقف وما لم يُنفذ

توقف التنفيذ عند البند 1 من بروتوكول المستخدم: «فرق جوهري (مثل إصدار 5.7 أو اختلاف collation) = توقف وإبلاغ». لم تُغيّر إعدادات الإنتاج أو collation لأي جدول. وجود صورة `mysql:9` في staging لا يثبت إصدارها الفعلي أو مطابقة بقية الإعدادات؛ لم يُفحص ذلك بعد التوقف.

لم يُنفذ جرد الجداول/عدّ الصفوف/فحص تصادم الأسماء، أو backup/restore، أو rehearsal، أو dry-run متصل بالإنتاج، أو تطبيق D1. لا توجد نتيجة تحقق لاحق على الرئيسية. لم تُستكمل إضافات تدقيق D1 المطلوبة في الطلب الجديد ولم يبدأ D2. لم تُعد اختبارات D1 في هذه الجلسة؛ أدلتها المحلية السابقة موثقة في data-audit.md.

GitHub لم يُدفع ولم يُفتح PR في هذه الجلسة؛ إغلاق D1 مشروط بإكمال الفحوص الإضافية والبروتوكول. لا commit على main ولا merge ولا deploy.

قرار مقترح لاستئناف العمل: اعتماد `9.7.2` مرجعًا للبروفة الفعلية مع إبقاء collation الجداول الحالية كما هو، وإلزام جداول D1/D2 الجديدة فقط بـ `utf8mb4_unicode_ci`. هذا استثناء مقترح من شرط المطابقة الحالي ويحتاج موافقة المستخدم قبل استئناف المرحلة؛ لا يتضمن ALTER على الجداول الحالية.

## 2026-10-09 — الاستئناف المصرّح به ونجاح تطبيق D1

هذا القسم أحدث من نقطة التوقف أعلاه. اعتمد المستخدم 9.7.2، وحدد collation النص القرآني bin، ومنع أي ALTER أو FK إلى جدول قائم وأي وصول عام. بقي التطبيق الحالي على main دون نشر أو دمج. الفرع `phase/d1-quran-text` دُفع مبكرًا؛ [PR #9](https://github.com/jokertools12/AyahX/pull/9) للمراجعة.

### جرد ونسخ احتياطي وبروفة

| الأمر/الإجراء الفعلي | النتيجة |
|---|---|
| `git switch -c phase/d1-quran-text`، commit ثم `git push -u origin phase/d1-quran-text` | نجح؛ أول commit `2324d8d`، ثم تصحيح bin/SQL `11bfca9` دُفع أيضًا. لا commit على main |
| SSH SELECT إلى information_schema للجداول والأعمدة وFK وtriggers/events، مع COUNT/CHECKSUM | 40 جدولًا، 34 FK، صفر triggers/events؛ **كل** جدول/عمود نصي قائم unicode_ci. لا تصادم D1/D2. البنية والأعداد فقط في `data/d1-railway-inventory.json` |
| فحص الحمل عبر `SHOW GLOBAL STATUS` | قبل النسخة الاحتياطية ثم قبل التطبيق: Threads_connected=1، Threads_running=2، يتضمن اتصال الفحص نفسه؛ max_connections=60 |
| تنزيل ZIP الرسمي 9.7.2، استخراج `mysqld.exe --version` | `9.7.2` فعليًا؛ ZIP bytes=342737674، SHA-256=`5592ea38e53edd67f5baa68303e7fcf2f0a40fc08978fdb4a7b0c38d12baea17`. خدمة محلية معزولة 127.0.0.1:33319 فقط؛ runtime غير tracked |
| `railway ssh … -- 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --routines --triggers --events --no-tablespaces --skip-comments --hex-blob --set-gtid-purged=OFF "$MYSQL_DATABASE"'`؛ stdout إلى ملف خاص | exit 0؛ 665468 bytes؛ SHA-256=`2713fbe75e4250abd30a44b6c28fd21953ad20c99f182371e1f06f6ba3d1aea4`. خارج Git وخارج المجلدات المتزامنة، ولا قيم مستخدمين في السجل |
| استعادة dump عبر mysql stdin إلى `ayahx_d1_restored_972`، ثم COUNT وCHECKSUM TABLE | exit 0؛ تطابق **الجداول الأربعين كلها** بالأعداد والـ checksums، صفر اختلاف. الدليل `data/d1-backup-verification.json` |
| Railway GraphQL `volumeInstanceBackupCreate` مرة واحدة بعد فحص volume instance | `INTERNAL_SERVER_ERROR`؛ لا إعادة لمحاولة كتابة غير مؤكدة. `volumeInstanceBackupList` بعدها نجح وأثبت عدم وجود snapshot جديد. الموجود منذ 2026-09-19 بقي دون حذف/استعادة/تعديل. الدليل `data/d1-volume-backup.json`. النسخة المنطقية المستعادة متحققة |
| `npx tsx scripts/test-quran-text-db.ts --corpus "$env:TEMP/ayahx-d1/corpus.json" --db-port 33319 --db-name ayahx_d1_acceptance_972 --out docs/data/d1-mysql-9.7.2-acceptance.json` | كل القبول نجح: up×2/import×2، counts/checksum، actual collations، كلمتان بالحركات DISTINCT=2 وunique=2، فساد النص يُرفض، down ثم up/import ناجح |
| نفس اختبار القبول على `ayahx_d1_restored_972` مع `--require-existing-users --out docs/data/d1-restored-rehearsal.json` | نجح كاملًا؛ join/مقارنة مع users دون Illegal mix of collations. الاختبارات المدمرة **هنا محليًا فقط** |

معلمات SSH المشتركة لكل قراءة/نسخة/تطبيق: `--project 6394b364-57bc-4736-8ce1-10dcf382c1e5 --environment <environment-id> --service 2b03e60f-d2fc-446c-b278-f340d472dfd4`. password يُحل داخل الخدمة ولا يمر إلى الجهاز. قراءات SQL رُمّزت base64 ثم فكّت داخل الخدمة لتجنب اختلاف quoting. محاولة inventory أولية استخدمت xxd غير المتاح؛ استُبدلت بقراءة base64 ونجحت. أُصلح parsing لـJSON null محليًا دون كتابة على القاعدة. تصحيح موضع flags في volume CLI كان قراءة فقط. واجهة browser تعذرت بسبب kernel assets؛ لم يتغير إعداد الخدمة. قراءة اعتماد GraphQL من CLI بقيت في ذاكرة العملية فقط ولم تُحفظ أو تُطبع.

### SQL والـ staging والإنتاج

```powershell
npx tsx scripts/import-quran-text.ts --manifest "$env:TEMP/ayahx-d1/source-manifest.json" --sql-output "$env:TEMP/ayahx-d1-mysql-9.7.2/d1-import.sql"
```

نجح؛ SQL SHA-256 المنفذ **`ea0c3d031fc35645c40e284bb614b2ceecad385fcdf156f5d11fc6d9ad995122`**. 180 statement، 7 CREATE IF NOT EXISTS، إدراجات حتمية في الجداول الجديدة فقط، batch=500. SQL الخام خارج المستودع ولا يُرفع. checksum القانوني **`eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4`**.

staging: environment=`e726848b-49ec-45ab-bce8-a1462dd85bc8`، MySQL=9.7.2، server_uuid=`a9d4ce5a-b463-11f1-b4a4-a2aa5c49cf2f` مقابل production=`9496a587-b364-11f1-860a-a2aa73a6893f`. جرد 79 جدولًا سابقًا، بلا تصادم D1/D2. قاعدة مستقلة فعلًا؛ max_connections=151 فيها مقابل 60 في الإنتاج ولم يُغيّر. لم تُستعد فيها بيانات مستخدمي الإنتاج.

```powershell
npx tsx scripts/apply-quran-text-railway.ts --target railway-staging --inventory docs/data/d1-railway-staging-inventory.json --production-inventory docs/data/d1-railway-inventory.json --corpus "$env:TEMP/ayahx-d1/corpus.json" --sql "$env:TEMP/ayahx-d1-mysql-9.7.2/d1-import.sql" --backup-verification docs/data/d1-backup-verification.json --rehearsal-report docs/data/d1-restored-rehearsal.json
```

أول dry-run عاد `RAILWAY_SSH_EXIT_1` قبل أي كتابة؛ فحوص SELECT البسيطة ثم نفس query نجحت، وإعادة dry-run نجحت. خطأ نقل/قراءة موثق، لا اختبار DB فاشل ولا إعادة تطبيق غير مؤكدة. التنفيذ التالي منفصل بإضافة `--apply --out docs/data/d1-railway-staging-verification.json` نجح. نفس ملف SQL مرّ عبر stdin إلى mysql باتصال واحد. تحقق قراءة فقط: 114/6236/77433، كامل النص والكلمات بالـ hash، 35 عمودًا نصيًا بالـcollation الصريح، الأعداد الحرجة لم تتغير. لا down/فساد/ALTER أو اختبار مدمّر على staging.

```powershell
npx tsx scripts/apply-quran-text-railway.ts --target railway-production --inventory docs/data/d1-railway-inventory.json --corpus "$env:TEMP/ayahx-d1/corpus.json" --sql "$env:TEMP/ayahx-d1-mysql-9.7.2/d1-import.sql" --backup-verification docs/data/d1-backup-verification.json --rehearsal-report docs/data/d1-restored-rehearsal.json
npx tsx scripts/apply-quran-text-railway.ts --target railway-production --inventory docs/data/d1-railway-inventory.json --corpus "$env:TEMP/ayahx-d1/corpus.json" --sql "$env:TEMP/ayahx-d1-mysql-9.7.2/d1-import.sql" --backup-verification docs/data/d1-backup-verification.json --rehearsal-report docs/data/d1-restored-rehearsal.json --apply --confirm-production --out docs/data/d1-railway-production-verification.json
```

dry-run exit 0 أولًا؛ ثم apply المنفصل exit 0. SELECT DATABASE() أثبت `railway`، وفحص قبل الكتابة الهوية والأعداد والتصادمات. بعده في `2026-10-09T12:17:45.779Z` تحقق كامل النص والكلمات والـcollations والأعداد. فحص لاحق للجداول السبعة الفعلية أكد table collation unicode_ci وكل FK داخلي فقط، وأعاد الأعداد الحرجة بعد health؛ `data/d1-production-schema-check.json`.

| جدول حرج | قبل | بعد |
|---|---:|---:|
| users | 13 | 13 |
| subscriptions | 16 | 16 |
| payment_requests | 3 | 3 |
| saved_videos (اسم الجدول الفعلي) | 7 | 7 |
| render_jobs | 72 | 72 |
| system_settings | 13 | 13 |
| user_roles | 13 | 13 |
| notifications | 49 | 49 |

`plans` و`videos` غير موجودين قبل وبعد؛ لم يُنشأ بديل لهما. `GET https://ayahx.com/api/health` =200/ok، و`/api/health/ready` =200/ready/database connected. `railway logs --project … --environment … --service <AyahX|MySQL> --since 2026-10-09T12:16:17.484Z --json` نجح: 8 سطور app وصفر errors، وصفر سطور MySQL. نافذة الفحص تبدأ **قبل** التطبيق وتشمل التطبيق وما بعده. تُحفظ فقط الأعداد والتوقيتات في `data/d1-service-precheck.json` و`data/d1-service-postcheck.json`، دون raw logs خاصة. لا تغيير متغيرات أو TCP/proxy ولا deploy للتطبيق.

### تحقق المصادر والاختبارات الحالية

- `scripts/audit-d1-followups.py` على جميع cached configs المنشورة: 69×112=7728 موضع افتتاح؛ 7628 annotation لا يتضمن البسملة، و100 آية أولى غير متاحة، وصفر صف ayah=0. first index/start_ms موثق لكل سورة. **لا فحص موجة صوتية للمقدمات غير المعلّقة**؛ لا تحويل هذا إلى ادعاء غياب صوتي. سبب الاستنتاج ووجود 1:1 منفصلان.
- تصنيف 1714 صفًا: 1707 تكرار مع دليل تطابق كل كلمة وفهرسها، وصفر اختلاف نص/علامات وصفر NFC، و7 صفوف بتوقيتات صفرية/سالبة. الأطفال: 808 تكرار و7 معيبة. النص القانوني لم يتغير. عينتا 2:22 و2:31 واختبار رفض index خاطئ محفوظة باختبارات حتمية.
- `python -X utf8 scripts/test_audit_qud_configs.py` مع Python runtime وPYTHONPATH المحلي: **6/6**. فحص fontTools corpus كامل: 6 خطوط كاملة و10 ناقصة؛ كل نقص وخيارات الواجهة في data-audit.md. CGJ محفوظ ويعامل كتحكم غير مطبوع.
- `npm test`: **439 passed، 6 skipped** (82 ملفًا نجح وملف متخطى)، يتضمن اختبارات FFmpeg/Skia/Chromium القائمة؛ لا تبديل سلوك الريندر.
- `npx tsc --noEmit`: exit 0. TypeScript صريح لملفات D1 server/scripts الجديدة: exit 0. `npx eslint <ملفات D1 المعدلة/الجديدة> --max-warnings 0`: لا رسائل جديدة؛ الملف الحالي services.ts له 15 warning قديمة لم تزد. lint العام خارج النطاق (baseline: 2 errors +1051 warnings).
- `D1_QURAN_CORPUS=<private corpus> npm run test:e2e -- --grep 'D1 full legal corpus' --target desktop --output .e2e/d1-corpus-972`: **1/1**، 22.30s؛ رسم 21202 كلمة فريدة في UI وrender-harness وخروج صفر كلمات فارغة، مع فحص cmap لكل corpus لمنع اعتبار fallback دليلًا. لقطة كل منهما فُحصت بصريًا. fixture Amiri المحلي حتمي؛ **لا يدّعي اختبار CDN الإنتاج**. الصور/report خاصة في tooling/e2e/.e2e ولا تُرفع.

المخاطر/المعلّق: snapshot جديد غير متاح؛ corpus النص مستورد ومتحقق. تدقيق افتتاحات annotation كامل لكن الصوت غير المعلّق غير متحقق، ولا يجوز نشر ادعاء basmala أو تلاوة بناءً عليه. سبعة عيوب timing تبقى needs_review. الجداول الجديدة لا يقرؤها UI/renderer حاليًا؛ الربط D7/D8 فقط.

### مانع إغلاق D1 الصوتي قبل D2

في `2026-10-09T12:26:05Z`، قراءة `/rows` من HF بطلب واحد لكل من `abdul_hamid_ghraio_2025_yt` و`maher_al_muaiqly_qdc` و`al_hussayni_al_azazy_kids_qdc`، offset=0/length=1 مع User-Agent واضح، أعادت **500 للثلاثة** وطلبت إعادة المحاولة لاحقًا. الطلب الأول للآية 2:1 أعاد النتيجة نفسها. لا signed URL محفوظ في Git أو اللوج ولا صوت نُزل. دليل `data/d1-hf-audio-access.json`. قراءة endpoint `/parquet` أعادت 200 لكن بدون ملفات متاحة في الاستجابة الحالية؛ لم تُستبدل المصادر أو تُرفع ملفات ضخمة لتقليد فحص الصوت.

تطبيق النص على الإنتاج ناجح بالأدلة أعلاه، لكن هذا البند من إضافات تدقيق D1 غير مكتمل. لا انتقال إلى D2 قبل اكتمال D1 طبقًا لشرط المرحلة الواحدة. dump الخاص يبقى خارج المستودع والسحابة حتى إغلاق المرحلة؛ snapshot Railway القديم محفوظ. لا كتابة أخرى مطلوبة على الإنتاج لمعالجة هذا المانع، ولا يُنفذ rollback أو أي إصلاح ارتجالي عليه.

مسار HF آخر `/first-rows` للتلاوة `maher_al_muaiqly_qdc` انقطع بـ`ECONNRESET` قبل تلقي HTTP؛ موثق في نفس دليل المصدر. أُوقف mysqld المحلي المملوك لهذه المهمة بأمر `mysqladmin --host=127.0.0.1 --port=33319 --user=root shutdown`، exit 0. نسخة البيانات الخاصة باقية خارج المستودع حتى إغلاق D1؛ لم تُحذف نسخة Railway ولم يُغير أي إعداد أو service.

إعادة قراءة HF `/rows` بعد الانتظار، في `2026-10-09T12:33:28Z`، أعادت 500 ورسالة الانشغال نفسها؛ لا clip متاح للتحقق. بقي مانع الصوت دون تقليد أو قبول صامت.

تحديث GitHub: `git commit -m "test: audit full Quran corpus and QUD repetition evidence"` =`2a74f38` ثم `git push` نجح؛ `git commit -m "docs: record verified D1 Railway import and pending audio audit"` =`1a0f41e` ثم `git push` نجح. فُحص status/diff/stat/secret patterns قبل كل commit وdiff --check بعد تصحيح whitespace في الوثائق. تحديث وصف [PR #9](https://github.com/jokertools12/AyahX/pull/9) بالعربية نجح؛ ظل مسودة دون merge. `git ls-remote` أثبت SHA الفرع البعيد مطابقًا للمحلي؛ لا ملفات خاصة/SQL كبير/corpus/cache/audio أو قيم أسرار رُفعت.
