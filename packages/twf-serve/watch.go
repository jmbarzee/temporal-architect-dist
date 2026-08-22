package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jmbarzee/temporal-architect/tools/lsp/pipeline"
)

// defaultWatchInterval keeps the edit→update latency comfortably sub-second
// (the Stage 4 gate) while polling cheaply — a stat over a handful of .twf
// files every quarter second is negligible.
const defaultWatchInterval = 250 * time.Millisecond

// watch polls the input set on an interval and invokes onChange whenever the
// set's fingerprint changes. It re-expands the inputs every tick (via
// pipeline.ExpandInputs) so a newly created or deleted file inside a watched
// directory is picked up, not just mtime changes to already-known files.
//
// The fingerprint folds each resolved file's path, mtime, and size; an
// expansion error (e.g. a watched directory removed) folds into the fingerprint
// as its own state, so the transition into and back out of an error is itself a
// change that triggers a rebuild — which is how a parse/IO error surfaces in the
// browser and then recovers.
func watch(ctx context.Context, paths []string, interval time.Duration, onChange func()) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	last := fingerprint(paths)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if fp := fingerprint(paths); fp != last {
				last = fp
				onChange()
			}
		}
	}
}

// fingerprint resolves the input set and folds it into a comparable string.
// Order-independent by sorting the resolved paths first, so a nondeterministic
// glob expansion order does not read as a change.
func fingerprint(paths []string) string {
	files, err := pipeline.ExpandInputs(paths)
	if err != nil {
		return "expand-error:" + err.Error()
	}
	sort.Strings(files)
	var b strings.Builder
	for _, f := range files {
		info, err := os.Stat(f)
		if err != nil {
			fmt.Fprintf(&b, "%s|stat-error:%s\n", f, err.Error())
			continue
		}
		fmt.Fprintf(&b, "%s|%d|%d\n", f, info.ModTime().UnixNano(), info.Size())
	}
	return b.String()
}
