/**
 * SpaceFast preview shim for the Harper WASM asset.
 *
 * The original `src/lib/grammar/browser-linter.ts` imports the engine binary
 * through a Lovable-hosted asset JSON (`@/__l5e/assets-v1/...`). In the
 * preview the ~16 MB binary is copied to the static output as
 * `/assets/harper_wasm_bg.wasm` (see `vite.spa.config.ts`), so the linter
 * keeps working with no Lovable dependency.
 */
const harperWasmAsset = {
  url: "/assets/harper_wasm_bg.wasm",
};

export default harperWasmAsset;
