import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  VisualizerHost,
  mountNodeTypeStyles,
  type PayloadSource,
  type HostActions,
} from '@temporal-architect/visualizer'
import '@temporal-architect/visualizer/styles.css'

// Mount registry-generated node-type CSS variables once at module load.
mountNodeTypeStyles()

// VSCode webview entry point. This is the host-specific glue — the editor
// message protocol and the VS Code webview API — that wraps the host-agnostic
// @temporal-architect/visualizer library. It lives in the distribution repo
// (next to the extension that defines the other end of this protocol), not in
// the toolchain.
//
// The visualizer ships the shared <VisualizerHost> shell, which owns everything
// this file used to hand-roll: payload normalization, the AST-hash de-dupe that
// keeps the graph simulation from resetting on every focus re-post, the
// Ctrl+Shift+G StyleGuide toggle, and the error / empty / canvas render
// branches. So this file is now a thin adapter — it maps the VS Code webview
// message protocol onto the shell's two seams: a `PayloadSource` for inbound
// payloads and `HostActions` for outbound user intent.
declare const acquireVsCodeApi: () => {
  postMessage: (msg: unknown) => void
  getState: () => unknown
  setState: (state: unknown) => void
}

const vscode = acquireVsCodeApi()

// Cache the VS Code API on window so the filter storage shim can reuse it
// (acquireVsCodeApi can only be called once per webview).
;(window as unknown as { __twfVsCodeApi?: typeof vscode }).__twfVsCodeApi = vscode

// Inbound seam. The `ast` message from the VS Code extension carries one of:
// the wrapped `{ ast, parserGraph }` envelope (used for both .twf design mode
// and, projected from the sampler's observed graph, history mode) or a bare AST
// payload; the shell's normalizePayload handles these plus the raw
// graph/observed-graph envelopes. `ast.diagnostics` (structured warnings/errors
// from `twf parse`'s envelope) and `ast.errors` (catastrophic parser-process
// failures) both ride along on the forwarded payload unchanged; the
// TreeView / GraphView headers consume both fields directly.
//
// Defined at module scope so its identity is stable across renders: the shell
// subscribes once per mount (its effect keys on `source`), which is exactly
// where the pre-migration code registered its listener and posted its one-shot
// `ready`.
const source: PayloadSource = {
  subscribe(onMessage) {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'ast') {
        onMessage({ type: 'ast', data: message.data })
      } else if (message.type === 'error') {
        onMessage({ type: 'error', message: message.message })
      }
    }

    window.addEventListener('message', handleMessage)

    // Request initial data — the shell has mounted and is now listening.
    vscode.postMessage({ type: 'ready' })

    return () => window.removeEventListener('message', handleMessage)
  },
}

// Outbound seam. Only the two actions the extension host already handles are
// wired; the shell treats any unwired action as a no-op.
//
// `requestDecomposition` is intentionally left unwired. The extension host has
// no recompute handler, so leaving it off preserves the current message
// protocol exactly — the Groups modal's Params tab stays the read-only readout
// it has always been in the webview. Wiring the outbound recompute is the
// served-visualizer work (toolchain #20 / #21), not this migration.
const actions: HostActions = {
  openFile: (file) => vscode.postMessage({ type: 'openFile', file }),
  refocus: () => vscode.postMessage({ type: 'refocus' }),
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VisualizerHost
      source={source}
      actions={actions}
      emptyState={
        <p>
          Open a <code>.twf</code> file or connect to the extension to get
          started.
        </p>
      }
      style={{ height: '100%' }}
    />
  </React.StrictMode>,
)
