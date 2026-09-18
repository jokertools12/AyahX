import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Home, Sparkles, BookOpen, Search } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.warn("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-20 flex items-center justify-center min-h-[70vh]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="max-w-lg text-center space-y-6"
        >
          {/* Decorative 404 badge */}
          <div className="relative inline-flex items-center justify-center">
            <span className="text-8xl md:text-9xl font-black font-quran tracking-widest text-primary/15 select-none">
              ٤٠٤
            </span>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl md:text-5xl font-black gradient-text">
                404
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold font-quran">
              الصفحة المطلوبة غير موجودة
            </h1>
            <p className="text-muted-foreground text-sm md:text-base leading-relaxed">
              عذراً، يبدو أن الرابط الذي حاولت الوصول إليه غير صحيح أو تم نقل الصفحة إلى مكان آخر.
            </p>
          </div>

          {/* Action Links */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Button asChild size="lg" className="w-full sm:w-auto gap-2 gradient-primary">
              <Link to="/">
                <Home className="h-4 w-4" />
                الرئيسية
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto gap-2">
              <Link to="/create">
                <Sparkles className="h-4 w-4" />
                إنشاء فيديو
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full sm:w-auto gap-2">
              <Link to="/surahs">
                <BookOpen className="h-4 w-4" />
                تصفح السور
              </Link>
            </Button>
          </div>
        </motion.div>
      </div>
    </Layout>
  );
};

export default NotFound;
