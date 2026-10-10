# تقرير D4/T0 — حفظ تشخيص الأخطاء بأمان

## 1. ما تغيّر

server/logger.ts وlogRedaction.ts: code/message/stack الأصلي، structured errors دون تحويل object إلى نص، وحجب الأسرار والروابط الموقعة وquery strings قبل console وAPM. كان requestLogger يمرر سياقHTTP مكانError عندstatus500؛ فصل الوسيطين. server/routes/alignments.ts يحفظcaughtError لـresolve-known فيWeakMap حتىfinish؛ لا تغييرpayload أوstatus. لا originalstack مختلق إذا لم يتوفر سوىJSON.

## 2. ما تحققت منه فعليًا

اختبارHTTP محلي حقيقي على127.0.0.1 يرجع503 وبنفسbody، ويثبتcode/message/originalstack وحجبquery وعدم تسريب بقيةbody. اختبارات الأسرار فيmessage/stack/context/hooks، signedURL، connectionURL، Basic/Bearer، JSONquotedsecret وcontextدائري. لا طلب خطأ تجريبي إلىproduction ولا كتابةDB. سبب503 التاريخي لم يستعد ولم يثبت؛ التحسين للمحاولات القادمة.

## 3. نتائج الاختبارات

`npx vitest run src/test/loggerErrors.test.ts src/test/observability.test.ts`:14/14. الاختبارات الجديدة الخمسة red على القديم. تشغيلgreen الأول كشفown-nameproperty فيcloneError يتعارض مععقدAPM القائم؛ صحح دون تغييرالاختبار ثمنجح. آخر `npm test` علىمدخلاتD1/D3الحقيقية:499pass/6skip/0fail. `npx tsc --noEmit` وstrict للlogger/helpers و`npm run build` ناجحة؛eslintللأربعةدونerror أوwarningجديد. 15تحذيرًا قديمًا فيalignments، ولم يعالجlint العام. [الجودة](d4-t0-quality.json).

## 4. ما لم يكتمل

بواباتCI/merge/productionSUCCESS/health/ready/smoke/لوجعشر دقائق معلقة قبلشحنPRهذا. لم تبدأT1–T7 أوA1/D5. لافتحflag أواعتمادهويةصوت أوترخيص.

## 5. المخاطر

codeمفقود منالمصدر لايُختلق. responseJSON لايعطيstack أصليًا؛ المسارالمعني يرفقخطأهالفعلـي. hookيتلقىنسخةErrorمحجوبة ذاتmessage/stack/code؛ عقدAPMاختبر. لاتغييراتواجهـةأوريندر، والروابطالموقعةلا تظهر فياللوج.

## 6. التالي

شحنT0المستقل بعدCI ثم قبولالنشر الفعلي. بعدهفقطT1–T7 للدفعةD4؛ التوقفبعدتقريرD4، لاA1 أوD5.
