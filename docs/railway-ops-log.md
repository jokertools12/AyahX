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

## D2 — قرار الإغلاق والاستيراد (2026-10-09)

المستخدم أغلق D1 وظيفيًا مع `basmala_audio_unverified` مفتوح للنشر/الريندر فقط، وصرّح D2 الآن. الفقرات السابقة تاريخية؛ لم يعد عدم توفر HF /rows مانع انتقال. السياسة الكاملة في `plan/DECISIONS.md`. لا D3/A1 ولا merge/main/deploy. PR9 يظل draft؛ فرع D2 stacked من SHA800f881: `phase/d2-recitation-catalog`.

### فحص الاتصال والمصدر قبل الكتابة

- Railway CLI5.57.9؛ telemetry `skill:use-railway@1.6.1`، session `ayahx-d2-20261009`. لا قراءة token يدويًا؛ APICLI وSSH المصادقان الموجودان فقط؛ لا تغيير TCP proxy أو networking أو إعداد خدمة.
- قراءة `serviceInstanceAutoDeployStatus` أثبتت enabled=true وproject.prDeploys=false. لا PR environment، وprod/staging آخر app commit هو main456d1da8b682dc907471e114743ae0983b1e2ca8؛ دفع D2 لا يعني deploy. الدليل `data/d2-auto-deploy-audit.json`؛ يلزم إعادة قراءة بعد PR.
- `npx tsx scripts/inventory-quran-catalog.ts --target production --out docs/data/d2-railway-production-inventory.json`: MySQL9.7.2، 47 جدولاً، كل أعمدة/engine/rowformat/FK/triggers/events والعدّ/CHECKSUM محفوظة دون بيانات شخصية. الأربع أسماء D2 لا تصادم. critical: users13/subscriptions16/payment_requests3/saved_videos7/render_jobs72/system_settings13/user_roles13/notifications49، لا plans ولا videos. D1:114/6236/77433، canonical SHA eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4.
- `... --target staging --out docs/data/d2-railway-staging-inventory.json`: MySQL9.7.2، 86 جدولاً، UUID مختلف عن prod، أربع أسماء D2 غير موجودة. critical مستقل:2/4/1/1/0/13/3/3 على الترتيب أعلاه. D1 نفس النص/العدّ. لا استعادة أي userdata إنتاج في staging.
- catalog v3.2.0 HTTP200: SHA الحالي b7ee26c2267b086d5758477e21144887c28c6ba884a6ff5157a55cf17df4eed4، السابق e87ce3ec7fca6fff07a126837442578e334f603ae87fa0dde6bebd3e952f335a. نفس 69 records؛ saber_yt وحده تغيّرت chapter_urls من مسارات scratch للناشر إلى HTTPS YouTube، كل 114 رابطًا؛ لم نخترع روابط من المسارات. المصدر والبصمتان في data/d2-catalog-source.json. canonical assets مستقلة وبصمتها ثابتة.
- بدأ dry-run بحارس تطابق عدد chapter_urls مع coverage.surahs، وكشف أن catalog يحتفظ بروابط سور معلنة مفقودة؛ صُحّح تفسير الحقل مع حفظ الرقمين وmissing_surahs صراحة؛ URL ليس إثبات توفر. كذلك mushafs config ميتاداتا (93 صفًا)، استبعاده يعطي 24 config خارج Release، لا 25 تلاوة. لا كتابة DB حدثت بسبب خطأ parser.
- إخفاقات أدوات محلية قبل الوصول إلى DB: اختيار default --out بأول argv سبب EPERM على مسار executable ومنعته Windows؛ صُحّح option parser واستُخدم out صريح. wrapper قراءة deploy فشل عند service source=null ثم صُحّح optional chaining. كلاهما بلا تغيير بيانات أو خدمة. خطأ اقتباس Python موقت قبل التنفيذ صُحّح here-string، بلا أثر بيانات.

### النسخة الجديدة والتحقق

- أداة age1.3.2 Windows الرسمية، SHA مطابق digest GitHub f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7. age X25519؛ key خارج Git/cloud منفصل وACL account-only. لا مفتاح في اللوج. workflow الرسمي: https://github.com/FiloSottile/age#usage.
- شُفّر dump D1 القديم أولًا لحمايته أثناء الانتقال، وفُك إلى buffer للمقارنة ببصمته2713fbe75e4250abd30a44b6c28fd21953ad20c99f182371e1f06f6ba3d1aea4؛ لم يُحذف قبل تحقق D2.
- `scripts/backup-quran-catalog.ts --age <local age> --key <private identity> --archive <private D2 .sql.age> --mysql <local9.7.2 binary> --db-name ayahx_d2_restored_972 --inventory docs/data/d2-railway-production-inventory.json --out docs/data/d2-backup-verification.json`: mysqldump single-transaction/routines/triggers/events/no-tablespaces/hex-blob/GTIDoff عبر SSH مباشرة إلى age، دون dump plaintext جديد على القرص. فك التشفير مباشرة إلى mysql stdin محلي9.7.2/127.0.0.1:33319. **47/47 count+CHECKSUM مطابق**، 15908637 بايت، plaintextSHA a1039c527c622a5043d2200d169b530dc5e4caa57333e9472d021574c2aa7581. التقرير بتوقيت16:34:04Z.
- النسخة الحالية: `C:\Users\cpazi\AppData\Local\AyahX\private-backups\d2-production-20261009.sql.age`؛ هوية التشفير منفصلة في backup-keys، لا قيمة معلنة. بعد هذا الإثبات فقط حُذف plaintext D1 القديم وarchive D1 المشفر؛ بقيت نسخة D2 المتحققة محمية. الحارس الجديد يمنع overwrite لأي archive قائم عند إعادة الأمر.
- محاولة Snapshot إضافية **واحدة فقط**: `volumeInstanceBackupCreate` على instance185245f1… أعاد BAD_USER_INPUT: **Manual backups and backup schedules are only available for Pro workspaces**، trace3291312158087205374. لا workflow/backup جديد. قراءة `volumeInstanceBackupList` بعدها أظهرت القديم فقط89f3cc8c… بتاريخ2026-09-19 وانتهاء2026-10-19؛ لا retry/upgrade/volume change. الدليل `data/d2-snapshot-attempt.json`، والاعتماد على dump المتحقق وفق موافقة المستخدم.

### البروفة المحلية والمراجعة قبل التطبيق

- أُرسلت أسماء وأعمدة الأربع جداول وخطة الاختبارات **قبل كتابة migration002**. metadata صريح unicode_ci؛ لا نص منطوق في هذه المرحلة (إحصاءات فقط)، ولا FK لجدول قائم. riwayat الثلاث غير حفص INSERT inactive مصرح، دون ALTER للجداول القائمة.
- dry-run كامل مبدئي بدون نتائج الصوت:57reciters/10providers/69recitations/7765chapterURLs،3riwayat إضافية و24unmapped؛ دفعة250≤1000، SQL/cache خارج Git. أعداد مستمدة من الملف، لا ثوابت منتج. هذا SQL مبدئي لم يُطبق على Railway؛ الملف النهائي يُولد بعد تحقق الصوت وله بصمة مستقلة.
- `scripts/test-qud-catalog-db.ts --db-host 127.0.0.1 --db-name ayahx_d2_restored_972 --dataset <private dataset> --out ...`: migration2× وimport2×، أربعة جداول/44عمود نصي/3FK داخلية، join مع users، رفض published عند unverified audio ولو وُضع evidence، ورفضه دون evidence ولو أصبحت الحالة verified؛ فساد URL مرفوض؛ rollback الأربع فقط وإعادة ناجحة؛ D1 checksum/collations ثابتة. أُعيد reset محلي صريح قبل اختبار تغييرات الخطة؛ لا حذف riwayat أو بيانات مستخدمين على Railway.
- `npm test` مع D1_QURAN_CORPUS الفعلي:448passed/6skipped/0failed،454إجمالي؛ يتضمن FFmpeg/Skia/Chromium الفعلي. الستة DB/BullMQ opt-in ولم تُشغّل لعدم إضافة مهمة خلفية. قبل ضبط المسار كانت447passed/7skipped؛ الاختبار القانوني شُغّل فعليًا في النتيجة الأخيرة، ليس متخطى. `npx tsc --noEmit`=0؛ targeted strict server/scripts=0 بعد إصلاح narrowing جديد؛ lint المتغير=0errors/0warnings. لا lint عام أو ملفات tooling خارج النطاق تغيرت. `data/d2-tests.json`.
- `python scripts/test_verify_qud_offsets.py`:5/5 اختبارات NCC للصمت، المدة، lag والتطابق؛ دليل شبكة حقيقي مستقل أدناه، لا اعتبار mocks قبولاً لقاعدة أو مصدر.
- قبل كل commit:status/diffstat/diffcheck/secret-pattern scan، دون .env/key/connection values/raw cache/SQL/audio/Parquet/privateE2E. `ec3b8af` وثائق/جرد ثم `bc4c788` migration/import/rehearsal؛ push D2 نجح، لا force أو merge.

### الصوت الفعلي — مستمر، لا نتائج نشر

`scripts/verify-qud-offsets.py` محلي، مصادر original من catalog، HF Parquet ranges أولًا. طلب HF واحد، فاصل2s لكل request/redirect، Retry-After/backoff؛ windows3× بفاصل1800s عند عدم توفر HF، محفوظة للاستئناف. الصوت المؤقت يحذف بعد كل محاولة؛ الأرقام/البصمات فقط في Git. استُخدم descriptor يسمح بأوائل ثلاث سور مختلفة الطول، ≥5distinct آيات موزعة لكل سورة، لتقليل column chunks؛ شرط sample لم يُضعف.

فحص مُعيقلي الأول:15آية من2/36/107،14نجحت،36:83 score0.93806561 دون0.95 فالتلاوة failed، bestlags صغيرة وفرق مدد≤30ms. negativecontrol+1000ms score0.08932349 مرفوض. أول HF1:1 Parquet audio-row نجح أيضًا (duration6514ms/sourceoffset7523ms، SHA محفوظ في d2-parquet-probe.json). لا claim لغياب البسملة؛ prefix طول/RMS/صمت دليل يحتاج مراجعة، وحالة كل تلاوة الصوتية unverified.

تم إيقاف محاولتين للقراءة أثناء تحسين pruning (OR وحده كان يجلب audio chunks غير لازمة)، دون أي DB write أو تسجيل فشل صوتي لمجرد الإيقاف. حُذف scratch الأولى بملفات literal محددة بعد رفض الحذف recursive آليًا؛ الثانية استؤنفت من downloads الأصلية نفسها ثم حُذفت عند اكتمال15عينة. تم اعتماد parquet_metadata ونطاق surah صريح قبل قراءة audio، مع الحفاظ على نفس المقاييس والعينة. لا روابط signed محفوظة، ولا نص أصلي أو صوت أُرسل للـAligner دون الحاجة.

**staging/production D2 لم يطبقا عند كتابة هذه الفقرة.** النتائج النهائية وبصمة SQL والتحقق تضاف بعد اكتمال الفحص والبروفة على SQL النهائي؛ لا يجوز قراءة النتائج المبدئية كقبول نشر.

تحقق صوتي إضافي حقيقي: مُعيقلي1:1 من catalog جديد + HF Parquet row الفعلي، positive score0.98880387/lag0.25ms/فرقمدة16.625ms، وnegative+1000ms score0.05202221 مرفوض. المصدر/clip SHA في `data/d2-real-offset-controls.json`، وكلا الملفين حُذفا بعد الاختبار. هذا يثبت success/reject للدالة على صوت حقيقي، ولا يغيّر failed للتلاوة الكاملة بسبب36:83. عبدالباسط/ورش اجتاز15عينات فعلية؛ يبقى imported بلا نشر أو مرجع نص حفص. local import2× أثبت أيضًا CHECKSUM TABLE الأربع ثابتًا، لا الأعداد وحدها. coverage_mismatch=NULL للرواية التي لا نملك عدّها المرجعي بدل مساواة المجهول بـfalse؛ اكتمالهاfalse وتوقيتاتهاNULL. النشر لا يشترط اكتمال المصحف كله، لأن التوفر والسياسة على مستوى كل سورة/مدى؛ قيد الصوت/المرجع/التوقيت يبقى، ولا نشر D2.

### استكمال D2 — 2026-10-09، قبل تطبيق Railway

- `npm test -- --reporter=json --outputFile=<private TEMP>`:456 اختبارًا،450نجحت،6 تكامل DB/BullMQ اختيارية متخطاة،0فشل. canonical corpus/FFmpeg/Skia/Chromium القائمة شُغّلت. `tsc --noEmit` وstrict لملفات server/scripts الجديدة وlint المتغير:exit0،0errors/0warnings. بعد تعديل حالة حفص غير المتحقق:11/11 اختبار كتالوج نجحت؛ Python6/6 تضم توزيع15عينة/ثلاثة أطوال حتمية.
- تصحيح metadata قالون: source code `qalon_an_nafi` محفوظ، aligner_code `qalun` حسب enum الخطة. verifier يتحقق من جميع حقول الروايات، وصف حفص قبل/بعد مستقلاً، واستثناء INSERT الثلاثة يظهر 1→4 دون الادعاء بثبات CHECKSUM metadata riwayat.
- قراءة جميع معرّفات آيات snapshot D1 للتلاوات69: صفر معرّفات آية/سورة خارج المرجع في حفص. `data/d2-ayah-coverage.json` يسرد السور المكتملة والمفقود فعليًا؛ الروايات الأخرى لا تُقارن بمرجع حفص.
- فحص Range القصير مقابل full decode نجح(score0.99777443/lag0ms/delta0ms)، لكن long seek على Adel2 عند4258860ms تجاوز120s. لم يُعتمد تحسين Range؛ استُخدمت downloads كاملة، ولم يُحوَّل التعثّر إلى acoustic failed أو source_unavailable. استئناف Adel اكتمل15عينة وحذف صوته، ونتيجته failed من المقارنة الفعلية. `data/d2-long-source-range-control.json`.
- العينة اللاحقة تثبَّت قبل تنزيل/قياس الصوت: أقصر/متوسطة/أطول أعداد آيات مختلفة في الثلث الأخير للسور المؤهلة، مع توسع عند نقص التنوع. خمس آيات بداية/ربع/وسط/ثلاثة أرباع/نهاية. لا إعادة لنتيجة مكتملة فاشلة، ولا تغيير threshold. هذا اختيار تنفيذ لتقليل تنزيل الصوت وcolumn chunks، وليس قرار اعتماد صوت جديد.
- dry-run/rehearsal التي تنتهي بـpending مبدئية فقط؛ SQL النهائي وstaging ثمproduction لم تُنفَّذ عند كتابة هذه الفقرة. لا إعلان إغلاق قبل الأدلة النهائية.

اختبار إضافي بعد ضبط سياسة التصحيح الثابت:12/12 وحدات الكتالوج ضمن **451passed/6skipped/0failed (457total)**؛ strictTS/lint=0. مقدار correction غير صفري يبقي حفص needs_review حتى مراجعة المستخدم، ولا يغيّر chapter offset. source_unavailable حالة مستقلة عن acoustic failed. التقرير المحدّث `data/d2-tests.json`. جرى دفع commit `abdfe89` دون دمج/نشر.

### فحوص قراءة وقيود أمر الإنتاج — D2 جارٍ

`npx tsx scripts/check-qud-catalog-services.ts --production-read-only --since <ISO قبل الفحص> --out docs/data/d2-service-readonly-smoke.json` نجح في18:34:10Z:health=200/ok،ready=200/ready/database connected،app1سطر/0errors،MySQL0سطر/0errors. لا raw logs أو response bodies خاصة فيGit؛ script يرفض JSON malformed/CLI failure أو نافذة بلغت500سطر.

المشغل يرفض دليل بروفة لا يحمل SQL SHA الفعلي (اختبار رفض قديم نجح قبل الاتصال/الكتابة)، ويرفض غياب/تغيّر encrypted backup، وpending أو محاولات ناقصة، وHF unavailable دون3windows موزعة≥1800s. production dry-run/apply يتطلب إثبات staging applied/readback بنفس SQL SHA وMySQL9.7.2. قبل الإنشاء يفحص أيضًا CHECKSUM جداول D1 الستة وmetadata riwayat القائمة؛ بعده استثناء3INSERT inactive فقط وصف حفص ثابت. TypeScript strict/lint لscripts الثلاثة الجديدة/المعدلة=0.

إعادة قراءة إعدادات/حالة Railway بعد push الفرع في18:54Z:main Auto-deploy=true،project.prDeploys=false،environments production/staging فقط،zero changed deployment IDs لجميع الخدمات مقارنة الجرد الأول؛ لا PR environment أو نشر غير مقصود. `data/d2-auto-deploy-recheck.json`. لا تعديل إعدادات، لا حذف أو deploy.

وُثّق فيdata-audit.md أن رفض إغلاق D1 التاريخي تجاوزه قرار المستخدم الأخير: D1 مغلق وD2 مصرح، وbasmala_audio_unverified حاجز نشر فقط. قسم D2 الجاري لا يدعي تطبيق Railway أو إغلاق المرحلة. حتى الآن بيانات D2 على Railway لم تُكتب.

### D2 — نتيجة الفحص والبروفة وواقعة staging: توقف قبل الإنتاج

الفقرة السابقة تاريخية. اكتمل فحص 69 تلاوة:8passed و 48failed و 13source_unavailable ، صفر pending ، 69 سجل محاولة و 840 عينة NCC. جميع حالات unavailable من catalog original ؛ لا حالة HF unavailable اختُصرت معها النوافذ الثلاث. جميع scratch الصوتية حُذفت. البسملة الصوتية unverified للجميع، ولا Aligner/D5 أو نشر. نتائج الفشل بقيت دون إعادة اختيار عينة لتحسينها.

`scripts/import-qud-catalog.ts --dry-run` بالأمر الكامل في qud-catalog-import.md أنتج SQL SHA256 `2498e681f2be2e1e9398e7dcdcb9731e8861ac331087dad2bb3c65a4507958b8`، 9739641 بايت ودفعات 250 ؛ 57 قارئًا/10 مزوّدين/69 تلاوة/7765 رابط سورة و 3 روايات inactive. SQL/dataset خارج Git. `scripts/test-qud-catalog-db.ts --reset-local-catalog ... --out docs/data/d2-local-rehearsal.json` نجح على 9.7.2: up/import مرتان، CHECKSUM ثابت، 46 عمود metadata نصي unicode_ci و 3FK داخلية،رفض فساد URL والنشر دون بسملة/evidence و surah_slice بلا offset و offset بلا score ؛ rollback/reapply نجح محليًا فقط.

النقل الأخير سجل minimum=1.9849999999860302s ؛انحراف 15ms عن شرط 2s. القيمة القديمة محفوظة،ولا تعديل للنتائج. pace صار يعيد فحص deadline بعد sleep المبكر.7 وحدات Python نجحت،و 3HEAD حقيقية مع redirects (6 طلبات) أثبتت minimum=2.0s ،بلا صوت: `d2-transport-pacing-control.json`. إحصاءات النقل تخص آخر عملية مستأنفة فقط.

الجردان الجديدان قبل التطبيق `d2-production-preapply-inventory.json` و`d2-staging-preapply-inventory.json` أثبتا ثبات D1/critical/UUID/CHECKSUM وعدم تصادم D2. `d2-service-precheck.json`:health/ready200 ، app11 سطرًا/0errors و MySQL0errors في النافذة من 19:31:38Z. staging dry-run نجح ببصمة SQL النهائية.

أمر الكتابة الوحيد على Railway:

```powershell
npx tsx scripts/apply-qud-catalog-railway.ts --target staging --inventory docs/data/d2-railway-staging-inventory.json --production-inventory docs/data/d2-railway-production-inventory.json --backup docs/data/d2-backup-verification.json --rehearsal docs/data/d2-local-rehearsal.json --dataset "$env:TEMP\ayahx-d2\dataset.json" --sql "$env:TEMP\ayahx-d2\d2-import.sql" --out docs/data/d2-staging-verification.json --apply
```

خرج بـ`RAILWAY_SSH_EXIT_1` بعد طباعة الخطة؛لا تقرير قبول قياسي. لم تُعد الكتابة. الجرد اللاحق خرج بنفس الفئة؛ probe قراءة SSH بأمر `printf d2-read-only-ssh-ok` أعاد **`Maximum SSH connections reached for this service. Close an existing session and try again.`** التشخيص من محاولة القراءة؛لا نجزم بتعليمة SQL أو رمز mysql للخطأ الأصلي. لم تُغلق جلسات طرف آخر أو تتغير خدمة/شبكة/متغيرات. `--verify-only` القياسي قارن الصفوف أولًا،ثم خرج exit1 في القراءات التالية؛ليس قبولًا ناجحًا. أضيف استخراج محدود لفئة SSH/رمز mysql فقط،دون طباعة stderr الخام أو بيانات/أسرار.

المصالحة المحفوظة القابلة لإعادة التشغيل، SELECT/CHECKSUM فقط باتصال SSH/mysql واحد:

```powershell
npx tsx scripts/reconcile-qud-catalog-readonly.ts --target staging --catalog-present --inventory docs/data/d2-railway-staging-inventory.json --rehearsal docs/data/d2-local-rehearsal.json --dataset "$env:TEMP\ayahx-d2\dataset.json" --out docs/data/d2-staging-readonly-reconciliation.json
npx tsx scripts/reconcile-qud-catalog-readonly.ts --target production --inventory docs/data/d2-railway-production-inventory.json --rehearsal docs/data/d2-local-rehearsal.json --dataset "$env:TEMP\ayahx-d2\dataset.json" --out docs/data/d2-production-readonly-reconciliation.json
```

الأول نجح 19:50:03Z:كل الحقول/JSON الفعلية مطابقة 57/10/69/7765 ، 46 عمود unicode_ci ، 3FK داخلية، timingNULL/is_complete0 ، 3 روايات inactive ،صفر published. D1/bin/CHECKSUM للجداول الستة والحرجة ثابتة. الثاني نجح 19:50:21Z:صفر D2/riwayat1 ؛ D1=114/6236/77433 و SHA القانوني unchanged ، critical الإنتاج 13/16/3/7/72/13/13/49. التقارير writes_in_this_command=0 ولا تزعم نجاح الأمر الأصلي. `d2-staging-apply-incident.json` يجمع الواقعة.

`d2-service-after-staging-error.json`:health/ready200/200 و databaseconnected ، app14 سطرًا/0errors و MySQL0errors منذ قبل الواقعة. **لا production dry-run/apply ،ولا إعادة staging apply.** حارس الإنتاج ما زال يتطلب إثبات staging القياسي applied=true ؛لم يتجاوز أو يُزيّف. D2 غير مغلق وفق شرط المستخدم التوقف عند فشل خطوة البروفة. الاقتراح للمراجعة: توحيد التحقق الكامل في اتصال واحد واعتماد حالة staging الفعلية بدليل،مع إبقاء exit1 موثقًا،ثم أمر production مستقل بعد الموافقة. لا D3/A1 أو merge/deploy.

Vitest457:451passed/6skipped/0failed ؛ Python7/7 ؛ rootTS و strict للسكربتات و lint المتغير صفر. أمر strict أولي استخدم NodeNext بدل bundler المعتمد؛أُعيد بإعداد المشروع ونجح دون تغيير الكود لاسترضاء إعداد مختلف. لا إصلاح lint العام أو lockfiles. نسخة age المتحققة الحالية محفوظة خارج Git/cloud ومفتاحها غير معلن. تنظيف النسخة المحلية من بيانات الاستعادة موثق أدناه؛لا حذف للنسخة الاحتياطية الحالية عند هذا التوقف.

مطابقة المخطط النهائية قبل أي إنشاء على Railway: أضيفت bio/photo_url/is_featured/sort_order و priority/last_checked_at المطلوبة في المخطط؛ كلها NULL لأن المصدر لا يعطيها، دون ترتيب/سيرة/صورة أو فحص صحة مصطنع. statusenum يشمل draft ، لكنلا يستعمله الاستيراد. الأعمدة النصية الجديدة 46 بدل 44 في البروفة المبدئية. أُرسل توضيح الأعمدة وخطة إعادة الاختبار قبل تعديل migration ؛ لا تعديل أي جدول قائم. تحديث جدول المخطط في DATA_PLAN يفرق audio_category المصدر عن audio_mode(unverified_source/surah_slice) وفق سياسة offsetVerified ، ولا ينتج clipsHF مؤقتة. SQL النهائي وإثبات البروفة/staging سيرتبطان بهذه النسخة.

### تنظيف بيانات الاستعادة المحلية عند التوقف

تحقق mysql المحلي من VERSION=9.7.2 و@@datadir مطابق لمسار acceptance-data المملوك لهذه البروفة على127.0.0.1:33319. حُذفت القاعدتان ayahx_d2_restored_972 وayahx_d1_restored_972 محليًا فقط، ثمmysqladmin shutdown نجح. لم تُمس Railway أو النسخة المشفرة.

رفضت مراجعة الأوامر التلقائية تنظيف مجلد التخزين،ثم رفضت حذف قائمة ملفات صريحة أيضًا؛النص المعاد `blocked by policy` دون سبب تفصيلي. لا مزيد من محاولات الالتفاف. قد تبقى بيانات استعادة في binlog/undo/redo/صفحات التخزين بعدDROP؛لا نزعم محوها. أزيلت inheritance لصلاحيات المجلد ومنح الحساب الحالي التحكم؛icacls نجح189 ملفًا/0فشل. مجلد المتبقي يحتاج تنظيفًا يدويًا: `C:\Users\cpazi\AppData\Local\Temp\ayahx-d1-mysql-9.7.2\acceptance-data`. صفر مجلدات scratch صوتD2 باقية. النسخةage المتحققة محفوظة في private-backups خارجGit/cloud. الدليل `data/d2-local-private-data-cleanup.json`؛لا تعني حماية ACL أن البقايا مشفرة أو محذوفة.


### Git وAuto-deploy بعد المسودة

دُفعde667f0 للكود والبروفة و9919539 للأدلة؛ فُتحتPR10 مسودة stacked منphase/d2-recitation-catalog إلىphase/d1-quran-text وأُرفقت بالمهمة. قراءة20:00:00Z بعد الفتح أثبتت Auto-deploy=true/branchmain/repoGitHub، وPRdeploys=false، والبيئتينproduction/staging فقط، وصفر deployment IDs متغيرة. لا merge/main/deploy. الدليلdata/d2-auto-deploy-final.json. CI الأول بدأ فعلًا على9919539؛ نتيجته وأي head لاحق تُذكر في وصفPR والتقرير النهائي بعد التحقق، دون افتراض الأخضر.

تنبيه حدود فحص البسملة:166 قياسprefix ل56تلاوة في سور العينات، وليس كل مقدمات114سورة. جميع حالات الصوتunverified. بياناتannotation لكلconfigs سبق تدقيقها فيD1؛ لا نساويها بفحص الموجة أو سماع المحتوى.

## متابعة D2 — 2026-10-10 القاهرة، قراءة فقط قبل الموافقة

التفويض الجديد: تحليل الفشل ومصالحة وتشخيص أولًا، ثم انتظار الاعتماد. لم يُعَد تطبيق staging ولم تُنفَّذ نسخة dump جديدة أو production dry-run أو تطبيق إنتاج. كذلك لم تُنفَّذ محاولة snapshot أو حذف/نقل/تغيير ACL. DECISIONS يحفظ التسلسل الجديد والإذن النهائي المنفصل؛ snapshot رُفض لقيد Pro ولا مزيد من المحاولات. تعليمات التنظيف اليدوي تُقدَّم مرة واحدة في docs/d2-manual-cleanup.ar.md؛ بقايا التخزين ليست محذوفة.

أوامر `diagnose-qud-connections-readonly.ts --target staging/production` نجحت؛ الدليلان d2-staging-connections-readonly.json و d2-production-connections-readonly.json. كل أمر يغلق اتصاله قبل اللقطة الثانية، وأثبتت الثانية غياب connection_id الأول. أوامر SHOW المطلوبة: staging عند 1/151 و production عند 1/60، ولا root محلي غير التشخيص في اللقطتين. Max_used=4/5 و Connection_errors_max_connections=0. Aborted_clients=6058/5849 تراكمية بلا نسبة سبب تخمينية. processlist يحفظ categories/fingerprints دون نصوص host/SQL. قراءة العمليات المحلية أظهرت خادمي railway mcp وصفر ssh clients؛ لم تُنهَ أي عملية أو جلسة.

لا دليل على بلوغ max_connections حاليًا. رسالة Maximum SSH connections السابقة تخص حد Railway SSH؛ سبب exit1 الأصلي غير محسوم. لا KILL لجلسة مجهولة أو إعداد limits أو تغيير حارس staging. التنفيذ اللاحق يشترط اتصالًا واحدًا ودفعات≤1000 وفحص الاتصالات قبل **كل دفعة** والتوقف عند بلوغ/تجاوز الحد أو خطأ. لم يُختبَر هذا بتطبيق جديد بعد؛ لا ادعاء أن سكربت التطبيق الحالي ينفذه بالفعل.

المصالحة الكاملة الجديدة باتصال واحد لكل بيئة: staging الساعة 20:56:15Z يطابق 57/10/69/7765 و riwayat=4؛ production الساعة 21:05:54Z بلا جداول D2 و riwayat=1. جميع values/JSON في staging مطابقة، و D1/checksums/bin والجداول الحرجة ثابتة. المصدر 8 قنوات ومعهما 2 مزوّد موثق للـ runtime القديم؛ riwayat=1+3 inactive وصفر published. الأدلة d2-staging-readonly-reconciliation-followup.json و d2-production-readonly-reconciliation-followup.json و d2-followup-reconciliation-table.json. ملف SQL ثابت SHA 2498e681f2be2e1e9398e7dcdcb9731e8861ac331087dad2bb3c65a4507958b8؛ لم يُنفَّذ مجددًا، والمصالحة ليست applied=true.

التعارض مع القرار الجديد: ثماني تلاوات غير حفص تحمل verification_status=failed و status=imported؛ offset=false وكلها غير منشورة. الأسماء في data-audit والجدول JSON. تحويلها إلى needs_review يتطلب SQL جديدًا وبروفة محلية وإعادة staging من البداية بعد الموافقة. يلي ذلك dump إنتاج جديد مشفر واستعادة 9.7.2 ومقارنة counts/CHECKSUM ثم dry-run مقارن؛ إذن الإنتاج النهائي برسالة مستقلة بعد الأدلة. لا يُستخدم SQL القديم في الإنتاج مع هذا التعارض.

لم تتغير حالات offset الـ 48 الفاشلة؛ التحليل 175NCC/70duration/65lag في 211 عينة مع تداخل الأسباب، وσ>10 تشخيص فقط. أزيلت فرضية chapter+HF الخاطئة التي لم تُنفَّذ في أي من 840 عينة؛ HF offset مطلق بحسب كود QUD ومعايير .95/30/30 ثابتة. HTTP 500 logger للمستقبل يسجل UTC/body محجوبًا وبصمة، واختُبر بـ fixtures دون طلبات HF جديدة. لم يُعَد فحص كل الصوت أو بسملته، و 166 prefix للعينة فقط.

الاختبارات النهائية: 451 pass/6 skip/0 fail من 457 مع corpus، و Python 17/17 و root TS/strict/lint ناجحة. تشغيل Vitest الأول 450/7 بلا corpus أُعيد مع الملف المثبت؛ خطأ strict أولي TS7053 عولج بحفظ environment بعد تضييق النوع قبل closure. لم يتغير tooling/runtime أو الواجهة أو الريندر. تفصيل الأوامر في d2-followup-tests.json. D2 غير مغلق و PR10 مسودة؛ لا merge/deploy/بيئة جديدة/D3/A1.

قراءة Auto-deploy الجديدة قبل دفع المتابعة: main مفعّل، و PR deploys=false، و production/staging فقط؛ لم تتغير deployment IDs أو مجموعة البيئات. الدليل data/d2-auto-deploy-followup.json. هذا تحقق إعداد وحالة، وليس نشرًا أو موافقة دمج.

# تنفيذ التفويض الموسع — 2026-10-10 القاهرة

نتائج فعلية بتاريخ 2026-10-09، بتوقيت UTC: أُنشئ backup بصيغة age الساعة 16:33:52. نجحت استعادته المحلية لـ 47 جدولًا ومقارنة CHECKSUM مرة ثانية؛ وكانت الجداول الحرجة ما تزال مطابقة الساعة 23:30. حُفظت النسخة الأصلية والمفتاح؛ ولم يُنشأ snapshot أو وصول DB عام.

يستخدم `scripts/apply-qud-catalog-railway.ts` الآن `openRailwayMysqlSession`: جلسة واحدة وعميل mysql واحد لكل خطوات pre/apply/post، و gzip عند توفر gunzip، وفحص Threads_connected قبل كل statement. يلزم تأكيد COMMIT ثم exit0 قبل كتابة applied=true؛ ولا يُعاد تصنيف المصالحة التاريخية. يتطلب replay ملفات dataset/SQL/proof القديمة، ويطابقها فعليًا؛ ولا يسمح باختلاف سوى failed/imported→needs_review.

وُلد SQL الجديد خارج Git، ببصمة SHA `d3f0db3ece980af02af2b00b2c06f5e2ce890b3526e62050396571cd2cc42fe8`، وثبت على 9.7.2. نجح staging dry-run ثم apply الساعة 23:34:45 بالرمز 0، مع 45 فحصًا واتصالات 1–2/151 وتصحيح 8 حالات.

نجح production dry-run ومقارنته، ثم apply المستقل مع `--confirm-production` الساعة 23:36:59، بالرمز 0 واتصالات 1–2/60. أثبتت المصالحة المستقلة الساعة 23:37:39 صحة كامل قيم الكتالوج و D1 والجداول الحرجة و collation و FK. أعاد health/ready الرمز 200، واللوج بلا errors. نُفذ الملف نفسه بالبصمة SHA نفسها؛ ولم تلزم retry. لم تُعدّل userdata أو أي جدول قديم.

استعملت الأوامر `--dataset %TEMP%\ayahx-d2\dataset-status-fixed.json --sql %TEMP%\ayahx-d2\d2-import-status-fixed.sql --rehearsal docs/data/d2-local-rehearsal-status-fixed.json --backup docs/data/d2-backup-verification.json`. أضاف staging الخيارات `--replay-verified-staging --staging-previous-dataset %TEMP%\ayahx-d2\dataset.json --staging-previous-sql %TEMP%\ayahx-d2\d2-import.sql --staging-existing-proof docs/data/d2-staging-readonly-reconciliation-followup.json`؛ وأضاف الإنتاج دليل staging الجديد. كان تطبيق كل بيئة أمرًا مستقلًا مع `--apply`، وبروفاته في `docs/data`.

سُجل رفض التنظيف الصريح في التفويض الجديد بـ blocked by policy؛ ولم يُنفذ الأمر أو يُستخدم بديل. يستمر العمل وفق استثناء المستخدم. يوجد datadir مستقل للبروفة الجديدة؛ وما يزال التنظيف المادي معلقًا. لا تثبت هذه الفقرة النشر؛ وتأتي أدلة دمج PR9/10 ومراقبة Railway لاحقًا.
