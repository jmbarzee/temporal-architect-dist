import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  VisualizerHost,
  mountNodeTypeStyles,
  type PayloadSource,
  type HostActions,
  type HostMessage,
  type DecompositionParams,
} from '@temporal-architect/visualizer'
import '@temporal-architect/visualizer/styles.css'

// Mount registry-generated node-type CSS variables once at module load.
mountNodeTypeStyles()

// twf-serve entry point. This is the host-specific glue — the SSE transport and
// the /decompose POST — that wraps the host-agnostic @temporal-architect/visualizer
// library. It is the browser end of the wire contract the Go server defines, and
// the direct sibling of packages/webview's postMessage glue: the same shared
// <VisualizerHost> shell, mapped onto a different host's two seams.
//
// The shell owns everything both hosts used to hand-roll: payload normalization,
// the AST-hash de-dupe that keeps the graph simulation from resetting on every
// re-post, the Ctrl+Shift+G StyleGuide toggle, and the error / empty / canvas
// render branches. So this file is a thin adapter — a `PayloadSource` for inbound
// payloads and `HostActions` for outbound user intent.

// Inbound seam. An EventSource over /events: the server pushes the current
// payload immediately on connect (first paint) and again on every change — so,
// unlike the webview, there is no `ready` handshake to request initial data.
// Each event's `data:` line is already a HostMessage ({type:'ast',data} |
// {type:'error'}); we JSON-parse and forward, and the shell owns de-dupe +
// normalization (including reading diagnostics from ast.diagnostics).
//
// Defined at module scope so its identity is stable across renders: the shell
// subscribes once per mount (its effect keys on `source`). Recreating it per
// render would tear down and reopen the EventSource every render — a far costlier
// churn than the webview's postMessage listener, and it would drop the live
// connection on each React re-render.
const source: PayloadSource = {
  subscribe(onMessage) {
    const es = new EventSource('/events')
    es.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data) as HostMessage)
      } catch {
        onMessage({ type: 'error', message: 'malformed event from twf-serve' })
      }
    }
    // EventSource reconnects on its own, and the server re-pushes the current
    // payload on every (re)connect, so a dropped connection self-heals with a
    // fresh frame. Stay quiet on transient errors rather than tearing down the
    // last good graph with an error screen that would flicker each reconnect.
    es.onerror = () => {}
    return () => es.close()
  },
}

// Outbound seam. This host wires the one action the webview deliberately leaves
// off (its adapter notes the extension has no recompute handler): the UI→toolchain
// decomposition trigger. requestDecomposition POSTs the params to /decompose; the
// server recomputes via the in-process pipeline and pushes the fresh overlay back
// through the SSE stream, so there is nothing to read from the POST response.
// openFile / refocus are omitted — a plain browser has no editor — and the shell
// treats any unwired action as a no-op.
const actions: HostActions = {
  requestDecomposition: (params: DecompositionParams) => {
    void fetch('/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).catch(() => {
      // The result arrives on the event stream; a transient POST failure needs
      // no UI of its own (the user can simply re-apply).
    })
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VisualizerHost
      source={source}
      actions={actions}
      emptyState={
        <p>
          Waiting for the first graph… edit a <code>.twf</code> file to update.
        </p>
      }
      style={{ height: '100%' }}
    />
  </React.StrictMode>,
)
