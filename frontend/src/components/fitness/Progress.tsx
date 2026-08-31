import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Goal, type ProgressData, type WeightEntry, type WeeklyReview } from "../../api";
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

export default function Progress({ goal }: Props) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [range, setRange] = useState<RangeKey>("3m");
  const [metric, setMetric] = useState<"weight" | "fat" | "muscle">("weight");

  const load = useCallback(async () => {
    try {
      setWeights(await api.listWeight());
      if (goal) {
        setProgress(await api.getProgress(goal.id));
        setReview(await api.weeklyReview(goal.id));
      }
    } catch { /* ignore */ }
  }, [goal]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const days = RANGES.find(r => r.key === range)?.days;
    if (!days) return [...weights].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return weights.filter(w => w.measured_at >= cutoff).sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  }, [weights, range]);

  const value = useCallback((e: WeightEntry, key: "weight" | "fat" | "muscle") =>
    key === "weight" ? e.weight_kg
      : key === "fat" ? e.fat_percentage : e.muscle_percentage,
  []);
  const chartValues = filtered.map(e => value(e, metric)).filter((v): v is number => v != null);

  const stats = useMemo(() => {
    if (chartValues.length < 2) return null;
    const first = chartValues[0];
    const last = chartValues[chartValues.length - 1];
    return { min: Math.min(...chartValues), max: Math.max(...chartValues), change: last - first };
  }, [chartValues]);

  if (!goal) return <p style={{ color: "var(--text-muted)" }}>No goal yet.</p>;

  const consistency = progress?.consistency;
  const trends = progress?.trends ?? [];
  const unit = metric === "weight" ? "kg" : "%";

  return (
    <div>
      {/* Consistency */}
      {consistency && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.6rem", marginBottom: "1rem" }}>
          {[
            { label: "Workouts completed", value: String(consistency.completed) + `/${consistency.planned}` },
            { label: "Completion rate", value: `${consistency.completion_rate.toFixed(0)}%` },
            { label: "Current streak", value: `${consistency.current_streak}d` },
          ].map(st => (
            <div key={st.label} style={{ ...s.card, padding: "0.75rem" }}>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{st.label}</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{st.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Body metric graph */}
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.4rem" }}>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            {(["weight", "fat", "muscle"] as const).map(m => (
              <button key={m} onClick={() => setMetric(m)}
                style={{ ...s.btnSmall, background: metric === m ? "var(--primary)" : "var(--bg)", color: metric === m ? "#fff" : "var(--text)" }}>
                {m === "weight" ? "Weight" : m === "fat" ? "Fat %" : "Muscle %"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                style={{ ...s.btnSmall, background: range === r.key ? "var(--primary)" : "var(--bg)", color: range === r.key ? "#fff" : "var(--text)", fontSize: "0.68rem", padding: "0.2rem 0.45rem" }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {chartValues.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "2rem" }}>No measurements yet — log one below.</p>
        ) : (
          <>
            <MiniChart values={chartValues} unit={unit} />
            {stats && (
              <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem", flexWrap: "wrap" }}>
                <span>Min: {stats.min.toFixed(1)}{unit}</span>
                <span>Max: {stats.max.toFixed(1)}{unit}</span>
                <span>Change: {stats.change >= 0 ? "+" : ""}{stats.change.toFixed(1)}{unit}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Strength trends */}
      {trends.length > 0 && (
        <div style={{ ...s.card, marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.6rem" }}>Strength progression</div>
          {trends.map(t => {
            const pts = t.points.filter(p => p.top_weight != null);
            if (pts.length === 0) return null;
            const first = pts[0], last = pts[pts.length - 1];
            const change = (last.top_weight ?? 0) - (first.top_weight ?? 0);
            return (
              <div key={t.exercise_name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.45rem 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.85rem" }}>{t.exercise_name}</span>
                <span style={{ fontSize: "0.8rem", color: change > 0 ? "#22c55e" : change < 0 ? "#ef4444" : "var(--text-muted)" }}>
                  {first.top_weight} → {last.top_weight} kg {change > 0 ? "▲" : change < 0 ? "▼" : "–"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Weekly review */}
      {review && (
        <div style={{ ...s.card, marginBottom: "1rem", borderLeft: "3px solid var(--primary)" }}>
          <div style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.4rem" }}>📊 Weekly review</div>
          <p style={{ fontSize: "0.84rem", color: "var(--text)", lineHeight: 1.6, marginBottom: "0.5rem" }}>{review.summary}</p>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.5 }}>💡 {review.recommendation}</p>
        </div>
      )}

      {/* Weight entry form */}
      <WeightLogger onLogged={load} />
    </div>
  );
}

function MiniChart({ values, unit }: { values: number[]; unit: string }) {
  const W = 600, H = 160, pad = { top: 12, right: 8, bottom: 22, left: 46 };
  const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
  const min = Math.min(...values), max = Math.max(...values);
  const span = (max - min) || 1;
  const y = (v: number) => pad.top + ih - ((v - min) / span) * ih;
  const x = (i: number) => pad.left + (values.length === 1 ? iw / 2 : (i / (values.length - 1)) * iw);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map(t => pad.top + ih - t * ih);
  const ticks = gridYs.map(yv => min + (max - min) * (1 - (yv - pad.top) / ih));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {gridYs.map((yv, i) => (
        <g key={i}>
          <line x1={pad.left} y1={yv} x2={W - pad.right} y2={yv} stroke="var(--border)" strokeWidth="1" />
          <text x={pad.left - 6} y={yv + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{ticks[i].toFixed(1)}</text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="var(--primary)" />)}
      <text x={pad.left} y={H - 4} fill="var(--text-muted)" fontSize="10">{values.length} measurements · {unit}</text>
    </svg>
  );
}

function WeightLogger({ onLogged }: { onLogged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ weight: "", fat: "", muscle: "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    const w = parseFloat(form.weight);
    if (!w) return;
    setSaving(true);
    await api.createWeight({
      weight_kg: w,
      fat_percentage: form.fat ? parseFloat(form.fat) : undefined,
      muscle_percentage: form.muscle ? parseFloat(form.muscle) : undefined,
    }).catch(() => {});
    setForm({ weight: "", fat: "", muscle: "" });
    setOpen(false);
    setSaving(false);
    onLogged();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...s.btnSecondary, width: "100%", padding: "0.7rem", fontSize: "0.9rem" }}>
        + Log body measurement
      </button>
    );
  }
  return (
    <div style={{ ...s.card }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "0.6rem", marginBottom: "0.75rem" }}>
        <label style={s.label}>Weight (kg) *<input style={s.input} type="number" step="0.1" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} /></label>
        <label style={s.label}>Fat %<input style={s.input} type="number" step="0.1" value={form.fat} onChange={e => setForm({ ...form, fat: e.target.value })} /></label>
        <label style={s.label}>Muscle %<input style={s.input} type="number" step="0.1" value={form.muscle} onChange={e => setForm({ ...form, muscle: e.target.value })} /></label>
      </div>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button onClick={save} disabled={!form.weight || saving} style={{ ...s.btnPrimary, opacity: !form.weight || saving ? 0.6 : 1 }}>{saving ? SPINNER : "Save"}</button>
        <button onClick={() => setOpen(false)} style={s.btnSmall}>Cancel</button>
      </div>
    </div>
  );
}
