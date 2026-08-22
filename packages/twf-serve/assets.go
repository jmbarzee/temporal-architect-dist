package main

import _ "embed"

// indexHTML is the visualizer served at "/". It is the single-file bundle
// produced by packages/serve-ui (vite + vite-plugin-singlefile): one HTML
// document with the JS and CSS inlined, so the Go binary embeds exactly one
// asset and serves it with no external references.
//
// This file is COMMITTED build output, not gitignored (unlike the VS Code
// webview bundle). A `go install` / `go build` of this module fetches it from
// the module proxy and cannot run vite, so the embedded asset has to travel
// inside the module. `make serve-ui` regenerates it from source; see
// packages/serve-ui.
//
//go:embed ui/index.html
var indexHTML []byte
