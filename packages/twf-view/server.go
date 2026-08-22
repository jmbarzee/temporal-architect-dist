package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/jmbarzee/temporal-architect/tools/lsp/parser/decompose"
)

// server owns the served payload state and the HTTP surface. It is the single
// host behind every route: first paint, the SSE stream, the /graph.json parity
// endpoint, and the decomposition-recompute trigger all read or drive the same
// build path, so the browser and a scripted `curl` never see divergent graphs.
type server struct {
	paths []string
	hub   *hub

	// mu guards the decomposition mode. Plain Build (graph only) is the default,
	// matching the pipeline's documented "serve uses Build" stance; the first
	// POST /decompose flips decompose on and records opts, and every rebuild
	// thereafter carries the overlay so it tracks .twf edits. The visualizer's
	// Groups panel is built for exactly this "no decomposition yet → request the
	// first one" flow (GraphView / GroupsModal), so a graph-only first paint is
	// the intended state, not a degraded one.
	mu        sync.Mutex
	decompose bool
	opts      decompose.Options
}

func newServer(paths []string, h *hub) *server {
	return &server{paths: paths, hub: h}
}

// mode returns the current decomposition mode + opts under lock.
func (s *server) mode() (bool, decompose.Options) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.decompose, s.opts
}

// rebuild recomputes the payload from the current inputs and mode and publishes
// it to every connected client. It is idempotent and safe to call from the
// watch loop, the decomposition trigger, and startup.
func (s *server) rebuild() {
	dec, opts := s.mode()
	msg := buildMessage(s.paths, dec, opts)
	s.hub.publish(marshalMessage(msg))
}

// routes wires the HTTP surface. Every response carries the security headers
// (see secure); the mux itself is bound to 127.0.0.1 by the caller.
func (s *server) routes(indexHTML []byte) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/events", s.handleEvents)
	mux.HandleFunc("/graph.json", s.handleGraphJSON)
	mux.HandleFunc("/decompose", s.handleDecompose)
	mux.HandleFunc("/", s.indexHandler(indexHTML))
	return secure(mux)
}

// indexHandler serves the embedded single-file visualizer bundle at "/" and
// 404s everything else (so an unknown path is not silently served the app).
func (s *server) indexHandler(indexHTML []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(indexHTML)
	}
}

// handleGraphJSON emits the current wrapped payload as JSON — the exact bytes
// the SSE stream pushes, so a scripted `curl` and the browser see the same
// graph. Its parserGraph is byte-identical to `twf graph --json`'s `graph` on
// the same inputs (both flow from pipeline.Build), and its ast.diagnostics carry
// the same diagnostics the CLI envelope lists; it additionally carries the ast
// the visualizer renders and — once a decomposition has been requested — the
// decomposition overlay. Primarily a scriptable parity / debug endpoint.
func (s *server) handleGraphJSON(w http.ResponseWriter, r *http.Request) {
	dec, opts := s.mode()
	payload, err := buildPayload(s.paths, dec, opts)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	data, err := wireBytes(payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	var pretty bytes.Buffer
	if json.Indent(&pretty, data, "", "  ") == nil {
		w.Write(pretty.Bytes())
	} else {
		w.Write(data)
	}
}

// handleDecompose is the UI→toolchain recompute trigger. It accepts the
// DecompositionParams the visualizer's Groups panel emits (ceiling/floor/by/
// maxDepth), maps them field-for-field onto decompose.Options, flips the server
// into decomposition mode, and rebuilds — the fresh overlay flows back out to
// every client over SSE. Returns 204; the result arrives on the event stream,
// not in this response body.
func (s *server) handleDecompose(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var params decompositionParams
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&params); err != nil {
		http.Error(w, "invalid decomposition params: "+err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.decompose = true
	s.opts = params.toOptions()
	s.mu.Unlock()

	s.rebuild()
	w.WriteHeader(http.StatusNoContent)
}

// decompositionParams is the JSON body of POST /decompose, mirroring the
// TypeScript DecompositionParams the Groups panel sends. All fields are
// optional; an unset field takes the pipeline's own default via the zero value
// of decompose.Options.
type decompositionParams struct {
	Ceiling  *int     `json:"ceiling"`
	Floor    *int     `json:"floor"`
	By       []string `json:"by"`
	MaxDepth *int     `json:"maxDepth"`
}

func (p decompositionParams) toOptions() decompose.Options {
	var o decompose.Options
	if p.Ceiling != nil {
		o.Ceiling = *p.Ceiling
	}
	if p.Floor != nil {
		o.Floor = *p.Floor
	}
	if p.MaxDepth != nil {
		o.MaxDepth = *p.MaxDepth
	}
	o.By = p.By
	return o
}

// handleEvents is the SSE stream. On connect it immediately writes the current
// snapshot (first paint), then forwards every published frame until the client
// disconnects. A periodic comment heartbeat keeps intermediaries from idling
// the connection shut and lets the server notice a dead peer.
func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch, current := s.hub.subscribe()
	defer s.hub.unsubscribe(ch)

	if current != nil {
		writeSSE(w, current)
		flusher.Flush()
	}

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, msg)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

// writeSSE writes one event frame. hostMessage JSON is single-line (json.Marshal
// emits no embedded newlines), so a single `data:` line is always sufficient.
func writeSSE(w http.ResponseWriter, msg []byte) {
	fmt.Fprintf(w, "data: %s\n\n", msg)
}

// secure wraps a handler with the localhost-appropriate security headers: a
// strict CSP that permits only the inlined single-file bundle and same-origin
// connections (the SSE stream + the /decompose POST), plus defense-in-depth
// framing/sniffing headers. No auth: the listener is bound to 127.0.0.1 and the
// tool is single-user by design.
func secure(next http.Handler) http.Handler {
	const csp = "default-src 'none'; " +
		"script-src 'unsafe-inline'; " + // vite-plugin-singlefile inlines JS as an inline <script>
		"style-src 'unsafe-inline'; " + // and CSS as an inline <style>
		"img-src data:; " + // inlined raster/svg assets ride as data: URIs
		"font-src data:; " +
		"connect-src 'self'; " + // EventSource(/events) + fetch(/decompose)
		"base-uri 'none'; " +
		"form-action 'none'"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", csp)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
