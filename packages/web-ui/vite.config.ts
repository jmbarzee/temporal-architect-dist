import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { resolve } from 'path'

// Build the shared SSE visualizer bundle from the published
// @temporal-architect/visualizer library as ONE self-contained HTML file.
//
// This is a packaging format, not a library — the sibling of packages/vscode-ui.
// vscode-ui emits an IIFE the VS Code extension injects over postMessage; this
// emits a single HTML document with the JS and CSS inlined (vite-plugin-
// singlefile), served at "/" by every local-HTTP host over SSE. A single
// embedded asset with no external references is what lets a server ship one file
// and satisfy a strict, inline-only CSP.
//
// Output lands in THIS package's dist/ — web-ui owns the bundle. Its two
// consumers copy from here: the Makefile's `build-web-ui` copies it into
// packages/twf-view/ui/index.html (COMMITTED, because `go install` fetches the
// module from the proxy and cannot run vite — see packages/twf-view/assets.go),
// and @temporal-architect/serve copies it into its assets/ at prepack.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    cssCodeSplit: false,
    // Inline every asset regardless of size so nothing is emitted as a separate
    // file the single HTML would have to reference.
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
})
