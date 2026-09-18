import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Check, X, Clock, Loader2, History, Crown } from 'lucide-react';
import { Navigate, Link } from 'react-router-dom';
import { ErrorState } from '@/components/ErrorState';

interface PaymentRecord {
  id: string;
  plan: string;
  amount: number;
  payment_method: string;
  phone_number: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

const walletName = (method: string) => {
  const map: Record<string, string> = {
    vodafone_cash: 'فودافون كاش',
    etisalat_cash: 'اتصالات كاش',
    orange_cash: 'أورانج كاش',
    we_pay: 'وي باي',
  };
  return map[method] || method;
};

const planName = (plan: string) => (plan === 'yearly' ? 'سنوي' : 'شهري');

export default function PaymentHistoryPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPayments = useCallback(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    api.subscriptions.getHistory()
      .then((data) => {
        setPayments((data as unknown as PaymentRecord[]) || []);
      })
      .catch((err) => {
        console.error(err);
        setError('تعذر تحميل سجل المدفوعات. يرجى التحقق من اتصالك والمحاولة مرة أخرى.');
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (user) {
      loadPayments();
    }
  }, [user, loadPayments]);

  if (authLoading) {
    return (
      <Layout>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  const statusBadge = (status: string) => {
    if (status === 'pending')
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          قيد المراجعة
        </Badge>
      );
    if (status === 'approved')
      return (
        <Badge className="gap-1 bg-green-600 text-white">
          <Check className="h-3 w-3" />
          تم القبول
        </Badge>
      );
    return (
      <Badge variant="destructive" className="gap-1">
        <X className="h-3 w-3" />
        مرفوض
      </Badge>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
            <History className="h-8 w-8 text-primary" />
            سجل المدفوعات
          </h1>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={loadPayments} />
          ) : payments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-4">
                <CreditCard className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="text-muted-foreground">لا توجد طلبات دفع سابقة</p>
                <Button asChild>
                  <Link to="/pricing">
                    <Crown className="h-4 w-4 ml-2" />
                    اشترك الآن
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {payments.map((payment) => (
                <motion.div
                  key={payment.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {statusBadge(payment.status)}
                          <Badge variant="outline">{planName(payment.plan)}</Badge>
                          <Badge variant="outline">{walletName(payment.payment_method)}</Badge>
                        </div>
                        <span className="font-bold text-primary">{payment.amount} ج.م</span>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>
                          الرقم: <span className="font-mono font-bold">{payment.phone_number}</span>
                        </span>
                        <span>
                          {new Date(payment.created_at).toLocaleDateString('ar-EG', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      {payment.admin_note && (
                        <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                          ملاحظة الأدمن: {payment.admin_note}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </Layout>
  );
}
