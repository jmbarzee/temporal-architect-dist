// Command twf-serve hosts the temporal-architect visualizer over a local HTTP
// server: it parses a set of .twf files in-process (via the toolchain's
// tools/lsp/pipeline), serves the shared <VisualizerHost> app at a loopback
// URL, watches the files, and pushes re-parsed graphs to the browser over SSE
// on every change. It is the visualizer's second host — any agent host with a
// browser surface sees the design graph live at a plain localhost URL, without
// the VS Code webview.
//
// Usage:
//
//	twf-serve [--port N] [--open] <file...>
//
// The server binds 127.0.0.1 only, runs in the foreground, and stops on Ctrl+C.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"
)

// version is stamped at release time via -ldflags "-X main.version=<VER>" (see
// the Makefile's build-twf-serve-archive). A plain `go install` / `go build`
// leaves it as "dev". The Homebrew formula's `test do` asserts this against the
// installed version, so it must print on `--version` and exit 0.
var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "twf-serve:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("twf-serve", flag.ContinueOnError)
	port := fs.Int("port", 0, "port to bind on 127.0.0.1 (0 = OS-assigned)")
	open := fs.Bool("open", false, "open the served URL in the default browser")
	showVersion := fs.Bool("version", false, "print version and exit")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: twf-serve [--port N] [--open] <file...>")
		fmt.Fprintln(fs.Output(), "\nServe the temporal-architect visualizer over local HTTP, live-reloading")
		fmt.Fprintln(fs.Output(), "as the given .twf files change. Binds 127.0.0.1 only; Ctrl+C to stop.")
		fmt.Fprintln(fs.Output())
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *showVersion {
		fmt.Println("twf-serve", version)
		return nil
	}
	paths := fs.Args()
	if len(paths) == 0 {
		fs.Usage()
		return fmt.Errorf("no input files")
	}

	// Bind loopback only — never 0.0.0.0. A single-user local tool has no
	// business being reachable off-host.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	url := fmt.Sprintf("http://%s/", ln.Addr().String())

	h := newHub()
	srv := newServer(paths, h)
	srv.rebuild() // seed first paint / /graph.json before anyone connects

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go watch(ctx, paths, defaultWatchInterval, srv.rebuild)

	httpServer := &http.Server{Handler: srv.routes(indexHTML)}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		httpServer.Shutdown(shutdownCtx)
	}()

	fmt.Printf("twf-serve: watching %d input(s), serving %s\n", len(paths), url)
	fmt.Println("twf-serve: press Ctrl+C to stop")
	if *open {
		openBrowser(url)
	}

	if err := httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
		return err
	}
	fmt.Println("\ntwf-serve: stopped")
	return nil
}

// openBrowser best-effort opens url in the platform default browser. A failure
// is non-fatal: the URL is already printed, so the user can open it by hand.
func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", "", url}
	default: // linux, bsd, …
		cmd = "xdg-open"
		args = []string{url}
	}
	if err := exec.Command(cmd, args...).Start(); err != nil {
		fmt.Fprintf(os.Stderr, "twf-serve: could not open browser (%v); open %s manually\n", err, url)
	}
}
