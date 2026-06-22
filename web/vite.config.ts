import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The denoise AudioWorklet (`public/denoise-worklet.js`) and the standalone
// WebAssembly module (`public/denoise.wasm`) are served as-is from `public/`,
// so they are reachable under the configured base in both dev and build.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
