import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The app is fully static: it loads ./data/league.json and calculates everything in the browser.
// Dev: `npm run dev` serves the UI on :5173 and takes /data from the local sync app on :8000.
// Build: `npm run build` writes web/dist; `npm run build:site` also copies ../data into it.
export default defineConfig({
  plugins: [preact()],
  base: "./",
  server: { proxy: { "/data": "http://127.0.0.1:8000" } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
