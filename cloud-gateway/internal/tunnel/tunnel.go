package tunnel

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Request struct {
	ID      string            `json:"id"`
	Service string            `json:"service"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
}

type Response struct {
	ID      string            `json:"id"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body"`
}

type wsMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type Agent struct {
	ID      string
	Conn    *websocket.Conn
	mu      sync.Mutex
	pending sync.Map
}

func (a *Agent) sendRequest(req *Request) error {
	wrapper := wsMessage{Type: "request"}
	wrapper.Data, _ = json.Marshal(req)
	data, _ := json.Marshal(wrapper)
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.Conn.WriteMessage(websocket.TextMessage, data)
}

func (a *Agent) registerPending(id string, ch chan *Response) {
	a.pending.Store(id, ch)
}

func (a *Agent) resolvePending(resp *Response) {
	if ch, ok := a.pending.LoadAndDelete(resp.ID); ok {
		ch.(chan *Response) <- resp
	}
}

type Manager struct {
	mu        sync.Mutex
	agents    map[string]*Agent
	tlsConfig *tls.Config
}

func NewManager(caCertPath string) (*Manager, error) {
	m := &Manager{agents: make(map[string]*Agent)}

	if caCertPath != "" {
		caCert, err := ioutil.ReadFile(caCertPath)
		if err != nil {
			return nil, fmt.Errorf("read ca cert: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caCert) {
			return nil, errors.New("failed to parse ca cert")
		}
		m.tlsConfig = &tls.Config{
			ClientCAs:  pool,
			ClientAuth: tls.RequireAndVerifyClientCert,
		}
		log.Println("mTLS enabled for agent connections")
	}

	return m, nil
}

func (m *Manager) upgrader() websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
		TLSClientConfig: m.tlsConfig,
	}
}

func (m *Manager) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	if m.tlsConfig != nil && r.TLS == nil {
		http.Error(w, "wss requires tls", http.StatusBadRequest)
		return
	}

	upgrader := m.upgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}

	id := r.Header.Get("X-Agent-ID")
	if id == "" {
		if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
			id = r.TLS.PeerCertificates[0].Subject.CommonName
		} else {
			id = "agent-" + time.Now().Format("20060102150405")
		}
	}

	agent := &Agent{ID: id, Conn: conn}

	m.mu.Lock()
	m.agents[id] = agent
	m.mu.Unlock()

	log.Printf("agent connected: %s", id)

	defer func() {
		m.mu.Lock()
		delete(m.agents, id)
		m.mu.Unlock()
		conn.Close()
		log.Printf("agent disconnected: %s", id)
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Printf("read error from %s: %v", id, err)
			return
		}

		var wrapper wsMessage
		if err := json.Unmarshal(msg, &wrapper); err != nil {
			continue
		}

		if wrapper.Type == "response" {
			var resp Response
			if err := json.Unmarshal(wrapper.Data, &resp); err != nil {
				continue
			}
			agent.resolvePending(&resp)
		}
	}
}

func (m *Manager) ForwardRequest(req *Request, timeout time.Duration) (*Response, error) {
	m.mu.Lock()
	if len(m.agents) == 0 {
		m.mu.Unlock()
		return nil, ErrNoAgent
	}

	var agent *Agent
	for _, a := range m.agents {
		agent = a
		break
	}
	m.mu.Unlock()

	ch := make(chan *Response, 1)
	agent.registerPending(req.ID, ch)

	if err := agent.sendRequest(req); err != nil {
		agent.pending.Delete(req.ID)
		return nil, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-time.After(timeout):
		agent.pending.Delete(req.ID)
		return nil, ErrTimeout
	}
}

func (m *Manager) AgentCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.agents)
}

type agentError string

func (e agentError) Error() string { return string(e) }

var (
	ErrNoAgent = agentError("no agents connected")
	ErrTimeout = agentError("agent did not respond in time")
)
