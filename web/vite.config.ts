import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The denoise AudioWorklet (`public/denoise-worklet.js`) and the standalone
// WebAssembly module (`public/denoise.wasm`) are served as-is from `public/`,
// so they are reachable under the configured base in both dev and build.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Auto-register and silently keep the cached app up to date. No reload
      // prompt UI is needed: the next launch picks up the new version.
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "HamNoise",
        short_name: "HamNoise",
        description:
          "Neural network noise reduction for ham radio, supporting CW and voice modes such as SSB.",
        lang: "en",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Precache the full app shell, fonts and the WASM/worklet so it runs
        // fully offline. The .wasm module is ~400 KB, so lift the size cap.
        globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2,wasm}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        // The worklet and WASM are fetched with a `?v=<ASSET_VERSION>` cache
        // buster; ignore it so those requests resolve against the precache.
        ignoreURLParametersMatching: [/^v$/],
      },
    }),
  ],
  base: "./",
});
