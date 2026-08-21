package main

import (
	"encoding/json"

	"github.com/jmbarzee/temporal-architect/tools/lsp/parser/decompose"
	"github.com/jmbarzee/temporal-architect/tools/lsp/parser/graph"
	"github.com/jmbarzee/temporal-architect/tools/lsp/pipeline"
)

// hostMessage is the inbound message the visualizer shell consumes, mirroring
// the TypeScript `HostMessage` union in @temporal-architect/visualizer's
// protocol module:
//
//	{ type: 'ast';   data: <wrapped payload> }
//	{ type: 'error'; message: string }
//
// The serve-ui SSE transport JSON-parses each event's `data:` line straight
// into this shape and forwards it to the shell, so this struct IS the wire
// contract between the Go host and the browser shell.
type hostMessage struct {
	Type    string          `json:"type"`
	Data    json.RawMessage `json:"data,omitempty"`
	Message string          `json:"message,omitempty"`
}

// wirePayload is the wrapped payload the visualizer's normalizePayload consumes:
// `{ ast, parserGraph?, decomposition? }`.
//
// Note the placement of diagnostics. normalizePayload keeps `ast`, `parserGraph`
// and `decomposition` but drops any *sibling* `diagnostics` key, and the tree /
// graph headers read diagnostics from `ast.diagnostics` (TreeView.tsx). The VS
// Code extension — the reference host — assembles `ast` accordingly, nesting
// `diagnostics` (and `errors`) inside it. pipeline.Payload, by contrast, marshals
// diagnostics as a sibling of `ast`, so handing its JSON straight to the shell
// would silently hide every warning and parse error. wireBytes therefore lifts
// pipeline.Payload.Diagnostics into `ast.diagnostics`, reproducing the shape the
// shell actually reads.
type wirePayload struct {
	AST           map[string]json.RawMessage `json:"ast"`
	ParserGraph   *graph.Graph               `json:"parserGraph,omitempty"`
	Decomposition *decompose.Result          `json:"decomposition,omitempty"`
}

// buildMessage runs the in-process pipeline over the given input files and
// packages the result as a hostMessage.
//
// It is the single compute entry point shared by first-paint, the watch loop,
// and the decomposition-recompute trigger. When decomposeOverlay is true it
// calls pipeline.BuildDecompose (graph + chunk overlay in one consistent call);
// otherwise pipeline.Build (graph only). A catastrophic build error (e.g. no
// input files, unreadable file) becomes a `type:"error"` message the shell
// surfaces verbatim; a successful build — even one carrying parse/graph
// diagnostics — becomes a `type:"ast"` message whose data is the wrapped
// payload the visualizer renders (with diagnostics nested where it reads them).
func buildMessage(paths []string, decomposeOverlay bool, opts decompose.Options) hostMessage {
	payload, err := buildPayload(paths, decomposeOverlay, opts)
	if err != nil {
		return hostMessage{Type: "error", Message: err.Error()}
	}
	data, err := wireBytes(payload)
	if err != nil {
		return hostMessage{Type: "error", Message: err.Error()}
	}
	return hostMessage{Type: "ast", Data: data}
}

// buildPayload is the raw pipeline call, split out so callers that want the
// Payload struct (rather than the wire JSON) can have it.
func buildPayload(paths []string, decomposeOverlay bool, opts decompose.Options) (pipeline.Payload, error) {
	if decomposeOverlay {
		return pipeline.BuildDecompose(paths, opts)
	}
	return pipeline.Build(paths)
}

// wireBytes marshals a Payload into the wrapped shape the visualizer consumes,
// nesting diagnostics inside `ast` (see wirePayload). It is the single wire
// encoder shared by the SSE stream and /graph.json, so both endpoints and the
// browser always agree.
func wireBytes(p pipeline.Payload) ([]byte, error) {
	astObj := map[string]json.RawMessage{}
	if p.AST != nil {
		raw, err := json.Marshal(p.AST)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &astObj); err != nil {
			return nil, err
		}
	}
	// Always emit an array (never null) so the shell's `ast.diagnostics || []`
	// and our own consumers see a stable type.
	diags := p.Diagnostics
	if diags == nil {
		diags = []pipeline.Diagnostic{}
	}
	diagRaw, err := json.Marshal(diags)
	if err != nil {
		return nil, err
	}
	astObj["diagnostics"] = diagRaw

	return json.Marshal(wirePayload{
		AST:           astObj,
		ParserGraph:   p.Graph,
		Decomposition: p.Decomposition,
	})
}

// marshalMessage serializes a hostMessage for an SSE `data:` line. It never
// fails in practice (hostMessage is plain JSON), but the error is surfaced as a
// fallback error message rather than panicking the broadcast loop.
func marshalMessage(m hostMessage) []byte {
	b, err := json.Marshal(m)
	if err != nil {
		fallback, _ := json.Marshal(hostMessage{Type: "error", Message: "internal: " + err.Error()})
		return fallback
	}
	return b
}
