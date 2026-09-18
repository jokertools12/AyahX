import { Layout } from '@/components/Layout';
import { motion } from 'framer-motion';
import { FileText, BookOpen, AlertCircle, Award, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function TermsPage() {
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
              <FileText className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold font-quran">شروط الاستخدام والخدمة</h1>
            <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
              القواعد والضوابط المنظمة لاستخدام منصة قرآن ريلز وإنتاج ومشاركة المقاطع القرآنية
            </p>
            <p className="text-xs text-muted-foreground">آخر تحديث: سبتمبر 2026</p>
          </div>

          <div className="grid gap-6">
            {/* Clause 1: Sacred Content Integrity */}
            <Card className="border-primary/30">
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">1. قدسية النص القرآني وأحكام التلاوة</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  القرآن الكريم كلام الله المقدس، وعليه يلتزم كل مستخدم للمنصة بالآتي:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 text-sm md:text-base mr-2">
                  <li>عدم التلاعب بنصوص الآيات القرآنية أو تشكيلها أو بترها بما يغير المعنى الشرعي المقصود.</li>
                  <li>استخدام خلفيات ومؤثرات بصرية وقورة تليق بعظمة كلام الله، والابتعاد عن الصور أو المقاطع غير اللائقة أو التي تتنافى مع الآداب الإسلامية.</li>
                  <li>عدم دمج أي موسيقى أو إيقاعات محرمة مع تلاوات القرآن الكريم.</li>
                </ul>
              </CardContent>
            </Card>

            {/* Clause 2: Acceptable Use */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">2. سياسة الاستخدام المقبول</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  يحق لك استخدام المقاطع الناتجة للنشر الشخصي والدعوي والتعليمي عبر منصات التواصل الاجتماعي (مثل إنستغرام، تيك توك، يوتيوب، وفيسبوك وحالات واتساب). يُمنع استخدام المنصة في أي أنشطة تنتهك القوانين أو تسيء لأي جهة.
                </p>
              </CardContent>
            </Card>

            {/* Clause 3: Accounts & Subscriptions */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Award className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">3. الحسابات والاشتراكات والمدفوعات</h2>
                </div>
                <ul className="list-disc list-inside text-muted-foreground space-y-1.5 text-sm md:text-base mr-2">
                  <li><strong>الخطة المجانية:</strong> تتيح 5 عمليات إنتاج يومياً عبر محرك المتصفح الفوري، مع تجربة لمحرك FFmpeg ASS الصاروخي (1/يوم) ومحرك Skia Rust الفاخر (2/يوم).</li>
                  <li><strong>العضوية المميزة (Premium):</strong> تمنح إنتاجاً غير محدود عبر المتصفح، مع 30 ريندر بمحرك FFmpeg ASS الصاروخي (60 للسنوي)، و15 ريندر بمحرك Skia Rust (30 للسنوي)، و20 ريندر سحابي في الخلفية (50 للسنوي) بأولوية قصوى وجودة 4K Ultra HD.</li>
                  <li><strong>صلاحية حفظ الملفات السحابية:</strong> يتم تخزين ملفات الفيديو المنتجة عبر السيرفر لمدة 48 ساعة كاملة (يومان) كحد أقصى للتحميل المباشر في مكتبة المستخدم، وبعدها يُحذف الملف المؤقت تلقائياً لحماية مساحة الخوادم مع الاحتفاظ بالتصميم وإمكانية إعادة الإنشاء فوراً.</li>
                  <li>يتم تفعيل الاشتراكات المدفوعة بعد مراجعة إيصال التحويل (عبر فودافون كاش أو المحافظ المعتمدة) خلال ساعات العمل الرسمية.</li>
                </ul>
              </CardContent>
            </Card>

            {/* Clause 4: Intellectual Property */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <ShieldAlert className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">4. الملكية الفكرية وحقوق التلاوات</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  تعتمد المنصة على تسجيلات صوتية مفتوحة المصدر مرخصة للنشر القرآني عبر مكتبات كبرى مثل EveryAyah وQuran.com. يحتفظ القراء وأصحاب التسجيلات الأصلية بحقوقهم الأدبية، وتلتزم المنصة بعرض أسماء القراء الكرام في جميع المقاطع المنتجة احتراماً لجهدهم المبارك.
                </p>
              </CardContent>
            </Card>

            {/* Clause 5: Limitation of Liability */}
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-bold">5. إخلاء المسؤولية والتعديلات</h2>
                </div>
                <p className="text-muted-foreground leading-relaxed text-sm md:text-base">
                  نبذل قصارى جهدنا لضمان استقرار المنصة وعملها بأعلى كفاءة، ومع ذلك لا نتحمل المسؤولية عن أي انقطاع مؤقت ناجم عن مشاكل في شبكة الإنترنت أو خوادم التخزين الوسيطة. نحتفظ بحق تعديل هذه الشروط عند الضرورة، وسيتم إخطار المستخدمين بأي تحديثات جوهرية.
                </p>
              </CardContent>
            </Card>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
}
