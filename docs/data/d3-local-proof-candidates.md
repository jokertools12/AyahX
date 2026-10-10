# جرد أدلة packet/native المحلية — B

أداة `inventory_qud_local_proof_candidates.py` تلتقط snapshot خاصًا ثابتًا من التقرير الجاري دون الكتابة إليه، وتحسب شروط core رقميًا: envelope ≥0.90 وVAD agreement ≥0.90 و|lag| ≤30 ms وفرق مدة بين 0 و30 ms، وكل القيم finite. هذه حدود core المقررة في تشخيص B، وليست تغييرًا لقياسات v1 أو إعلان قبول v2. تطابق العلامة المسجلة `v2_numeric_candidate` يُفحص ولا يُفترض.

[checkpoint1](d3-local-proof-candidates-checkpoint1.json) يتضمن خمس تلاوات مكتملة و75 عينة. لا تلاوة مستوفية لكل core؛ لذلك صفر طلبات شبكة وصفر decode إضافي. الحارسات تقارن source/HF hashes وmetadata وقياسات v1 وتوزيع العينات مباشرة بالدليل المحتفظ به. وجود الملفات المحلية عُدّ فقط في هذا الجرد؛ يكرر packet/native فحص بصماتها الفعلية قبل أي proof.

| تلاوة | core samples | all-core | guards المصدر/HF/v1/التوزيع | ملفات محلية | native إضافي |
|---|---:|---|---|---:|---|
| `abdulbasit_abdulsamad_mujawwad_tarteel` | 9/15 | لا | متطابقة في الدليل | 18 | لم يُشغّل |
| `abdulbasit_abdulsamad_tarteel` | 7/15 | لا | متطابقة في الدليل | 18 | لم يُشغّل |
| `abdullah_al_mattrod_qdc` | 13/15 | لا | متطابقة في الدليل | 18 | لم يُشغّل |
| `abdullah_kamel_way2quran` | 12/15 | لا | متطابقة في الدليل | 18 | لم يُشغّل |
| `abdulwadood_haneef_mp3quran` | 11/15 | لا | متطابقة في الدليل | 18 | لم يُشغّل |

اختيار proof candidate يتطلب all-core، واجتياز حارسات المصدر/HF/v1 والتوزيع، ووجود جميع الملفات المحلية، مع حاجة إلى دليل identity/position. هذه علامة لتدقيق محلي مستقل فقط. raw classification تبقى في snapshot دون تغيير. لا يحل نجاح packet mapping أو native identity محل offset bounds أو VAD أو المدة أو replay مستقل للمقاطع.

أداة native أصبحت تختار معدل source/clip الأصلي المتطابق من مجموعة معدلات MP3 الصريحة: 8000، 11025، 12000، 16000، 22050، 24000، 32000، 44100، 48000 Hz. أي معدل آخر أو اختلاف بين المصدر والمقطع يعطي `UNSUPPORTED`؛ لا تحويل إلى 44100 Hz لإظهار تطابق. trim ثابت 200 ms والطول الداخلي الأدنى 800 ms يحوّلان إلى samples بالكسور، ويُرفض أي مؤشر غير integer أو تغطية ناقصة. source يفك كاملًا streaming مع الاحتفاظ في RAM بالـintervals الثابتة فقط، دون seek أو lag search أو ملف PCM كامل.

أضيفت علامات position مستقلة: decoded packet lag مقابل offset، واجتياز |lag| ≤30 ms، وإمكان نافذة native كاملة عند الموضع المثبت، وفارق بداية envelope عن موضع native. [علامات أول15 المستنتجة من الدليل السابق](d3-native-position-flags-v2.json) تُحسب دون إعادة decode: حالة 2:1 interior-only لأن origin=-1105، ولا تُختلق نافذة قبل source PCM صفر. fixture ذات payload مطابق وoffset خاطئ تظل identity proven لكن offset gate=false.

القياس الصوتي الأول المنشور في ملفات packet/native الأصلية أُنتج بالنسخة `66e5b7a`، وبصماته وقياساته محفوظة. توسعة الأداة الحالية لا تُستأنف على التقرير السابق ولا تُبدل source/HF/metrics أو raw classification؛ أي تشغيل لاحق يستخدم snapshot وتقريرًا جديدين. حتى الآن قياس MP3 الحقيقي كان عند 44100 Hz؛ اختبارات معدلات أخرى هنا تثبت الحساب والحارس، ولا تدعي قياس تلاوة أخرى.

```powershell
python scripts/inventory_qud_local_proof_candidates.py --diagnosis <running-report.json> --retained-v1 <retained-v1.json> --private-directory <private-snapshot-directory> --report <new-inventory-report.json>
python scripts/prove_qud_packet_positions.py --diagnosis <private-frozen-snapshot.json> --scratch <retained-local-audio> --ffprobe <local-ffprobe.exe> --private-directory <private-packet-output> --report <new-packet-report.json> --config <exact-config>
python scripts/prove_qud_native_pcm.py --packet-report <new-packet-report.json> --scratch <retained-local-audio> --ffmpeg <local-ffmpeg.exe> --private-directory <private-native-output> --report <new-native-report.json>
```

الاختبارات 20/20 ناجحة (16 packet/native و4 للجرد): بيانات finite وحدود شاملة دون إرخاء، provenance والتوزيع، source/HF أو v1 معدّلة، معدلات مختلفة وغير مدعومة، موضع native exact، وعدم تحويل تطابق الهوية إلى نجاح offset. snapshot الكامل والـtask manifest ذوا المسارات الخاصة خارج Git؛ `manual_cleanup_required`، دون حذف أو نقل. المشروع والواجهة والريندر والـhelper الجاري وقاعدة البيانات لم تُعدّل.
