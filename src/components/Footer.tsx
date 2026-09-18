import { Link } from 'react-router-dom';
import { Heart, BookOpen, ShieldCheck, FileText, HelpCircle, Mail, Crown } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-border/50 bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Col 1: About */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary">
                <BookOpen className="h-4 w-4 text-primary-foreground" />
              </div>
              <h3 className="font-bold text-lg gradient-text font-quran">قرآن ريلز</h3>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              المنصة المتكاملة لصناعة مقاطع وريلز القرآن الكريم والابتهالات بأصوات كبار القراء والمبتهلين مع خلفيات طبيعية متناسقة وتزامن لحظي للكلمات.
            </p>
          </div>

          {/* Col 2: Quick Links */}
          <div>
            <h4 className="font-bold text-base mb-4 text-foreground">إنشاء وتصفح</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/create" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <span>إنشاء فيديو قرآني</span>
                </Link>
              </li>
              <li>
                <Link to="/surahs" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <span>فهرس السور (114)</span>
                </Link>
              </li>
              <li>
                <Link to="/ibtahalat" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <span>ابتهالات وتواشيح</span>
                </Link>
              </li>
              <li>
                <Link to="/discover" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <span>اكتشف المقاطع الرائجة</span>
                </Link>
              </li>
              <li>
                <Link to="/pricing" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <Crown className="h-3.5 w-3.5 text-primary" />
                  <span>الخطط والأسعار</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Support & Help */}
          <div>
            <h4 className="font-bold text-base mb-4 text-foreground">الدعم والمساعدة</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/faq" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <HelpCircle className="h-3.5 w-3.5 text-primary" />
                  <span>الأسئلة الشائعة</span>
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-primary" />
                  <span>تواصل مع الدعم</span>
                </Link>
              </li>
              <li>
                <Link to="/leaderboard" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <span>لوحة المتصدرين</span>
                </Link>
              </li>
              <li>
                <Link to="/achievements" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <span>أوسمة الإنجاز</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: Legal */}
          <div>
            <h4 className="font-bold text-base mb-4 text-foreground">السياسات والشروط</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/privacy" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span>سياسة الخصوصية</span>
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  <span>شروط الخدمة والاستخدام</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border/50 mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-right">
          <p className="text-muted-foreground text-xs">
            جميع الحقوق محفوظة © {new Date().getFullYear()} قرآن ريلز (Ayah Clip Maker)
          </p>
          <p className="text-muted-foreground text-xs flex items-center justify-center gap-1">
            صُنع بـ <Heart className="h-3.5 w-3.5 text-destructive fill-destructive" /> لوجه الله تعالى ونشر كلامه
          </p>
        </div>
      </div>
    </footer>
  );
}