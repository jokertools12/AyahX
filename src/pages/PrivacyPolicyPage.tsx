import { Layout } from '@/components/Layout';
import { motion } from 'framer-motion';
import { ShieldCheck, Lock, Eye, Database, Globe, UserCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function PrivacyPolicyPage() {
  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary mb-2 shadow-lg shadow-primary/20">
              <ShieldCheck className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold font-quran">سياسة الخصوصية وحماية البيانات</h1>
            <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
              نلتزم بحماية خصوصيتك واحترام بياناتك الشخصية عند استخدام منصة قرآن ريلز (Ayah Clip Maker)
            </p>
            <p className="text-xs text-muted-foreground">آخر تحديث: سبتمبر 2026</p>
          </div>

          <div className="grid gap-6">
            {/* Section 1 */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Database className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">1. البيانات التي نجمعها</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  عند إنشاء حساب أو استخدام خدماتنا، نقوم بجمع معلومات ضرورية فقط لتقديم وتطوير الخدمة:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 text-sm md:text-base mr-2">
                  <li><strong>بيانات الحساب:</strong> البريد الإلكتروني، الاسم المعروض، وكلمة المرور المشفرة بأعلى معايير التشفير (Bcrypt).</li>
                  <li><strong>مشاريع الفيديو:</strong> السورة المختارة، رقم الآيات، اسم القارئ، وتفضيلات الخط والخلفية لتمكينك من إعادة تعديلها وحفظها في مكتبتك.</li>
                  <li><strong>سجلات الاستخدام:</strong> عدد المقاطع المنشأة يومياً للتحقق من خطة الاستخدام (المجانية أو المميزة).</li>
                  <li><strong>بيانات الدفع:</strong> في حال الترقية عبر المحافظ الإلكترونية، يتم التحقق من رقم التحويل وتأكيد حالة الاشتراك دون تخزين أي بيانات بنكية سرية.</li>
                </ul>
              </CardContent>
            </Card>

            {/* Section 2 */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Lock className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">2. كيف نستخدم بياناتك</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  تُستخدم البيانات حصرياً للأغراض التالية:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 text-sm md:text-base mr-2">
                  <li>إدارة وتأمين حسابك الشخصي والتحقق من الهوية عند تسجيل الدخول.</li>
                  <li>مزامنة مقاطعك ومفضلاتك عبر مختلف أجهزتك من خلال "مكتبتي".</li>
                  <li>إرسال الإشعارات المتعلقة بحسابك أو تفعيل اشتراكك المميز.</li>
                  <li>تحسين أداء المنصة ومعالجة الأخطاء التقنية.</li>
                  <li>لا نقوم إطلاقاً ببيع أو تأجير أو مشاركة بياناتك مع أي طرف ثالث لأغراض إعلانية.</li>
                </ul>
              </CardContent>
            </Card>

            {/* Section 3 */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Eye className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">3. خصوصية المعالجة والريندر على جهازك</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  تتميز منصة قرآن ريلز بأن عمليات توليد وتركيب الفيديو وتوليد الإطارات (HTML5 Canvas & Web Audio API) تتم بالكامل داخل متصفحك محلياً على جهازك، مما يضمن سرعة فائقة وعدم رفع وسائطك الخاصة أو فيديوهاتك المصدرية إلى خوادم خارجية إلا إذا اخترت نشرها كفيديو عام في قسم "اكتشف".
                </p>
              </CardContent>
            </Card>

            {/* Section 4 */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">4. حقك في حذف بياناتك بالكامل</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  نؤمن بالتحكم الكامل للمستخدم في بياناته؛ يمكنك في أي وقت تعديل بياناتك الشخصية من صفحة الإعدادات، أو طلب الحذف النهائي لحسابك عبر زر "حذف الحساب نهائياً". عند تأكيد الحذف بكلمة المرور، يتم فوراً مسح جميع بيانات الحساب والمشاريع والمفضلات والتعليقات نهائياً من قاعدة البيانات بدون رجعة.
                </p>
              </CardContent>
            </Card>

            {/* Section 5 */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Globe className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">5. التواصل معنا بشأن الخصوصية</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  إذا كان لديك أي استفسار أو ملاحظة حول خصوصية بياناتك، يمكنك التواصل المباشر مع فريق الدعم عبر صفحة <a href="/contact" className="text-primary underline">تواصل معنا</a> وسنكون سعداء بالرد عليك.
                </p>
              </CardContent>
            </Card>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
}
