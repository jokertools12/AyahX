import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __RENDER_SCENE_VERSION__: JSON.stringify(createHash('sha256').update(fs.readFileSync(path.resolve('public/render-harness.html'))).digest('hex').slice(0, 16)),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  // FFmpeg resolves its worker beside its module; prebundling moves that URL
  // into .vite/deps and leaves local conversion waiting on a missing worker.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  worker: { format: 'es' },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor';
            }
            if (id.includes('@radix-ui') || id.includes('lucide-react')) {
              return 'ui-vendor';
            }
            if (id.includes('framer-motion')) {
              return 'motion-vendor';
            }
            if (id.includes('recharts')) {
              return 'recharts-vendor';
            }
            if (id.includes('@tanstack')) {
              return 'tanstack-vendor';
            }
          }
        },
      },
    },
  },
}));
