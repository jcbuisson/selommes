
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
   worker: { format: 'es' },
   // Keep PGlite's WASM/data URLs relative to its package during development.
   optimizeDeps: { exclude: ['@electric-sql/pglite'] },

  plugins: [
      vue(),
   
      VitePWA({
         devOptions: {
            enabled: false
         },
         base: "/",
         srcDir: "src",
         filename: "sw.ts",
         includeAssets: [
            "selommes-icon.svg",
            "selommes-icon-16.png",
            "selommes-icon-32.png",
            "selommes-icon-180.png",
         ],
         strategies: "injectManifest",
         injectManifest: {
            globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,wasm,data}'],
            maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
         },
         manifest: {
            name: "Selommes",
            short_name: "Selommes",
            lang: "fr",
            theme_color: "#5c92ad",
            start_url: "/",
            display: "standalone",
            background_color: "#5c92ad",
            icons: [
               {
                  src: "selommes-icon-192.png",
                  sizes: "192x192",
                  type: "image/png",
               },
               {
                  src: "selommes-icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
               },
               {
                  src: "selommes-icon-512.png",
                  sizes: "512x512",
                  type: "image/png",
                  purpose: "any maskable",
               },
            ],
         },
      }),
   ],
   server: {
      port: 8080,
      open: true,
      host: true, // allows for external device connection on local network
      proxy: {
         '/electric': 'http://localhost:8000',
         '^/selommes-socket-io/.*': {
            target: 'http://localhost:8000',
            ws: true,
         },
         '^/static/.*': 'http://localhost:8000',
      }
   },
})
