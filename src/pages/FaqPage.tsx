import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, ChevronDown, Sparkles, BookOpen, Crown, Video, CheckCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface FaqItem {
  id: string;
  category: 'general' | 'content' | 'pricing' | 'tech';
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    id: 'q1',
    category: 'general',
    question: 'ما هي منصة قرآن ريلز (Ayah Clip Maker)؟',
    answer: 'منصة احترافية تتيح لصناع المحتوى والمسلمين في جميع أنحاء العالم تصميم وتوليد مقاطع فيديو قصيرة (Reels & Shorts) بآيات القرآن الكريم والابتهالات الدينية، بدقة عالية وتزامن لحظي بين الصوت والكلمات المكتوبة بالرسم العثماني وخلفيات طبيعية خلابة.',
  },
  {
    id: 'q2',
    category: 'content',
    question: 'من أين تأتي نصوص الآيات والتسجيلات الصوتية؟',
    answer: 'تعتمد المنصة على مصادر موثوقة ومعتمدة إسلامياً؛ النصوص القرآنية مأخوذة من مصحف المدينة المنورة بالرسم العثماني مع كامل التشكيل، وتلاوات القراء مستمدة من شبكة EveryAyah ومشروع Quran.com بأعلى جودة نقاء صوتي (192kbps).',
  },
  {
    id: 'q3',
    category: 'general',
    question: 'هل يمكنني نشر الفيديوهات على إنستغرام وتيك توك ويوتيوب بدون حقوق ملكية؟',
    answer: 'نعم! يمكنك بحرية كاملة تنزيل ونشر المقاطع على جميع منصات التواصل الاجتماعي (Instagram Reels, TikTok, YouTube Shorts, Facebook Reels, WhatsApp Status) لنشر الخير وكلام الله تعالى.',
  },
  {
    id: 'q4',
    category: 'pricing',
    question: 'ما هو الفرق بين الخطة المجانية والخطة المميزة (Premium)؟',
    answer: 'الخطة المجانية تشمل 5 عمليات تسجيل على جهازك وفيديو سحابي واحد يومياً، حتى دقيقتين بدقة 720p و30fps. العضوية الشهرية تشمل 5 فيديوهات سحابية يومياً والسنوية 10، حتى 5 دقائق بدقة 1080p و30fps، مع تسجيل غير محدود على جهازك وحفظ الفيديوهات السحابية 48 ساعة. جودة 4K و60fps متاحة في التسجيل على جهازك للعضوية المميزة.',
  },
  {
    id: 'q5',
    category: 'pricing',
    question: 'كيف يمكنني الدفع والاشتراك في الخطة المميزة؟',
    answer: 'نوفر الدفع السهل والمحلي عبر المحافظ الإلكترونية المصرية (فودافون كاش، اتصالات كاش، أورانج كاش، وي باي، وانستاباي). كل ما عليك هو التوجه لصفحة الأسعار، اختيار الباقة، وإرسال طلب التحويل ليتم تفعيله من قبل الإدارة فوراً.',
  },
  {
    id: 'q6',
    category: 'tech',
    question: 'كيف يعمل التزامن الصوتي مع الكلمات (Word-by-word sync)؟',
    answer: 'تُظلَّل الكلمات مع التلاوة عندما تتوفر بيانات توقيت معتمدة للقارئ المختار. تعرض صفحة المعاينة حالة التزامن، ويمكنك تشغيل المقطع للتأكد منه قبل التصدير.',
  },
  {
    id: 'q7',
    category: 'tech',
    question: 'ما طرق إنتاج الفيديو المتاحة؟',
    answer: 'يمكنك التسجيل على جهازك مع إبقاء الصفحة مفتوحة، أو اختيار الإنتاج السحابي الذي يستخدم إعدادات المشهد المختارة ويحفظ الفيديو في مكتبتك. تُعالج الطلبات السحابية بالتتابع، وتظهر الحصة اليومية وحدود المدة والجودة في إعدادات التصدير.',
  },
  {
    id: 'q8',
    category: 'tech',
    question: 'كم من الوقت يبقى الفيديو السحابي متاحاً للتحميل في المكتبة؟',
    answer: 'يتم الاحتفاظ بملف الفيديو المنتج عبر السيرفر لمدة 48 ساعة كاملة (يومان) في مكتبتك الخاصة للتحميل المباشر بصيغة MP4. بعد انتهاء الـ 48 ساعة، يقوم نظام التنظيف الذكي بمسح الملف المؤقت لحماية سعة قرص السيرفر من الامتلاء، مع بقاء بيانات التصميم وإمكانية إعادة الإنشاء بضغطة زر واحدة.',
  },
  {
    id: 'q9',
    category: 'content',
    question: 'كيف أقترح قارئاً جديداً أو ابتهالاً ترغبون بإضافته؟',
    answer: 'يسعدنا جداً استقبال اقتراحاتكم! يمكنك في أي وقت مراسلتنا عبر صفحة "تواصل معنا" وتحديد اسم القارئ أو الرواية أو المبتهل وسنعمل على إدراجه في التحديثات الدورية بإذن الله.',
  },
];

export default function FaqPage() {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>('q1');

  const filtered = activeCategory === 'all'
    ? FAQS
    : FAQS.filter(f => f.category === activeCategory);

  const toggle = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

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
              <HelpCircle className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold font-quran">الأسئلة الشائعة والمساعدة</h1>
            <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
              إجابات عن استخدام المنصة، والخطط، وجودة الفيديو، وحقوق النشر
            </p>
          </div>

          {/* Category Tabs */}
          <div className="flex justify-center gap-2 flex-wrap">
            {[
              { id: 'all', label: 'جميع الأسئلة' },
              { id: 'general', label: 'عام' },
              { id: 'content', label: 'المحتوى والقراء' },
              { id: 'pricing', label: 'الأسعار والاشتراك' },
              { id: 'tech', label: 'التقنية والتصدير' },
            ].map((cat) => (
              <Button
                key={cat.id}
                variant={activeCategory === cat.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveCategory(cat.id)}
                className="rounded-full px-4"
              >
                {cat.label}
              </Button>
            ))}
          </div>

          {/* Accordion List */}
          <div className="space-y-4">
            {filtered.map((item) => {
              const isOpen = openId === item.id;
              return (
                <Card
                  key={item.id}
                  className={`overflow-hidden transition-all duration-200 ${
                    isOpen ? 'border-primary/50 shadow-md shadow-primary/5' : 'hover:border-border/80'
                  }`}
                >
                  <button
                    onClick={() => toggle(item.id)}
                    className="w-full text-right p-5 flex items-center justify-between gap-4 font-semibold text-base md:text-lg focus:outline-none"
                    aria-expanded={isOpen}
                  >
                    <span className="flex items-center gap-3">
                      <Sparkles className={`h-4 w-4 shrink-0 ${isOpen ? 'text-primary' : 'text-muted-foreground'}`} />
                      {item.question}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-primary' : ''
                      }`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <div className="px-5 pb-5 pt-0 text-muted-foreground text-sm md:text-base leading-relaxed border-t border-border/40 mt-1 pt-3">
                          {item.answer}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </div>

          {/* Call to action */}
          <Card className="bg-primary/5 border-primary/20 p-8 text-center space-y-4 rounded-2xl">
            <h3 className="text-xl font-bold">هل لديك سؤال آخر لم تجد إجابته هنا؟</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              فريق الدعم الفني جاهز لمساعدتك والرد على كافة استفساراتك في أسرع وقت.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button asChild className="gap-2">
                <Link to="/contact">تواصل مع الدعم الفني</Link>
              </Button>
              <Button asChild variant="outline" className="gap-2">
                <Link to="/create">ابدأ في تجربة التصميم</Link>
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    </Layout>
  );
}
