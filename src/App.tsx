import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AchievementUnlockOverlay } from "@/components/AchievementUnlockNotification";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const Index = lazy(() => import("./pages/Index"));
const SurahsPage = lazy(() => import("./pages/SurahsPage"));
const CreatePage = lazy(() => import("./pages/CreatePage"));
const IbtahalatPage = lazy(() => import("./pages/IbtahalatPage"));
const PreviewPage = lazy(() => import("./pages/PreviewPage"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const BrowsePage = lazy(() => import("./pages/BrowsePage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const UserSettingsPage = lazy(() => import("./pages/UserSettingsPage"));
const PaymentHistoryPage = lazy(() => import("./pages/PaymentHistoryPage"));
const MyStatsPage = lazy(() => import("./pages/MyStatsPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const DiscoverPage = lazy(() => import("./pages/DiscoverPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const ActivityFeedPage = lazy(() => import("./pages/ActivityFeedPage"));
const VideoDetailPage = lazy(() => import("./pages/VideoDetailPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute fresh data cache
      gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
      refetchOnWindowFocus: false, // Prevents network request storm on tab switches
      retry: 1, // Only retry once on failure to prevent cascading retry storms
    },
  },
});

const PageLoader = () => (
  <div className="flex flex-col items-center justify-center gap-5 min-h-[60vh]" role="status" aria-label="جاري تحميل AyahX">
    <BrandLogo variant="app" className="w-16" decorative priority />
    <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-primary" aria-hidden="true" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AchievementUnlockOverlay />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/surahs" element={<SurahsPage />} />
            <Route path="/create" element={<CreatePage />} />
            <Route path="/ibtahalat" element={<IbtahalatPage />} />
            <Route path="/preview" element={<PreviewPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/library" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/settings" element={<ProtectedRoute><UserSettingsPage /></ProtectedRoute>} />
            <Route path="/payment-history" element={<ProtectedRoute><PaymentHistoryPage /></ProtectedRoute>} />
            <Route path="/my-stats" element={<ProtectedRoute><MyStatsPage /></ProtectedRoute>} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/favorites" element={<ProtectedRoute><FavoritesPage /></ProtectedRoute>} />
            <Route path="/activity" element={<ProtectedRoute><ActivityFeedPage /></ProtectedRoute>} />
            <Route path="/video" element={<VideoDetailPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="/contact" element={<ContactPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
