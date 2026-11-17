import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Dev: `npm run dev` serves the UI on :5173 and forwards /api to the FastAPI app on :8000.
// Build: `npm run build` writes web/dist, which FastAPI serves at /.
export default defineConfig({
  plugins: [preact()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
