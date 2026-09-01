import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Goal, type ProgressData, type WeightEntry } from "../../api";
import { s, SPINNER } from "./shared";

interface Props { goal: Goal | null }

type RangeKey = "1m" | "3m" | "6m" | "1y" | "all";
const RANGES: { key: RangeKey; label: string; days?: number }[] = [
  { key: "1m", label: "1M", days: 30 },
  { key: "3m", label: "3M", days: 90 },
  { key: "6m", label: "6M", days: 180 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All" },
];

const LINES = [
  { key: "weight", label: "Weight", color: "#6366f1" },
  { key: "fat", label: "Fat kg", color: "#ef4444" },
  { key: "muscle", label: "Muscle kg", color: "#22c55e" },
] as const;

type LineKey = (typeof LINES)[number]["key"];
type LineSelection = "all" | LineKey;

export default function Progress({ goal }: Props) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [range, setRange] = useState<RangeKey>("3m");
  const [selectedLine, setSelectedLine] = useState<LineSelection>("all");
  const [hover, setHover] = useState<{ line: LineKey; idx: number; x: number; y: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setWeights(await api.listWeight());
      if (goal) {
        setProgress(await api.getProgress(goal.id));
      }
    } catch { /* ignore */ }
  }, [goal]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(
    () => [...weights].sort((a, b) => a.measured_at.localeCompare(b.measured_at)),
    [weights]
  );

  const graphPoints = useMemo(() => {
    if (!sorted.length) return null;
    const cutoff = RANGES.find(r => r.key === range)?.days;
    const startIso = cutoff ? new Date(Date.now() - cutoff * 86400000).toISOString().slice(0, 10) : sorted[0].measured_at;
    const filtered = sorted.filter(e => e.measured_at >= startIso);
    const visibleLines = selectedLine === "all" ? LINES : LINES.filter(line => line.key === selectedLine);
    const series = visibleLines.map(l => ({
      ...l,
      points: filtered.map((e, i) => {
        const val = valueOf(e, l.key as LineKey);
        return { i, x: null as number | null, y: null as number | null, val, entry: e };
      }).filter(p => p.val != null),
    }));

    const allVals = series.flatMap(s => s.points.map(p => p.val!));
    if (!allVals.length) return null;
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const span = max - min || 1;
    const W = 600, H = 200, pad = { top: 12, right: 12, bottom: 24, left: 46 };
    const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
    const x = (i: number) => pad.left + (filtered.length === 1 ? iw / 2 : (i / (filtered.length - 1)) * iw);
    const y = (v: number) => pad.top + ih - ((v - min) / span) * ih;

    series.forEach(s => s.points.forEach(p => { p.x = x(p.i); p.y = y(p.val!); }));
    return { W, H, pad, iw, ih, min, span, series, entries: filtered };
  }, [sorted, range, selectedLine]);

  function valueOf(e: WeightEntry, key: LineKey): number | null {
    if (key === "weight") return e.weight_kg;
    if (key === "fat") return e.fat_percentage != null ? (e.weight_kg * e.fat_percentage) / 100 : null;
    if (key === "muscle") return e.muscle_percentage != null ? (e.weight_kg * e.muscle_percentage) / 100 : null;
    return null;
  }

  if (!goal) return <p style={{ color: "var(--text-muted)" }}>No goal yet.</p>;

  const consistency = progress?.consistency;
  const trends = progress?.trends ?? [];

  return (
    <div>
      {/* Consistency */}
      {consistency && consistency.planned > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem", marginBottom: "1rem" }}>
          {[
            { label: "Workouts", value: `${consistency.completed}/${consistency.planned}` },
            { label: "Rate", value: `${consistency.completion_rate.toFixed(0)}%` },
            { label: "Streak", value: `${consistency.current_streak}d` },
          ].map(st => (
            <div key={st.label} style={{ ...s.card, padding: "0.7rem", textAlign: "center" }}>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{st.label}</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>{st.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Body metrics graph */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Body metrics</span>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                style={{ ...s.btnSmall, background: range === r.key ? "var(--primary)" : "var(--bg)", color: range === r.key ? "#fff" : "var(--text)", fontSize: "0.68rem", padding: "0.2rem 0.45rem" }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {!graphPoints || graphPoints.series.every(s => !s.points.length) ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "1.5rem", margin: 0 }}>No measurements yet.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${graphPoints.W} ${graphPoints.H}`} style={{ width: "100%", height: "auto" }}>
              {[0, 0.25, 0.5, 0.75, 1].map(t => {
                const yv = graphPoints.pad.top + graphPoints.ih - t * graphPoints.ih;
                const val = graphPoints.min + graphPoints.span * t;
                return (
                  <g key={t}>
                    <line x1={graphPoints.pad.left} y1={yv} x2={graphPoints.W - graphPoints.pad.right} y2={yv} stroke="var(--border)" strokeWidth="1" />
                    <text x={graphPoints.pad.left - 6} y={yv + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{val.toFixed(1)}</text>
                  </g>
                );
              })}
              {graphPoints.series.map(s => (
                <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2.5"
                  points={s.points.map(p => `${p.x},${p.y}`).join(" ")} />
              ))}
              {graphPoints.series.map(s => s.points.map(p => (
                <g key={`${s.key}-${p.i}`}>
                  <circle cx={p.x!} cy={p.y!} r="12" fill="transparent"
                    onMouseEnter={() => setHover({ line: s.key, idx: p.i, x: p.x!, y: p.y! })}
                    onMouseLeave={() => setHover(null)} />
                  <circle cx={p.x!} cy={p.y!} r="4" fill={s.color} pointerEvents="none" />
                </g>
              )))}
              {hover && (() => {
                const s = graphPoints.series.find(l => l.key === hover.line)!;
                const p = s.points.find(pp => pp.i === hover.idx)!;
                const e = graphPoints.entries[hover.idx];
                const val = p.val!;
                const label = s.label;
                const tx = Math.min(hover.x + 10, graphPoints.W - 105);
                const ty = Math.max(hover.y - 42, 8);
                const extra = hover.line === "fat" && e.fat_percentage != null ? ` (${e.fat_percentage}%)` :
                  hover.line === "muscle" && e.muscle_percentage != null ? ` (${e.muscle_percentage}%)` : "";
                return (
                  <g pointerEvents="none">
                    <rect x={tx} y={ty} width="100" height="30" rx="6" fill="var(--surface)" stroke="var(--border)" />
                    <text x={tx + 6} y={ty + 13} fontSize="11" fill={s.color} fontWeight="700">{label}: {val.toFixed(1)}kg{extra}</text>
                    <text x={tx + 6} y={ty + 25} fontSize="9" fill="var(--text-muted)">{e.measured_at}</text>
                  </g>
                );
              })()}
              {graphPoints.entries.map((e, i) => (
                <text key={i} x={i === 0 ? graphPoints.pad.left : i === graphPoints.entries.length - 1 ? graphPoints.W - graphPoints.pad.right : (graphPoints.pad.left + (i / (Math.max(graphPoints.entries.length - 1, 1)) * graphPoints.iw))}
                  y={graphPoints.H - 6}
                  textAnchor={i === 0 ? "start" : i === graphPoints.entries.length - 1 ? "end" : "middle"}
                  fill="var(--text-muted)" fontSize="9">{e.measured_at.slice(5)}</text>
              ))}
            </svg>
            <div style={{ display: "flex", gap: "0.35rem", fontSize: "0.75rem", marginTop: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
              {LINES.map(line => {
                const active = selectedLine === line.key;
                return (
                  <button
                    key={line.key}
                    aria-pressed={active}
                    onClick={() => setSelectedLine(current => current === line.key ? "all" : line.key)}
                    style={{
                      ...s.btnSmall,
                      display: "flex", alignItems: "center", gap: "0.3rem",
                      background: active ? "var(--surface-hover)" : "var(--bg)",
                      color: active ? "var(--text)" : "var(--text-muted)",
                      borderColor: active ? line.color : "var(--border)",
                    }}>
                    <span style={{ width: 10, height: 3, background: line.color, display: "inline-block", borderRadius: 2 }} />
                    {line.label}
                  </button>
                );
              })}
            </div>
            {selectedLine !== "all" && (
              <div style={{ textAlign: "center", fontSize: "0.66rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                Tap {LINES.find(line => line.key === selectedLine)?.label} again to show all metrics
              </div>
            )}
          </>
        )}
      </div>

      {/* Strength */}
      {trends.length > 0 && (
        <div style={{ ...s.card, marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.6rem" }}>Strength</div>
          {trends.map(t => {
            const pts = t.points.filter(p => p.top_weight != null);
            if (!pts.length) return null;
            const first = pts[0], last = pts[pts.length - 1];
            const change = (last.top_weight ?? 0) - (first.top_weight ?? 0);
            return (
              <div key={t.exercise_name} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.82rem" }}>{t.exercise_name}</span>
                <span style={{ fontSize: "0.78rem", color: change > 0 ? "#22c55e" : change < 0 ? "#ef4444" : "var(--text-muted)" }}>
                  {first.top_weight} → {last.top_weight} kg
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Logger */}
      <MeasurementLogger weights={weights} onChanged={load} />
    </div>
  );
}

function MeasurementLogger({ weights, onChanged }: { weights: WeightEntry[]; onChanged: () => void }) {
  const [form, setForm] = useState({ weight: "", fat: "", muscle: "", date: new Date().toISOString().slice(0, 10) });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sorted = useMemo(
    () => [...weights].sort((a, b) => b.measured_at.localeCompare(a.measured_at)),
    [weights]
  );

  async function save() {
    const w = parseFloat(form.weight);
    if (!w) return;
    setSaving(true);
    const payload = {
      weight_kg: w,
      fat_percentage: form.fat ? parseFloat(form.fat) : undefined,
      muscle_percentage: form.muscle ? parseFloat(form.muscle) : undefined,
      measured_at: form.date,
    };
    try {
      if (editingId) await api.updateWeight(editingId, payload);
      else await api.createWeight(payload);
      setForm({ weight: "", fat: "", muscle: "", date: new Date().toISOString().slice(0, 10) });
      setEditingId(null);
      onChanged();
    } catch { /* ignore */ }
    setSaving(false);
  }

  function startEdit(e: WeightEntry) {
    setEditingId(e.id);
    setForm({
      weight: String(e.weight_kg),
      fat: e.fat_percentage != null ? String(e.fat_percentage) : "",
      muscle: e.muscle_percentage != null ? String(e.muscle_percentage) : "",
      date: e.measured_at,
    });
  }

  async function remove(id: string) {
    await api.deleteWeight(id).catch(() => {});
    onChanged();
  }

  return (
    <div>
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.6rem", marginBottom: "0.75rem" }}>
          <label style={s.label}>Weight (kg) *<input style={s.input} type="number" step="0.1" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} /></label>
          <label style={s.label}>Fat %<input style={s.input} type="number" step="0.1" value={form.fat} onChange={e => setForm({ ...form, fat: e.target.value })} /></label>
          <label style={s.label}>Muscle %<input style={s.input} type="number" step="0.1" value={form.muscle} onChange={e => setForm({ ...form, muscle: e.target.value })} /></label>
          <label style={s.label}>Date<input style={s.input} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button onClick={save} disabled={!form.weight || saving} style={{ ...s.btnPrimary, opacity: !form.weight || saving ? 0.6 : 1 }}>
            {saving ? SPINNER : editingId ? "Update" : "Log"}
          </button>
          {editingId && <button onClick={() => { setEditingId(null); setForm({ weight: "", fat: "", muscle: "", date: new Date().toISOString().slice(0, 10) }); }} style={s.btnSmall}>Cancel</button>}
        </div>
      </div>

      {sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {sorted.map(e => (
            <div key={e.id} style={{ ...s.card, padding: "0.6rem 0.9rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{e.weight_kg} kg</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", gap: "0.75rem" }}>
                  <span>{e.measured_at}</span>
                  {e.fat_percentage != null && <span>Fat {(e.weight_kg * e.fat_percentage / 100).toFixed(1)}kg ({e.fat_percentage}%)</span>}
                  {e.muscle_percentage != null && <span>Muscle {(e.weight_kg * e.muscle_percentage / 100).toFixed(1)}kg ({e.muscle_percentage}%)</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                <button onClick={() => startEdit(e)} style={s.btnSmall}>Edit</button>
                <button onClick={() => remove(e.id)} style={{ ...s.btnSmall, color: "#ef4444" }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
