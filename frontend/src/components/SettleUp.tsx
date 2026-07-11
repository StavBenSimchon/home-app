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

type Mode = null | "equal" | "bill" | "payment";

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
          <div style={s.optionCard} onClick={() => setMode("payment")}>
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🏦</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.25rem" }}>Bill Payment</div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>Split a bank account charge. See how much each person transfers based on what they already paid.</div>
          </div>
        </div>
      )}

      {mode === "equal" && <EqualSplit onBack={() => setMode(null)} />}
      {mode === "bill" && <BillSplit onBack={() => setMode(null)} />}
      {mode === "payment" && <PaymentSplit onBack={() => setMode(null)} />}
    </div>
  );
}

function EqualSplit({ onBack }: { onBack: () => void }) {
  const [persons, setPersons] = useState<{ id: number; name: string; amounts: number[] }[]>([]);
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [addAmount, setAddAmount] = useState("");

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

  const totals = useMemo(() => persons.map(p => ({ ...p, total: p.amounts.reduce((a, b) => a + b, 0) })), [persons]);
  const grandTotal = useMemo(() => totals.reduce((s, p) => s + p.total, 0), [totals]);
  const share = persons.length > 0 ? grandTotal / persons.length : 0;
  const settlements = useMemo(() => {
    if (persons.length < 2 || grandTotal === 0) return [];
    const balances = totals.map(p => ({ name: p.name, balance: p.total - share }));
    return settle(balances);
  }, [totals, grandTotal, share, persons.length]);

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
      {totals.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          {totals.map(p => {
            const balance = p.total - share;
            return (
              <div key={p.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{p.name}</div>
                  <button onClick={() => setPersons(persons.filter(x => x.id !== p.id))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>${p.total.toFixed(2)}</div>
                {p.amounts.length > 1 && (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    {p.amounts.map(a => `$${a.toFixed(2)}`).join(" + ")}
                  </div>
                )}
                {persons.length > 1 && grandTotal > 0 && (
                  <div style={{ padding: "0.35rem 0.6rem", background: balance > 0.01 ? "rgba(34,197,94,0.1)" : balance < -0.01 ? "rgba(239,68,68,0.1)" : "var(--bg)", borderRadius: 8, marginBottom: "0.75rem", fontSize: "0.82rem", fontWeight: 600, color: balance > 0.01 ? "#22c55e" : balance < -0.01 ? "#ef4444" : "var(--text-muted)" }}>
                    {balance > 0.01 ? `Gets back $${balance.toFixed(2)}` : balance < -0.01 ? `Owes $${Math.abs(balance).toFixed(2)}` : "Settled"}
                  </div>
                )}
                {p.amounts.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginBottom: "0.75rem" }}>
                    {p.amounts.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0.5rem", background: "var(--bg)", borderRadius: 6, fontSize: "0.8rem" }}>
                        <span>${a.toFixed(2)}</span>
                        <button onClick={() => removeAmount(p.id, i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.65rem" }}>✕</button>
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
                  <button onClick={() => setAddingTo(p.id)} style={{ ...s.btnSmall, width: "100%", borderStyle: "dashed", padding: "0.4rem" }}>+ Add Amount</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {totals.length > 1 && grandTotal > 0 && (
        <div style={s.card}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Summary</h2>
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            <span>Total: <strong style={{ color: "var(--text)" }}>${grandTotal.toFixed(2)}</strong></span>
            <span>Split: <strong style={{ color: "var(--text)" }}>${share.toFixed(2)}</strong> each</span>
          </div>
          {settlements.length === 0 ? (
            <p style={{ color: "#22c55e", fontSize: "0.9rem", fontWeight: 500 }}>All settled up!</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {settlements.map((st, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", background: "var(--bg)", borderRadius: 8, fontSize: "0.9rem" }}>
                  <span style={{ fontWeight: 600, color: "#ef4444" }}>{st.from}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M5 12h14m-7-7l7 7-7 7" /></svg>
                  <span style={{ fontWeight: 600, color: "#22c55e" }}>{st.to}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 700 }}>${st.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {totals.length === 0 && <p style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem" }}>Add people to start splitting.</p>}
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

function PaymentSplit({ onBack }: { onBack: () => void }) {
  const [bankAmount, setBankAmount] = useState("");
  const [persons, setPersons] = useState<{ id: number; name: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [debts, setDebts] = useState<{ fromId: number; toId: number; amount: number }[]>([]);
  const [debtFrom, setDebtFrom] = useState<number | null>(null);
  const [debtTo, setDebtTo] = useState<number | null>(null);
  const [debtAmount, setDebtAmount] = useState("");
  const [showDebtForm, setShowDebtForm] = useState<number | null>(null);

  const total = parseFloat(bankAmount) || 0;
  const share = persons.length > 0 ? total / persons.length : 0;

  const data = useMemo(() => {
    if (persons.length === 0 || total <= 0) return null;

    const owedBy = new Map<number, number>();
    const owedTo = new Map<number, number>();
    persons.forEach(p => { owedBy.set(p.id, 0); owedTo.set(p.id, 0); });

    debts.forEach(d => {
      owedBy.set(d.fromId, (owedBy.get(d.fromId) ?? 0) + d.amount);
      owedTo.set(d.toId, (owedTo.get(d.toId) ?? 0) + d.amount);
    });

    const rows = persons.map(p => {
      const owes = owedBy.get(p.id) ?? 0;
      const owed = owedTo.get(p.id) ?? 0;
      const transfer = share + owes - owed;
      return { id: p.id, name: p.name, share, owes, owed, transfer: Math.round(transfer * 100) / 100 };
    });

    return { share, rows, totalTransfers: rows.reduce((s, r) => s + r.transfer, 0) };
  }, [persons, total, debts, share]);

  function addPerson() {
    const name = newName.trim();
    if (!name || persons.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setPersons([...persons, { id: Date.now(), name }]);
    setNewName("");
  }

  function addDebt() {
    if (!debtFrom || !debtTo || debtFrom === debtTo) return;
    const amt = parseFloat(debtAmount);
    if (!amt || amt <= 0) return;
    setDebts([...debts, { fromId: debtFrom, toId: debtTo, amount: Math.round(amt * 100) / 100 }]);
    setDebtFrom(null);
    setDebtTo(null);
    setDebtAmount("");
    setShowDebtForm(null);
  }

  function removeDebt(idx: number) {
    setDebts(debts.filter((_, i) => i !== idx));
  }

  function getName(id: number) { return persons.find(p => p.id === id)?.name ?? "?"; }

  return (
    <div>
      <button onClick={onBack} style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1rem" }}>&larr; Options</button>

      {/* Bank amount */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <label style={s.label}>
          Bank Amount
          <input style={{ ...s.input, maxWidth: 300, fontSize: "1.1rem", fontWeight: 600 }} type="number" step="0.01" min="0"
            value={bankAmount} onChange={e => setBankAmount(e.target.value)} placeholder="0.00" />
        </label>
        {total > 0 && persons.length > 0 && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Each share: <strong style={{ color: "var(--text)" }}>${share.toFixed(2)}</strong>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          {persons.map(p => {
            const pDebts = debts.filter(d => d.fromId === p.id);
            const pOwed = debts.filter(d => d.toId === p.id);
            const totalOwes = pDebts.reduce((s, d) => s + d.amount, 0);
            const totalOwed = pOwed.reduce((s, d) => s + d.amount, 0);
            const transfer = total > 0 ? Math.round((share + totalOwes - totalOwed) * 100) / 100 : 0;

            return (
              <div key={p.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{p.name}</div>
                  <button onClick={() => { setPersons(persons.filter(x => x.id !== p.id)); setDebts(debts.filter(d => d.fromId !== p.id && d.toId !== p.id)); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                </div>

                {total > 0 && (
                  <div style={{ padding: "0.4rem 0.6rem", background: "var(--bg)", borderRadius: 8, marginBottom: "0.5rem", fontSize: "0.85rem", fontWeight: 700, color: "var(--primary)" }}>
                    Transfer: ${transfer.toFixed(2)}
                  </div>
                )}

                {total > 0 && (
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    Share: ${share.toFixed(2)}
                    {totalOwes > 0 && <> + owes ${totalOwes.toFixed(2)}</>}
                    {totalOwed > 0 && <> − owed ${totalOwed.toFixed(2)}</>}
                  </div>
                )}

                {/* Debts this person owes */}
                {pDebts.length > 0 && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    {pDebts.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0.5rem", background: "rgba(239,68,68,0.08)", borderRadius: 6, fontSize: "0.78rem", marginBottom: "0.2rem" }}>
                        <span style={{ color: "var(--text-muted)" }}>owes</span>
                        <strong style={{ color: "#ef4444" }}>{getName(d.toId)}</strong>
                        <span style={{ marginLeft: "auto", fontWeight: 600 }}>${d.amount.toFixed(2)}</span>
                        <button onClick={() => removeDebt(debts.indexOf(d))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.6rem" }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add debt form */}
                {showDebtForm === p.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.5rem", background: "var(--bg)", borderRadius: 8 }}>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>{p.name} owes…</div>
                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                      <select style={{ ...s.input, width: "auto", minWidth: 100, marginTop: 0 }} value={debtTo ?? ""} onChange={e => setDebtTo(Number(e.target.value) || null)}>
                        <option value="">To…</option>
                        {persons.filter(x => x.id !== p.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <input style={{ ...s.input, maxWidth: 100, marginTop: 0 }} type="number" step="0.01" min="0"
                        value={debtAmount} onChange={e => setDebtAmount(e.target.value)} placeholder="$"
                        onKeyDown={e => { if (e.key === "Enter") addDebt(); }} />
                      <button onClick={addDebt} style={{ ...s.btnPrimary, fontSize: "0.8rem", padding: "0.3rem 0.6rem" }}>✓</button>
                      <button onClick={() => { setShowDebtForm(null); setDebtFrom(null); setDebtTo(null); setDebtAmount(""); }} style={s.btnSmall}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setShowDebtForm(p.id); setDebtFrom(p.id); }} style={{ ...s.btnSmall, width: "100%", borderStyle: "dashed", padding: "0.35rem" }}>+ Add Debt</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {data && (
        <div style={s.card}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Summary</h2>
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.75rem", fontSize: "0.82rem", color: "var(--text-muted)", flexWrap: "wrap" }}>
            <span>Bank: <strong style={{ color: "var(--text)" }}>${total.toFixed(2)}</strong></span>
            <span>Each share: <strong style={{ color: "var(--text)" }}>${data.share.toFixed(2)}</strong></span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {data.rows.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--bg)", borderRadius: 8, fontSize: "0.85rem" }}>
                <span style={{ fontWeight: 600, minWidth: 60 }}>{r.name}</span>
                <span style={{ flex: 1, fontSize: "0.78rem", color: "var(--text-muted)" }}>
                  Share ${r.share.toFixed(2)}
                  {r.owes > 0 && <> + owes ${r.owes.toFixed(2)}</>}
                  {r.owed > 0 && <> − owed ${r.owed.toFixed(2)}</>}
                </span>
                <span style={{ fontWeight: 700, color: "var(--primary)" }}>${r.transfer.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.8rem", background: "var(--bg)", borderRadius: 8, fontSize: "0.85rem", fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>Total transfers</span>
            <span style={{ color: Math.abs(data.totalTransfers - total) < 0.01 ? "#22c55e" : "var(--text)" }}>${data.totalTransfers.toFixed(2)}</span>
          </div>
        </div>
      )}

      {persons.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.9rem" }}>Set the bank amount and add people to start.</p>
        </div>
      )}
    </div>
  );
}
