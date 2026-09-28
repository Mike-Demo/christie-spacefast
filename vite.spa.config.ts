import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const shim = (name: string) => path.resolve(repoRoot, "src/spa/shims", name);

/**
 * Copies the Harper WASM engine into the static output after the bundle is
 * written. The ~16 MB binary must NOT be inlined or bundled: both the
 * in-browser editor (`src/lib/grammar/browser-linter.ts`, via the
 * harper-wasm shim) and the Functions backend fetch it from
 * `/assets/harper_wasm_bg.wasm` at runtime.
 */
function copyHarperWasm(): Plugin {
  return {
    name: "copy-harper-wasm",
    closeBundle() {
      const srcFile = path.resolve(
        repoRoot,
        "node_modules/harper.js/dist/harper_wasm_bg.wasm",
      );
      const dest = path.resolve(repoRoot, "dist-spa/assets/harper_wasm_bg.wasm");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(srcFile, dest);
    },
  };
}

/**
 * Standalone SPA build for the SpaceFast preview.
 *
 * Entry: spa.html -> src/spa/main.tsx. Output: dist-spa/.
 *
 * The `@/*` prefix alias maps to `src/`, but the exact-module aliases below
 * must win over it (alias order matters): they swap the Lovable-hosted asset
 * JSONs, the Supabase client, the Lovable auth helper, the connected-clients
 * listing, and the auth hook for preview shims so no Supabase, Lovable, or
 * server-only code can be reached from the bundle.
 *
 * No `@tanstack/react-start` plugin is included — this is a plain client-side
 * React app.
 */
export default defineConfig({
  plugins: [react(), copyHarperWasm()],
  resolve: {
    alias: [
      {
        find: "@/assets/harper_wasm_bg.wasm.asset.json",
        replacement: shim("harper-wasm.ts"),
      },
      { find: "@/assets/logo.png.asset.json", replacement: shim("logo-asset.ts") },
      { find: "@/integrations/supabase/client", replacement: shim("supabaseClient.ts") },
      { find: "@/integrations/lovable", replacement: shim("lovable.ts") },
      { find: "@/lib/connected-clients", replacement: shim("connectedClients.ts") },
      { find: "@/hooks/useAuth", replacement: shim("useAuth.ts") },
      { find: "@", replacement: path.resolve(repoRoot, "src") },
    ],
  },
  build: {
    outDir: "dist-spa",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(repoRoot, "spa.html"),
    },
  },
});
