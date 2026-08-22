import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { resolve } from 'path'

// Build the twf-serve visualizer bundle from the published
// @temporal-architect/visualizer library as ONE self-contained HTML file.
//
// This is a packaging format, not a library — the sibling of packages/webview.
// The webview emits an IIFE the VS Code extension injects; this emits a single
// HTML document with the JS and CSS inlined (vite-plugin-singlefile), which the
// Go binary embeds verbatim (go:embed) and serves at "/". A single embedded
// asset with no external references is what lets the server ship one file and
// satisfy a strict, inline-only CSP.
//
// Output lands in the Go package's embed dir; that file is COMMITTED (not
// gitignored like the webview bundle) because `go install` fetches the module
// from the proxy and cannot run vite. See packages/twf-serve/assets.go.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, '../twf-serve/ui'),
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
