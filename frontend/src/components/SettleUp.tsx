import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem" } as const,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%" } as const,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" as const, gap: "0.2rem" } as const,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "0.5rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as const,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.3rem 0.6rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as const,
  optionCard: { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 14, padding: "1.25rem", cursor: "pointer", transition: "border-color 0.15s" } as const,
};

type Mode = null | "equal" | "bill";

interface Person {
  id: number;
  name: string;
  paid: number;
}

function settle(balances: { name: string; balance: number }[]): { from: string; to: string; amount: number }[] {
  const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b, balance: -b.balance })).sort((a, b) => b.balance - a.balance);
  const creditors = balances.filter(b => b.balance > 0.01).sort((a, b) => b.balance - a.balance);
  const result: { from: string; to: string; amount: number }[] = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amt = Math.min(debtors[di].balance, creditors[ci].balance);
    if (amt > 0.01) result.push({ from: debtors[di].name, to: creditors[ci].name, amount: Math.round(amt * 100) / 100 });
    debtors[di].balance -= amt;
    creditors[ci].balance -= amt;
    if (debtors[di].balance < 0.01) di++;
    if (creditors[ci].balance < 0.01) ci++;
  }
  return result;
}

function calcEqualSettlements(persons: Person[]): { from: string; to: string; amount: number }[] {
  if (persons.length < 2) return [];
  const total = persons.reduce((s, p) => s + p.paid, 0);
  const share = total / persons.length;
  const balances = persons.map(p => ({ name: p.name, balance: p.paid - share }));
  return settle(balances);
}

export default function SettleUp() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(null);
  return (
    <div className="responsive-container">
      <button onClick={() => navigate("/")} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1.5rem" }}>&larr; Dashboard</button>
      <h1 style={{ fontSize: "clamp(1.35rem, 5vw, 1.75rem)", fontWeight: 700, marginBottom: "1.5rem" }}>Settle Up</h1>

      {mode === null && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: "1rem" }}>
          <div style={s.optionCard} onClick={() => setMode("equal")}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⚖️</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.25rem" }}>Split Equally</div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>Add people and amounts they paid. Split is calculated evenly among all parties.</div>
          </div>
          <div style={s.optionCard} onClick={() => setMode("bill")}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🧾</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.25rem" }}>Split Bill</div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>Set the total bill amount, add who paid what, and track the remaining balance.</div>
          </div>
        </div>
      )}

      {mode === "equal" && <EqualSplit onBack={() => setMode(null)} />}
      {mode === "bill" && <BillSplit onBack={() => setMode(null)} />}
    </div>
  );
}

function EqualSplit({ onBack }: { onBack: () => void }) {
  const [persons, setPersons] = useState<Person[]>([]);
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [addAmount, setAddAmount] = useState("");

  function addPerson() {
    const name = newName.trim();
    if (!name || persons.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setPersons([...persons, { id: Date.now(), name, paid: 0 }]);
    setNewName("");
  }

  function addAmountTo(id: number) {
    const val = parseFloat(addAmount);
    if (!val || val <= 0) return;
    setPersons(persons.map(p => p.id === id ? { ...p, paid: Math.round((p.paid + val) * 100) / 100 } : p));
    setAddAmount("");
    setAddingTo(null);
  }

  const total = useMemo(() => persons.reduce((s, p) => s + p.paid, 0), [persons]);
  const share = persons.length > 0 ? total / persons.length : 0;
  const settlements = useMemo(() => calcEqualSettlements(persons), [persons]);

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1rem" }}>&larr; Options</button>
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
      {persons.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          {persons.map(p => {
            const balance = p.paid - share;
            return (
              <div key={p.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{p.name}</div>
                  <button onClick={() => setPersons(persons.filter(x => x.id !== p.id))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Paid: ${p.paid.toFixed(2)} · Share: ${share.toFixed(2)}</div>
                {persons.length > 1 && (
                  <div style={{ padding: "0.35rem 0.6rem", background: balance > 0.01 ? "rgba(34,197,94,0.1)" : balance < -0.01 ? "rgba(239,68,68,0.1)" : "var(--bg)", borderRadius: 8, marginBottom: "0.75rem", fontSize: "0.82rem", fontWeight: 600, color: balance > 0.01 ? "#22c55e" : balance < -0.01 ? "#ef4444" : "var(--text-muted)" }}>
                    {balance > 0.01 ? `Gets back $${balance.toFixed(2)}` : balance < -0.01 ? `Owes $${Math.abs(balance).toFixed(2)}` : "Settled"}
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
                  <button onClick={() => setAddingTo(p.id)} style={{ ...s.btnSmall, width: "100%", borderStyle: "dashed", padding: "0.4rem" }}>+ Add Amount</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {persons.length > 1 && (
        <div style={s.card}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Settlements</h2>
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            <span>Total: <strong style={{ color: "var(--text)" }}>${total.toFixed(2)}</strong></span>
            <span>Per person: <strong style={{ color: "var(--text)" }}>${share.toFixed(2)}</strong></span>
          </div>
          {settlements.length === 0 ? (
            <p style={{ color: "#22c55e", fontSize: "0.9rem", fontWeight: 500 }}>All settled up!</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {settlements.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--bg)", borderRadius: 8, fontSize: "0.9rem" }}>
                  <span style={{ fontWeight: 600, color: "#ef4444" }}>{s.from}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>
                  <span style={{ fontWeight: 600, color: "#22c55e" }}>{s.to}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 700 }}>${s.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {persons.length === 0 && <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>Add people to start splitting.</p>}
    </div>
  );
}

function BillSplit({ onBack }: { onBack: () => void }) {
  const [billTotal, setBillTotal] = useState("");
  const [persons, setPersons] = useState<Person[]>([]);
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [addAmount, setAddAmount] = useState("");

  const total = parseFloat(billTotal) || 0;
  const paid = persons.reduce((s, p) => s + p.paid, 0);
  const remaining = total - paid;

  function addPerson() {
    const name = newName.trim();
    if (!name || persons.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setPersons([...persons, { id: Date.now(), name, paid: 0 }]);
    setNewName("");
  }

  function addAmountTo(id: number) {
    const val = parseFloat(addAmount);
    if (!val || val <= 0) return;
    setPersons(persons.map(p => p.id === id ? { ...p, paid: Math.round((p.paid + val) * 100) / 100 } : p));
    setAddAmount("");
    setAddingTo(null);
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1rem" }}>&larr; Options</button>

      {/* Bill total */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <label style={s.label}>
          Bill Total
          <input style={{ ...s.input, maxWidth: 300, fontSize: "1.1rem", fontWeight: 600 }} type="number" step="0.01" min="0"
            value={billTotal} onChange={e => setBillTotal(e.target.value)} placeholder="0.00" />
        </label>
        {total > 0 && (
          <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.8rem", background: remaining > 0.01 ? "rgba(239,68,68,0.1)" : "#22c55e1a", borderRadius: 8, fontSize: "0.9rem", fontWeight: 600, color: remaining > 0.01 ? "#ef4444" : "#22c55e" }}>
            {remaining > 0.01
              ? `Remaining: $${remaining.toFixed(2)} left to cover`
              : remaining < -0.01
                ? `Overpaid by $${Math.abs(remaining).toFixed(2)}`
                : "Fully covered!"
            }
          </div>
        )}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          {persons.map(p => {
            const pct = paid > 0 ? Math.round((p.paid / paid) * 100) : 0;
            return (
              <div key={p.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{p.name}</div>
                  <button onClick={() => setPersons(persons.filter(x => x.id !== p.id))}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>${p.paid.toFixed(2)}</div>
                  {total > 0 && <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{pct}% of total</div>}
                </div>
                {addingTo === p.id ? (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <input style={{ ...s.input, marginTop: 0 }} type="number" step="0.01" value={addAmount} onChange={e => setAddAmount(e.target.value)} placeholder="Amount"
                      onKeyDown={e => { if (e.key === "Enter") addAmountTo(p.id); }} autoFocus />
                    <button onClick={() => addAmountTo(p.id)} style={{ ...s.btnPrimary, fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>✓</button>
                    <button onClick={() => { setAddingTo(null); setAddAmount(""); }} style={s.btnSmall}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingTo(p.id)} style={{ ...s.btnSmall, width: "100%", borderStyle: "dashed", padding: "0.4rem" }}>+ Add Amount</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {persons.length === 0 && total === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.95rem" }}>Set a bill total and add people to start tracking.</p>
        </div>
      )}
    </div>
  );
}
