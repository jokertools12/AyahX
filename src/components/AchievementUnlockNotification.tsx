import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Star, X } from 'lucide-react';

interface AchievementNotification {
  id: string;
  title: string;
  description: string;
  points: number;
}

let showNotification: (ach: AchievementNotification) => void = () => {};

export function triggerAchievementNotification(ach: AchievementNotification) {
  showNotification(ach);
}

export function AchievementUnlockOverlay() {
  const [notification, setNotification] = useState<AchievementNotification | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    showNotification = (ach) => {
      setNotification(ach);
      setVisible(true);
      setTimeout(() => setVisible(false), 5000);
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && notification && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: -30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -20 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-none"
        >
          <div className="pointer-events-auto w-full max-w-sm">
            <div className="relative overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-2xl shadow-primary/30">
              {/* Animated background glow */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-primary/10"
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 2, repeat: Infinity }}
              />

              <div className="relative p-6">
                <button
                  onClick={() => setVisible(false)}
                  className="absolute top-3 left-3 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex flex-col items-center text-center gap-4">
                  {/* Animated Trophy */}
                  <motion.div
                    className="h-20 w-20 rounded-2xl bg-primary/20 flex items-center justify-center"
                    animate={{ rotate: [0, -10, 10, -5, 5, 0] }}
                    transition={{ duration: 0.8, delay: 0.3 }}
                  >
                    <motion.div
                      animate={{ scale: [1, 1.4, 1] }}
                      transition={{ duration: 0.6, delay: 0.5 }}
                    >
                      <Trophy className="h-10 w-10 text-primary" />
                    </motion.div>
                  </motion.div>

                  <div>
                    <motion.p
                      className="text-sm font-medium text-primary mb-1"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      🎉 إنجاز جديد!
                    </motion.p>
                    <motion.h3
                      className="text-xl font-bold text-foreground"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      {notification.title}
                    </motion.h3>
                    <motion.p
                      className="text-sm text-muted-foreground mt-1"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                    >
                      {notification.description}
                    </motion.p>
                  </div>

                  {/* Points Badge */}
                  <motion.div
                    className="flex items-center gap-1.5 rounded-full bg-primary/10 px-4 py-2"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.5 }}
                  >
                    <Star className="h-4 w-4 text-primary" />
                    <span className="text-base font-bold text-primary">+{notification.points} نقطة</span>
                  </motion.div>
                </div>

                {/* Sparkle particles */}
                {[...Array(8)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="absolute h-1.5 w-1.5 rounded-full bg-primary"
                    initial={{
                      opacity: 0,
                      x: '50%',
                      y: '50%',
                    }}
                    animate={{
                      opacity: [0, 1, 0],
                      x: `${50 + (Math.random() - 0.5) * 80}%`,
                      y: `${50 + (Math.random() - 0.5) * 80}%`,
                      scale: [0, 1.5, 0],
                    }}
                    transition={{ duration: 1.2, delay: 0.3 + i * 0.08 }}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
