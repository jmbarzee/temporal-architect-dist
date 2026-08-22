package main

import "sync"

// hub is the SSE fan-out. It holds the current payload message (so a client
// that connects mid-session gets an immediate first paint) and the set of
// connected client channels (so a change reaches every open browser tab).
//
// Single-user localhost means the client count is tiny; a mutex-guarded map is
// more than enough and keeps the broadcast path obvious. Each client channel is
// buffered by one: broadcast never blocks on a slow reader, and a reader that
// has fallen behind simply coalesces to the latest state it manages to read
// (the payload is a full snapshot, so dropping an intermediate frame is
// harmless — the client always converges on current).
type hub struct {
	mu      sync.Mutex
	current []byte // marshaled hostMessage, or nil before the first build
	clients map[chan []byte]struct{}
}

func newHub() *hub {
	return &hub{clients: make(map[chan []byte]struct{})}
}

// publish records msg as the current snapshot and pushes it to every connected
// client. A client whose buffer is full is skipped for this frame rather than
// blocking the publisher; it will receive the next frame, and since every frame
// is a full snapshot it loses nothing durable.
func (h *hub) publish(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.current = msg
	for ch := range h.clients {
		select {
		case ch <- msg:
		default:
			// Reader is behind; drop this frame for this client. A fresh
			// snapshot is always coming, and the buffered slot will carry it.
		}
	}
}

// subscribe registers a new client and returns its channel plus the current
// snapshot (possibly nil) to send immediately for first paint. The caller must
// call unsubscribe when the connection closes.
func (h *hub) subscribe() (chan []byte, []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan []byte, 1)
	h.clients[ch] = struct{}{}
	return ch, h.current
}

func (h *hub) unsubscribe(ch chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[ch]; ok {
		delete(h.clients, ch)
		close(ch)
	}
}

// snapshot returns the current payload message, or nil before the first build.
func (h *hub) snapshot() []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.current
}
