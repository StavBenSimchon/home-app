import { useState, useMemo } from "react";

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "1.25rem" } as const,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%" } as const,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" as const, gap: "0.2rem" } as const,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "0.5rem 1.25rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as const,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.3rem 0.6rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as const,
};

interface Partner {
  id: number;
  name: string;
  amounts: number[];
}

function calcSettlements(partners: Partner[]): { from: string; to: string; amount: number }[] {
  if (partners.length < 2) return [];
  const total = partners.reduce((sum, p) => sum + p.amounts.reduce((a, b) => a + b, 0), 0);
  const share = total / partners.length;
  const balances = partners.map(p => ({ name: p.name, balance: p.amounts.reduce((a, b) => a + b, 0) - share }));
  const debtors = balances.filter(b => b.balance < -0.01).map(b => ({ ...b, balance: -b.balance })).sort((a, b) => b.balance - a.balance);
  const creditors = balances.filter(b => b.balance > 0.01).sort((a, b) => b.balance - a.balance);
  const settlements: { from: string; to: string; amount: number }[] = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amt = Math.min(debtors[di].balance, creditors[ci].balance);
    if (amt > 0.01) settlements.push({ from: debtors[di].name, to: creditors[ci].name, amount: Math.round(amt * 100) / 100 });
    debtors[di].balance -= amt;
    creditors[ci].balance -= amt;
    if (debtors[di].balance < 0.01) di++;
    if (creditors[ci].balance < 0.01) ci++;
  }
  return settlements;
}

export default function SettleUp() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [addAmount, setAddAmount] = useState("");

  function addPartner() {
    const name = newName.trim();
    if (!name || partners.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setPartners([...partners, { id: Date.now(), name, amounts: [] }]);
    setNewName("");
  }

  function removePartner(id: number) {
    setPartners(partners.filter(p => p.id !== id));
  }

  function addAmountToPartner(id: number) {
    const val = parseFloat(addAmount);
    if (!val || val <= 0) return;
    setPartners(partners.map(p => p.id === id ? { ...p, amounts: [...p.amounts, Math.round(val * 100) / 100] } : p));
    setAddAmount("");
    setAddingTo(null);
  }

  function removeAmount(partnerId: number, amountIdx: number) {
    setPartners(partners.map(p => p.id === partnerId ? { ...p, amounts: p.amounts.filter((_, i) => i !== amountIdx) } : p));
  }

  const total = useMemo(() => partners.reduce((s, p) => s + p.amounts.reduce((a, b) => a + b, 0), 0), [partners]);
  const share = partners.length > 0 ? total / partners.length : 0;
  const settlements = useMemo(() => calcSettlements(partners), [partners]);

  return (
    <div className="responsive-container">
      <h1 style={{ fontSize: "clamp(1.35rem, 5vw, 1.75rem)", fontWeight: 700, marginBottom: "1.5rem" }}>Settle Up</h1>

      {/* Add partner */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <label style={s.label}>
          Add Partner
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input style={s.input} value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Enter name…"
              onKeyDown={e => { if (e.key === "Enter") addPartner(); }} />
            <button onClick={addPartner} style={{ ...s.btnPrimary, whiteSpace: "nowrap" }} disabled={!newName.trim()}>Add</button>
          </div>
        </label>
      </div>

      {/* Partner cards */}
      {partners.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {partners.map(p => {
            const paid = p.amounts.reduce((a, b) => a + b, 0);
            const balance = paid - share;
            return (
              <div key={p.id} style={s.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Paid: ${paid.toFixed(2)} · Share: ${share.toFixed(2)}</div>
                  </div>
                  <button onClick={() => removePartner(p.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
                </div>

                {/* Balance */}
                {partners.length > 1 && (
                  <div style={{ padding: "0.4rem 0.6rem", background: balance > 0.01 ? "rgba(34,197,94,0.1)" : balance < -0.01 ? "rgba(239,68,68,0.1)" : "var(--bg)", borderRadius: 8, marginBottom: "0.75rem", fontSize: "0.85rem", fontWeight: 600, color: balance > 0.01 ? "#22c55e" : balance < -0.01 ? "#ef4444" : "var(--text-muted)" }}>
                    {balance > 0.01 ? `Gets back $${balance.toFixed(2)}` : balance < -0.01 ? `Owes $${Math.abs(balance).toFixed(2)}` : "Settled"}
                  </div>
                )}

                {/* Amounts */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginBottom: "0.75rem" }}>
                  {p.amounts.map((amt, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0.5rem", background: "var(--bg)", borderRadius: 6, fontSize: "0.85rem" }}>
                      <span>${amt.toFixed(2)}</span>
                      <button onClick={() => removeAmount(p.id, i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.7rem" }}>✕</button>
                    </div>
                  ))}
                </div>

                {/* Add amount */}
                {addingTo === p.id ? (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <input style={{ ...s.input, marginTop: 0 }} type="number" step="0.01" value={addAmount}
                      onChange={e => setAddAmount(e.target.value)} placeholder="Amount"
                      onKeyDown={e => { if (e.key === "Enter") addAmountToPartner(p.id); }}
                      autoFocus />
                    <button onClick={() => addAmountToPartner(p.id)} style={{ ...s.btnPrimary, fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>✓</button>
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
      {partners.length > 1 && (
        <div style={s.card}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Summary</h2>
          <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", fontSize: "0.85rem" }}>
            <div><span style={{ color: "var(--text-muted)" }}>Total:</span> <strong>${total.toFixed(2)}</strong></div>
            <div><span style={{ color: "var(--text-muted)" }}>Per person:</span> <strong>${share.toFixed(2)}</strong></div>
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

      {partners.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.95rem" }}>Add partners to start splitting expenses.</p>
        </div>
      )}
    </div>
  );
}
