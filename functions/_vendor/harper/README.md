# Vendored harper.js JS glue (v2.10.0)

These two files are the JavaScript glue from the `harper.js` npm package's
main entry (`dist/index.js` + `dist/BinaryModule-BmeyZWwZ.js`), copied here
because `functions/` ships with no node_modules.

They contain NO WebAssembly: the 16 MB `harper_wasm_bg.wasm` binary is loaded
at runtime from a URL (a published static asset of the site) via
`createBinaryModuleFromUrl`. Do NOT vendor `binary.js` (it statically
references the bundled WASM via `import.meta.url`).

Source: harper.js 2.10.0, Apache-2.0 license (see LICENSE in this directory).
