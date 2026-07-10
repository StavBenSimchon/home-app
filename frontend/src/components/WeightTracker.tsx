import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type WeightEntry } from "../api";

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem" },
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%" },
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: "0.2rem" },
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" },
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" },
};

const COLORS = { weight: "#6366f1", fat: "#ef4444", muscle: "#22c55e" };

export default function WeightTracker() {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ weight_kg: "", fat_percentage: "", muscle_percentage: "", measured_at: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await api.listWeight()); } catch { setEntries([]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit() {
    const w = parseFloat(form.weight_kg);
    if (!w || w <= 0) return;
    await api.createWeight({
      weight_kg: w,
      fat_percentage: form.fat_percentage ? parseFloat(form.fat_percentage) : undefined,
      muscle_percentage: form.muscle_percentage ? parseFloat(form.muscle_percentage) : undefined,
      measured_at: form.measured_at || undefined,
    });
    setForm({ weight_kg: "", fat_percentage: "", muscle_percentage: "", measured_at: "" });
    await load();
  }

  async function handleDelete(id: string) {
    await api.deleteWeight(id);
    await load();
  }

  const graphData = useMemo(() => {
    if (entries.length < 2) return null;
    const w = entries.map(e => e.weight_kg);
    const minVal = Math.min(...w) * 0.95;
    const maxVal = Math.max(...w) * 1.05;
    const range = maxVal - minVal || 1;
    const W = 600, H = 200, pad = { top: 10, right: 10, bottom: 25, left: 45 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    const yScale = (v: number) => pad.top + ih - ((v - minVal) / range) * ih;
    const xScale = (i: number) => pad.left + (i / (entries.length - 1)) * iw;

    const lines = [
      { key: "weight", color: COLORS.weight, data: entries.map((e, i) => ({ x: xScale(i), y: yScale(e.weight_kg) })), label: "Weight" },
    ];
    if (entries.some(e => e.fat_percentage != null)) {
      lines.push({
        key: "fat", color: COLORS.fat,
        data: entries.map((e, i) => ({ x: xScale(i), y: yScale(e.fat_percentage != null ? e.weight_kg * e.fat_percentage / 100 : 0) })),
        label: "Fat",
      });
    }
    if (entries.some(e => e.muscle_percentage != null)) {
      lines.push({
        key: "muscle", color: COLORS.muscle,
        data: entries.map((e, i) => ({ x: xScale(i), y: yScale(e.muscle_percentage != null ? e.weight_kg * e.muscle_percentage / 100 : 0) })),
        label: "Muscle",
      });
    }

    const ticks: number[] = [];
    const step = range / 4;
    for (let v = Math.ceil(minVal / step) * step; v <= maxVal; v += step) ticks.push(v);

    const labels = entries.map(e => e.measured_at.slice(5));

    return { W, H, pad, yScale, xScale, lines, ticks, labels, entries };
  }, [entries]);

  return (
    <div>
      {/* Form */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label style={s.label}>
            Weight (kg) *
            <input style={s.input} type="number" step="0.1" value={form.weight_kg} onChange={e => setForm({ ...form, weight_kg: e.target.value })} />
          </label>
          <label style={s.label}>
            Fat %
            <input style={s.input} type="number" step="0.1" value={form.fat_percentage} onChange={e => setForm({ ...form, fat_percentage: e.target.value })} />
          </label>
          <label style={s.label}>
            Muscle %
            <input style={s.input} type="number" step="0.1" value={form.muscle_percentage} onChange={e => setForm({ ...form, muscle_percentage: e.target.value })} />
          </label>
          <label style={s.label}>
            Date
            <input style={s.input} type="date" value={form.measured_at} onChange={e => setForm({ ...form, measured_at: e.target.value })} />
          </label>
        </div>
        <button onClick={handleSubmit} style={s.btnPrimary} disabled={!form.weight_kg}>Add Entry</button>
      </div>

      {/* Graph */}
      {graphData && (
        <div style={{ ...s.card, marginBottom: "1rem", overflowX: "auto" }}>
          <svg viewBox={`0 0 ${graphData.W} ${graphData.H}`} style={{ width: "100%", minWidth: 300, height: "auto", display: "block" }}>
            {/* Y-axis ticks */}
            {graphData.ticks.map(t => (
              <g key={t}>
                <text x={graphData.pad.left - 5} y={graphData.yScale(t) + 4}
                  textAnchor="end" fill="var(--text-muted)" fontSize="11">{t.toFixed(1)}</text>
                <line x1={graphData.pad.left} y1={graphData.yScale(t)}
                  x2={graphData.pad.left + graphData.iw} y2={graphData.yScale(t)}
                  stroke="var(--border)" strokeWidth="1" />
              </g>
            ))}
            {/* Lines */}
            {graphData.lines.map(line => (
              <path key={line.key} d={line.data.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" />
            ))}
            {/* Dots */}
            {graphData.lines[0].data.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill={COLORS.weight} />
            ))}
            {/* X-axis labels */}
            {graphData.labels.map((l, i) => (
              <text key={i} x={graphData.xScale(i)} y={graphData.H - 5}
                textAnchor={i === 0 ? "start" : i === graphData.labels.length - 1 ? "end" : "middle"} fill="var(--text-muted)" fontSize="10">{l}</text>
            ))}
          </svg>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "0.5rem", fontSize: "0.8rem" }}>
            {graphData.lines.map(line => (
              <span key={line.key} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 10, height: 3, background: line.color, display: "inline-block", borderRadius: 2 }} />
                {line.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {entries.length < 2 && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "2rem" }}>Add at least 2 entries to see the graph.</p>}

      {/* Entry list */}
      {entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {[...entries].reverse().map(e => (
            <div key={e.id} style={{ ...s.card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
              <div>
                <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{e.weight_kg} kg</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", gap: "0.75rem" }}>
                  <span>{e.measured_at}</span>
                  {e.fat_percentage != null && <span>Fat: {((e.weight_kg * e.fat_percentage) / 100).toFixed(1)}kg</span>}
                  {e.muscle_percentage != null && <span>Muscle: {((e.weight_kg * e.muscle_percentage) / 100).toFixed(1)}kg</span>}
                </div>
              </div>
              <button onClick={() => handleDelete(e.id)} style={{ ...s.btnSmall, color: "#ef4444", flexShrink: 0 }}>Delete</button>
            </div>
          ))}
        </div>
      )}

      {loading && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem" }}>Loading...</p>}
    </div>
  );
}
