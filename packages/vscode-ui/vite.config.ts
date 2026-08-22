import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Build the VS Code webview IIFE bundle from the published
// @temporal-architect/visualizer library.
//
// This is a packaging format, not a library: the toolchain ships the visualizer
// as an npm library; this repo wraps it in the host-specific glue (webview.tsx)
// and bundles a single self-contained IIFE the extension loads into its webview
// panel. React is bundled in (the library externalizes it). Output names and
// directory match what packages/vscode/src/extension.ts hardcodes.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../vscode/dist/webview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/webview.tsx'),
      output: {
        entryFileNames: 'visualizer.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'visualizer.css'
          }
          return 'assets/[name].[ext]'
        },
        format: 'iife',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
})
