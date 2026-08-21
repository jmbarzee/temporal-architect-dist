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

// twf-serve host glue: the SSE transport that wraps the host-agnostic
// <VisualizerHost> shell. This is the browser end of the wire contract the Go
// server defines — the counterpart to packages/webview's postMessage glue.
//
// Inbound: an EventSource over /events. The server pushes the current payload
// immediately on connect (first paint) and again on every change. Each event's
// `data:` line is already a HostMessage ({type:'ast',data} | {type:'error'}), so
// the transport just JSON-parses and forwards; the shell owns de-dupe and
// normalization.
const sseSource: PayloadSource = {
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
    // fresh frame. We deliberately stay quiet on transient errors rather than
    // tearing down the last good graph with an error screen that would flicker
    // on each reconnect cycle.
    es.onerror = () => {}
    return () => es.close()
  },
}

// Outbound: the only wired action is the decomposition-recompute trigger. A
// plain browser has no editor, so openFile / refocus are intentionally omitted
// (they no-op in the shell). requestDecomposition POSTs the params to
// /decompose; the server recomputes via the in-process pipeline and pushes the
// fresh overlay back through the SSE stream, so there is nothing to read from
// the POST response.
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
      source={sseSource}
      actions={actions}
      emptyState={
        <p>
          Waiting for the first graph… edit a <code>.twf</code> file to update.
        </p>
      }
      style={{ height: '100vh' }}
    />
  </React.StrictMode>,
)
