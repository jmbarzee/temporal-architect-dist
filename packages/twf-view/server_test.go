package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jmbarzee/temporal-architect/tools/lsp/pipeline"
)

const fixture = "testdata/pipeline.twf"

// testServer spins up the full HTTP surface against the fixture, seeded once.
func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	h := newHub()
	srv := newServer([]string{fixture}, h)
	srv.rebuild()
	ts := httptest.NewServer(srv.routes([]byte("<!doctype html><title>test</title>")))
	t.Cleanup(ts.Close)
	return ts
}

// The served Payload's `ast` field carries a Definition interface that does not
// round-trip through json.Unmarshal, so tests read the payload as raw fields and
// compare normalized JSON rather than unmarshaling into pipeline.Payload.
type doc map[string]json.RawMessage

func decodeDoc(t *testing.T, b []byte) doc {
	t.Helper()
	var d doc
	if err := json.Unmarshal(b, &d); err != nil {
		t.Fatalf("decode payload: %v\n%s", err, b)
	}
	return d
}

// normJSON re-marshals arbitrary JSON into a canonical compact form so two
// encodings of the same value (compact vs indented) compare equal.
func normJSON(t *testing.T, b []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("normJSON: %v", err)
	}
	out, _ := json.Marshal(v)
	return string(out)
}

// TestGraphJSONMatchesPipeline is the Stage 2 gate: /graph.json's parserGraph
// and diagnostics equal what the pipeline produces — the same pipeline.Build
// that backs `twf graph --json` (verified byte-for-byte against the real CLI
// during development; kept in-process here so CI needs no twf binary).
func TestGraphJSONMatchesPipeline(t *testing.T) {
	ts := testServer(t)

	want, err := pipeline.Build([]string{fixture})
	if err != nil {
		t.Fatalf("pipeline.Build: %v", err)
	}
	wantGraph, _ := json.Marshal(want.Graph)
	wantDiag, _ := json.Marshal(pipeline.EnsureSlice(want.Diagnostics))

	d := decodeDoc(t, httpGet(t, ts.URL+"/graph.json"))
	if got, exp := normJSON(t, d["parserGraph"]), normJSON(t, wantGraph); got != exp {
		t.Errorf("parserGraph mismatch:\n want %s\n  got %s", exp, got)
	}
	if _, ok := d["ast"]; !ok || string(d["ast"]) == "null" {
		t.Fatal("graph.json missing ast (needed for design-mode render)")
	}
	// Diagnostics live inside ast (ast.diagnostics), where the visualizer's
	// TreeView reads them — not as a sibling of ast. Same content as the CLI
	// envelope's top-level diagnostics.
	astObj := decodeDoc(t, d["ast"])
	if got, exp := normJSON(t, astObj["diagnostics"]), normJSON(t, wantDiag); got != exp {
		t.Errorf("ast.diagnostics mismatch:\n want %s\n  got %s", exp, got)
	}
	if dec, ok := d["decomposition"]; ok && string(dec) != "null" {
		t.Error("graph.json carried a decomposition before any /decompose request")
	}
}

// TestSecurityHeaders asserts the localhost hardening rides on every response.
func TestSecurityHeaders(t *testing.T) {
	ts := testServer(t)
	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	csp := resp.Header.Get("Content-Security-Policy")
	for _, want := range []string{"default-src 'none'", "connect-src 'self'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP missing %q; got %q", want, csp)
		}
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing X-Content-Type-Options: nosniff")
	}
}

// TestIndexRouting: "/" serves the bundle, unknown paths 404.
func TestIndexRouting(t *testing.T) {
	ts := testServer(t)
	resp, _ := http.Get(ts.URL + "/")
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") {
		t.Errorf("/ = %d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	resp2, _ := http.Get(ts.URL + "/nope")
	if resp2.StatusCode != 404 {
		t.Errorf("/nope = %d, want 404", resp2.StatusCode)
	}
}

// TestSSEFirstPaint: a fresh connection immediately receives the current
// snapshot as a type:"ast" host message carrying a non-empty graph.
func TestSSEFirstPaint(t *testing.T) {
	ts := testServer(t)
	s := openSSE(t, ts.URL+"/events")
	defer s.Close()
	msg := s.next(t)
	if msg.Type != "ast" {
		t.Fatalf("first-paint type = %q, want ast", msg.Type)
	}
	inner := decodeDoc(t, msg.Data)
	if _, ok := inner["parserGraph"]; !ok {
		t.Error("first-paint payload has no parserGraph")
	}
}

// TestDecomposeTrigger is the Stage 5 gate at the HTTP layer: POST /decompose
// flips the server into decomposition mode; the fresh overlay both lands in
// /graph.json and is pushed to a connected SSE client.
func TestDecomposeTrigger(t *testing.T) {
	ts := testServer(t)

	stream := openSSE(t, ts.URL+"/events")
	defer stream.Close()
	if first := stream.next(t); first.Type != "ast" {
		t.Fatalf("pre-trigger frame type = %q", first.Type)
	}

	ceiling := 5
	body, _ := json.Marshal(decompositionParams{Ceiling: &ceiling, By: []string{"tree"}})
	resp, err := http.Post(ts.URL+"/decompose", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("/decompose = %d, want 204", resp.StatusCode)
	}

	// /graph.json now carries a decomposition echoing the requested ceiling.
	d := decodeDoc(t, httpGet(t, ts.URL+"/graph.json"))
	dec, ok := d["decomposition"]
	if !ok || string(dec) == "null" {
		t.Fatal("no decomposition after /decompose")
	}
	var got struct {
		Ceiling int `json:"ceiling"`
	}
	json.Unmarshal(dec, &got)
	if got.Ceiling != ceiling {
		t.Errorf("echoed ceiling = %d, want %d", got.Ceiling, ceiling)
	}

	// The connected client got pushed the new overlay.
	pushed := stream.next(t)
	if pushed.Type != "ast" {
		t.Fatalf("pushed frame type = %q", pushed.Type)
	}
	inner := decodeDoc(t, pushed.Data)
	if dec, ok := inner["decomposition"]; !ok || string(dec) == "null" {
		t.Error("pushed frame carried no decomposition")
	}
}

// TestDecomposeRejectsNonPost guards the method.
func TestDecomposeRejectsNonPost(t *testing.T) {
	ts := testServer(t)
	resp, _ := http.Get(ts.URL + "/decompose")
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET /decompose = %d, want 405", resp.StatusCode)
	}
}

// TestWatchFingerprintChanges: a file mtime bump changes the fingerprint (the
// signal the watch loop rebuilds on); an untouched set does not.
func TestWatchFingerprintChanges(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "a.twf")
	if err := os.WriteFile(f, []byte("workflow W {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fp1 := fingerprint([]string{f})
	if fingerprint([]string{f}) != fp1 {
		t.Fatal("fingerprint not stable for an unchanged file")
	}
	future := time.Now().Add(2 * time.Second)
	os.Chtimes(f, future, future)
	if fingerprint([]string{f}) == fp1 {
		t.Error("fingerprint unchanged after mtime bump")
	}
}

// --- helpers ---

func httpGet(t *testing.T, url string) []byte {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("GET %s = %d", url, resp.StatusCode)
	}
	var buf bytes.Buffer
	buf.ReadFrom(resp.Body)
	return buf.Bytes()
}

// sseStream reads `data:` frames from an SSE endpoint.
type sseStream struct {
	resp *http.Response
	r    *bufio.Reader
}

func openSSE(t *testing.T, url string) *sseStream {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	return &sseStream{resp: resp, r: bufio.NewReader(resp.Body)}
}

func (s *sseStream) Close() { s.resp.Body.Close() }

// next reads until the next `data:` line and unmarshals it as a hostMessage.
// Comment (heartbeat) lines and blanks are skipped. Fails on timeout.
func (s *sseStream) next(t *testing.T) hostMessage {
	t.Helper()
	type result struct {
		m   hostMessage
		err error
	}
	done := make(chan result, 1)
	go func() {
		for {
			line, err := s.r.ReadString('\n')
			if err != nil {
				done <- result{err: err}
				return
			}
			line = strings.TrimRight(line, "\r\n")
			if data, ok := strings.CutPrefix(line, "data: "); ok {
				var m hostMessage
				if err := json.Unmarshal([]byte(data), &m); err != nil {
					done <- result{err: err}
					return
				}
				done <- result{m: m}
				return
			}
		}
	}()
	select {
	case res := <-done:
		if res.err != nil {
			t.Fatalf("SSE read: %v", res.err)
		}
		return res.m
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for SSE frame")
		return hostMessage{}
	}
}
