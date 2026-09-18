import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { motion } from 'framer-motion';
import { Mail, Send, MessageSquare, User, HelpCircle, CheckCircle2, AlertCircle, Loader2, Crown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

export default function ContactPage() {
  const { user } = useAuth();
  const { isPremium } = useSubscription();
  const [name, setName] = useState(user?.display_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [category, setCategory] = useState('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('الرجاء كتابة اسمك الكريم');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('الرجاء إدخال بريد إلكتروني صحيح لتلقي الرد');
      return;
    }
    if (!subject.trim()) {
      setError('الرجاء تحديد موضوع الرسالة');
      return;
    }
    if (message.trim().length < 5) {
      setError('الرجاء كتابة تفاصيل رسالتك (5 أحرف على الأقل)');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.services.submitContact({
        name: name.trim(),
        email: email.trim(),
        category,
        subject: subject.trim(),
        message: message.trim(),
      });

      setSubmitted(true);
      toast.success(res.message || 'تم إرسال رسالتك بنجاح');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'فشل إرسال الرسالة، يرجى المحاولة لاحقاً';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setSubject('');
    setMessage('');
    setError(null);
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary mb-2 shadow-lg shadow-primary/20">
              <Mail className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold font-quran">تواصل مع الدعم الفني</h1>
            <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
              يسعدنا استقبال استفساراتك، اقتراحاتك لتطوير المنصة، طلبات إضافة قراء جدد، أو المساعدة في اشتراكك
            </p>
            {isPremium && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
                <Crown className="h-3.5 w-3.5" />
                سترسل رسالتك تلقائياً إلى مسار الدعم ذي الأولوية
              </span>
            )}
          </div>

          <Card className="border-border/60 shadow-xl">
            <CardContent className="p-6 md:p-8">
              {submitted ? (
                <div className="text-center py-10 space-y-4">
                  <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary mx-auto mb-2">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground">تم استلام رسالتك بنجاح!</h2>
                  <p className="text-muted-foreground text-sm md:text-base max-w-md mx-auto leading-relaxed">
                    شكراً لتواصلك معنا. سنقوم بمراجعة رسالتك والرد على بريدك الإلكتروني ({email}) في أسرع وقت ممكن بإذن الله.
                  </p>
                  <div className="pt-4">
                    <Button onClick={handleReset} variant="outline" className="gap-2">
                      إرسال رسالة أخرى
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {error && (
                    <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-center gap-2 border border-destructive/20" role="alert">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contact-name">الاسم الكريم</Label>
                      <div className="relative">
                        <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="contact-name"
                          placeholder="أدخل اسمك"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="pr-10"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="contact-email">البريد الإلكتروني للرد</Label>
                      <div className="relative">
                        <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="contact-email"
                          type="email"
                          placeholder="name@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pr-10"
                          required
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contact-category">نوع الرسالة</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger id="contact-category">
                          <SelectValue placeholder="اختر نوع الرسالة" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">استفسار عام</SelectItem>
                          <SelectItem value="reciter_request">طلب إضافة قارئ أو تلاوة</SelectItem>
                          <SelectItem value="payment">استفسار بخصوص الدفع والاشتراك</SelectItem>
                          <SelectItem value="suggestion">اقتراح تطوير ميزة جديدة</SelectItem>
                          <SelectItem value="bug_report">إبلاغ عن مشكلة فنية</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="contact-subject">موضوع الرسالة</Label>
                      <Input
                        id="contact-subject"
                        placeholder="مثال: طلب تلاوة برواية ورش"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contact-message">نص الرسالة والتفاصيل</Label>
                    <Textarea
                      id="contact-message"
                      rows={5}
                      placeholder="اكتب تفاصيل استفسارك أو ملاحظتك هنا..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                      className="resize-none leading-relaxed"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="w-full gap-2 py-6 text-base font-semibold gradient-primary"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        جاري الإرسال...
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" />
                        إرسال الرسالة
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </Layout>
  );
}
