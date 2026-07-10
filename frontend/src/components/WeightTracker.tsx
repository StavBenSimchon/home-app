import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type WeightEntry } from "../api";

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem" } as const,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%" } as const,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" as const, gap: "0.2rem" } as const,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as const,
  btnSecondary: { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" } as const,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as const,
};

const COLORS = { fat: "#ef4444", muscle: "#22c55e" };

export default function WeightTracker() {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ weight_kg: "", fat_percentage: "", muscle_percentage: "", measured_at: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ weight_kg: "", fat_percentage: "", muscle_percentage: "", measured_at: "" });
  const [hovered, setHovered] = useState<{ lineKey: string; index: number; x: number; y: number } | null>(null);

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

  function startEdit(e: WeightEntry) {
    setEditingId(e.id);
    setEditForm({
      weight_kg: String(e.weight_kg),
      fat_percentage: e.fat_percentage != null ? String(e.fat_percentage) : "",
      muscle_percentage: e.muscle_percentage != null ? String(e.muscle_percentage) : "",
      measured_at: e.measured_at,
    });
  }

  async function saveEdit(id: string) {
    const w = parseFloat(editForm.weight_kg);
    if (!w || w <= 0) return;
    await api.updateWeight(id, {
      weight_kg: w,
      fat_percentage: editForm.fat_percentage ? parseFloat(editForm.fat_percentage) : undefined,
      muscle_percentage: editForm.muscle_percentage ? parseFloat(editForm.muscle_percentage) : undefined,
      measured_at: editForm.measured_at,
    });
    setEditingId(null);
    await load();
  }

  const sorted = useMemo(() => [...entries].sort((a, b) => a.measured_at.localeCompare(b.measured_at)), [entries]);

  const graphData = useMemo(() => {
    if (sorted.length === 0) return null;
    const fatKg = sorted.map(e => e.fat_percentage != null ? e.weight_kg * e.fat_percentage / 100 : null);
    const muscleKg = sorted.map(e => e.muscle_percentage != null ? e.weight_kg * e.muscle_percentage / 100 : null);
    const vals = [...fatKg, ...muscleKg].filter((v): v is number => v != null);
    const W = 600, H = 200, pad = { top: 10, right: 10, bottom: 25, left: 45 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;

    if (vals.length === 0) return { W, H, pad, iw, yScale: (v: number) => v, xScale: (i: number) => pad.left + (sorted.length === 1 ? iw / 2 : (i / Math.max(sorted.length - 1, 1)) * iw), lines: [], ticks: [], labels: sorted.map(e => e.measured_at.slice(5)) };

    const minVal = Math.min(...vals) * 0.9;
    const maxVal = Math.max(...vals) * 1.1 || 1;
    const range = maxVal - minVal || 1;
    const yScale = (v: number) => pad.top + ih - ((v - minVal) / range) * ih;
    const xScale = (i: number) => pad.left + (sorted.length === 1 ? iw / 2 : (i / (sorted.length - 1)) * iw);

    const lines: { key: string; color: string; data: { x: number; y: number }[]; label: string }[] = [];
    if (fatKg.some(v => v != null)) {
      lines.push({
        key: "fat", color: COLORS.fat,
        data: fatKg.map((v, i) => v != null ? { x: xScale(i), y: yScale(v) } : null).filter((p): p is { x: number; y: number } => p != null),
        label: "Fat",
      });
    }
    if (muscleKg.some(v => v != null)) {
      lines.push({
        key: "muscle", color: COLORS.muscle,
        data: muscleKg.map((v, i) => v != null ? { x: xScale(i), y: yScale(v) } : null).filter((p): p is { x: number; y: number } => p != null),
        label: "Muscle",
      });
    }

    const ticks: number[] = [];
    const step = range / 4 || 1;
    for (let v = Math.ceil(minVal / step) * step; v <= maxVal; v += step) ticks.push(v);

    return { W, H, pad, yScale, xScale, iw, lines, ticks, labels: sorted.map(e => e.measured_at.slice(5)) };
  }, [sorted]);

  return (
    <div>
      {/* Graph */}
      <div style={{ ...s.card, marginBottom: "1rem", overflowX: "auto" }}>
        {graphData && graphData.lines.length > 0 ? (
          <svg viewBox={`0 0 ${graphData.W} ${graphData.H}`} style={{ width: "100%", minWidth: 300, height: "auto", display: "block" }}>
            {graphData.ticks.map(t => (
              <g key={t}>
                <text x={graphData.pad.left - 5} y={graphData.yScale(t) + 4} textAnchor="end" fill="var(--text-muted)" fontSize="11">{t.toFixed(1)}</text>
                <line x1={graphData.pad.left} y1={graphData.yScale(t)} x2={graphData.pad.left + graphData.iw} y2={graphData.yScale(t)} stroke="var(--border)" strokeWidth="1" />
              </g>
            ))}
            {graphData.lines.map(line => (
              <path key={line.key} d={line.data.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" />
            ))}
            {graphData.lines.map(line => line.data.map((p, i) => (
              <g key={`${line.key}-${i}`}>
                <circle cx={p.x} cy={p.y} r="10" fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHovered({ lineKey: line.key, index: i, x: p.x, y: p.y })}
                  onMouseLeave={() => setHovered(null)} />
                <circle cx={p.x} cy={p.y} r="3" fill={line.color} pointerEvents="none" />
              </g>
            )))}
            {hovered && (() => {
              const entry = sorted[hovered.index];
              const line = graphData.lines.find(l => l.key === hovered.lineKey)!;
              const val = hovered.lineKey === "fat"
                ? (entry.fat_percentage != null ? ((entry.weight_kg * entry.fat_percentage) / 100).toFixed(1) : null)
                : (entry.muscle_percentage != null ? ((entry.weight_kg * entry.muscle_percentage) / 100).toFixed(1) : null);
              const pct = hovered.lineKey === "fat" ? entry.fat_percentage : entry.muscle_percentage;
              const tx = Math.min(hovered.x + 8, graphData.W - 90);
              const ty = Math.max(hovered.y - 35, 5);
              return (
                <g pointerEvents="none">
                  <rect x={tx - 4} y={ty - 2} width="86" height="38" rx="6" fill="var(--surface)" stroke="var(--border)" strokeWidth="1" />
                  <text x={tx} y={ty + 12} fontSize="10" fill={line.color} fontWeight="600">{line.label}: {val}kg</text>
                  <text x={tx} y={ty + 26} fontSize="9" fill="var(--text-muted)">{entry.measured_at} · {pct}%</text>
                </g>
              );
            })()}
            {graphData.labels.map((l, i) => (
              <text key={i} x={graphData.xScale(i)} y={graphData.H - 5} textAnchor={i === 0 ? "start" : i === graphData.labels.length - 1 ? "end" : "middle"} fill="var(--text-muted)" fontSize="10">{l}</text>
            ))}
          </svg>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "2rem", margin: 0 }}>No data yet — add an entry below.</p>
        )}
        {graphData && graphData.lines.length > 0 && (
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", marginTop: "0.5rem", fontSize: "0.8rem" }}>
            {graphData.lines.map(line => (
              <span key={line.key} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 10, height: 3, background: line.color, display: "inline-block", borderRadius: 2 }} />
                {line.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Add entry */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <label style={s.label}>Weight (kg) *<input style={s.input} type="number" step="0.1" value={form.weight_kg} onChange={e => setForm({ ...form, weight_kg: e.target.value })} /></label>
          <label style={s.label}>Fat %<input style={s.input} type="number" step="0.1" value={form.fat_percentage} onChange={e => setForm({ ...form, fat_percentage: e.target.value })} /></label>
          <label style={s.label}>Muscle %<input style={s.input} type="number" step="0.1" value={form.muscle_percentage} onChange={e => setForm({ ...form, muscle_percentage: e.target.value })} /></label>
          <label style={s.label}>Date<input style={s.input} type="date" value={form.measured_at} onChange={e => setForm({ ...form, measured_at: e.target.value })} /></label>
        </div>
        <button onClick={handleSubmit} style={s.btnPrimary} disabled={!form.weight_kg}>Add Entry</button>
      </div>

      {/* Entries */}
      {sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {[...sorted].reverse().map(e => {
            const isEditing = editingId === e.id;
            return (
              <div key={e.id} style={{ ...s.card, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {isEditing ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "0.5rem" }}>
                      <label style={s.label}>Weight<input style={s.input} type="number" step="0.1" value={editForm.weight_kg} onChange={e => setEditForm({ ...editForm, weight_kg: e.target.value })} /></label>
                      <label style={s.label}>Fat %<input style={s.input} type="number" step="0.1" value={editForm.fat_percentage} onChange={e => setEditForm({ ...editForm, fat_percentage: e.target.value })} /></label>
                      <label style={s.label}>Muscle %<input style={s.input} type="number" step="0.1" value={editForm.muscle_percentage} onChange={e => setEditForm({ ...editForm, muscle_percentage: e.target.value })} /></label>
                      <label style={s.label}>Date<input style={s.input} type="date" value={editForm.measured_at} onChange={e => setEditForm({ ...editForm, measured_at: e.target.value })} /></label>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button onClick={() => saveEdit(e.id)} style={s.btnPrimary}>Save</button>
                      <button onClick={() => setEditingId(null)} style={s.btnSmall}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{e.weight_kg} kg</div>
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", gap: "0.75rem" }}>
                        <span>{e.measured_at}</span>
                        {e.fat_percentage != null && <span>Fat: {((e.weight_kg * e.fat_percentage) / 100).toFixed(1)}kg ({e.fat_percentage}%)</span>}
                        {e.muscle_percentage != null && <span>Muscle: {((e.weight_kg * e.muscle_percentage) / 100).toFixed(1)}kg ({e.muscle_percentage}%)</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                      <button onClick={() => startEdit(e)} style={s.btnSmall}>Edit</button>
                      <button onClick={() => handleDelete(e.id)} style={{ ...s.btnSmall, color: "#ef4444" }}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "2rem" }}>Loading...</p>}
    </div>
  );
}