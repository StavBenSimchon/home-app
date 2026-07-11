import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem" } as const,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%" } as const,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" as const, gap: "0.2rem" } as const,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "0.5rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as const,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.3rem 0.6rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as const,
};

interface Person {
  id: number;
  name: string;
  amounts: number[];
}

export default function BillPaymentSplit() {
  const navigate = useNavigate();
  const [billTotal, setBillTotal] = useState("");
  const [persons, setPersons] = useState<Person[]>([]);
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [addAmount, setAddAmount] = useState("");

  const total = parseFloat(billTotal) || 0;

  const data = useMemo(() => {
    if (persons.length === 0 || total <= 0) return null;
    const share = total / persons.length;
    const rows = persons.map(p => {
      const paid = p.amounts.reduce((a, b) => a + b, 0);
      const diff = paid - share;
      const transfer = Math.round((share - diff) * 100) / 100;
      return { ...p, paid, share, diff, transfer: Math.max(0, transfer) };
    });
    return { share, rows, totalTransfers: rows.reduce((s, r) => s + r.transfer, 0) };
  }, [persons, total]);

  function addPerson() {
    const name = newName.trim();
    if (!name || persons.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setPersons([...persons, { id: Date.now(), name, amounts: [] }]);
    setNewName("");
  }

  function addAmountTo(id: number) {
    const val = parseFloat(addAmount);
    if (!val || val <= 0) return;
    setPersons(persons.map(p => p.id === id ? { ...p, amounts: [...p.amounts, Math.round(val * 100) / 100] } : p));
    setAddAmount("");
    setAddingTo(null);
  }

  function removeAmount(personId: number, idx: number) {
    setPersons(persons.map(p => p.id === personId ? { ...p, amounts: p.amounts.filter((_, i) => i !== idx) } : p));
  }

  return (
    <div className="responsive-container">
      <button onClick={() => navigate("/")} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1.5rem" }}>&larr; Dashboard</button>
      <h1 style={{ fontSize: "clamp(1.35rem, 5vw, 1.75rem)", fontWeight: 700, marginBottom: "0.25rem" }}>Bill Payment Split</h1>
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>Split a bank account charge between people based on what they already paid.</p>

      {/* Bill total */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <label style={s.label}>
          Bank Account Charge
          <input style={{ ...s.input, maxWidth: 300, fontSize: "1.1rem", fontWeight: 600 }} type="number" step="0.01" min="0"
            value={billTotal} onChange={e => setBillTotal(e.target.value)} placeholder="0.00" />
        </label>
      </div>

      {/* Add person */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <label style={s.label}>
          Add Person
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input style={s.input} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Enter name…"
              onKeyDown={e => { if (e.key === "Enter") addPerson(); }} />
            <button onClick={addPerson} style={{ ...s.btnPrimary, whiteSpace: "nowrap" }} disabled={!newName.trim()}>Add</button>
          </div>
        </label>
      </div>

      {/* Person cards */}
      {persons.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {persons.map(p => {
            const paid = p.amounts.reduce((a, b) => a + b, 0);
            return (
              <div key={p.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{p.name}</div>
                  <button onClick={() => setPersons(persons.filter(x => x.id !== p.id))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                </div>
                <div style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "0.25rem" }}>${paid.toFixed(2)}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>paid personally</div>
                {p.amounts.length > 1 && (
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    {p.amounts.map(a => `$${a.toFixed(2)}`).join(" + ")}
                  </div>
                )}
                {p.amounts.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", marginBottom: "0.5rem" }}>
                    {p.amounts.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0.4rem", background: "var(--bg)", borderRadius: 5, fontSize: "0.78rem" }}>
                        <span>${a.toFixed(2)}</span>
                        <button onClick={() => removeAmount(p.id, i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.6rem" }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {addingTo === p.id ? (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <input style={{ ...s.input, marginTop: 0 }} type="number" step="0.01" value={addAmount} onChange={e => setAddAmount(e.target.value)} placeholder="Amount"
                      onKeyDown={e => { if (e.key === "Enter") addAmountTo(p.id); }} autoFocus />
                    <button onClick={() => addAmountTo(p.id)} style={{ ...s.btnPrimary, fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>✓</button>
                    <button onClick={() => { setAddingTo(null); setAddAmount(""); }} style={s.btnSmall}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingTo(p.id)} style={{ ...s.btnSmall, width: "100%", borderStyle: "dashed", padding: "0.35rem" }}>+ Add Amount</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Results */}
      {data && (
        <div style={s.card}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Payment Summary</h2>
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", fontSize: "0.82rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span>Bill: <strong style={{ color: "var(--text)" }}>${total.toFixed(2)}</strong></span>
            <span>Each pays: <strong style={{ color: "var(--text)" }}>${data.share.toFixed(2)}</strong></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {data.rows.map(r => (
              <div key={r.id} style={{ padding: "0.6rem 0.8rem", background: "var(--bg)", borderRadius: 8, display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 600, minWidth: 80 }}>{r.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: 1 }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Paid:</span>
                  <span style={{ fontSize: "0.82rem" }}>${r.paid.toFixed(2)}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Transfer:</span>
                  <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--primary)" }}>${r.transfer.toFixed(2)}</span>
                </div>
                <div style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", borderRadius: 6, background: r.diff > 0.01 ? "rgba(34,197,94,0.1)" : r.diff < -0.01 ? "rgba(239,68,68,0.1)" : "var(--surface)", color: r.diff > 0.01 ? "#22c55e" : r.diff < -0.01 ? "#ef4444" : "var(--text-muted)", fontWeight: 600 }}>
                  {r.diff > 0.01 ? `+$${r.diff.toFixed(2)}` : r.diff < -0.01 ? `-$${Math.abs(r.diff).toFixed(2)}` : "even"}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.8rem", background: "var(--bg)", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>Total transfers to bank</span>
            <span>${data.totalTransfers.toFixed(2)}</span>
          </div>
        </div>
      )}

      {persons.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.95rem" }}>Set the bank charge and add people to start splitting.</p>
        </div>
      )}
    </div>
  );
}
