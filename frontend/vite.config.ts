import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Суффикс v2: до фикса MIME (.mjs → octet-stream) браузеры успели
        // закэшировать битый pdf.worker с immutable max-age=1год — обычный
        // reload его не сбрасывает. Новые имена = новые URL = кэш мимо.
        entryFileNames: "assets/[name]-[hash]-v2.js",
        chunkFileNames: "assets/[name]-[hash]-v2.js",
        assetFileNames: "assets/[name]-[hash]-v2[extname]",
      },
    },
  },
  server: {
    // За reverse-proxy (Caddy) Host = публичный домен; без этого vite
    // блокирует запрос («This host is not allowed»).
    allowedHosts: true,
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
