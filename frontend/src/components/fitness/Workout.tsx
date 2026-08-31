import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ExerciseLogItem, type Goal } from "../../api";
import { SPINNER, s } from "./shared";

interface Props {
  goal: Goal | null;
}

export default function Workout({ goal }: Props) {
  const [log, setLog] = useState<ExerciseLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!goal) { setLoading(false); return; }
    setLoading(true);
    try { setLog(await api.getExerciseLog(goal.id)); } catch { setLog([]); }
    setLoading(false);
  }, [goal]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? log.filter(i => i.exercise_name.toLowerCase().includes(q)) : log;
  }, [log, query]);

  const byDate = useMemo(() => {
    const groups: Record<string, ExerciseLogItem[]> = {};
    for (const item of filtered) (groups[item.performed_at] ??= []).push(item);
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const totals = useMemo(() => ({
    exercises: log.length,
    sets: log.reduce((n, i) => n + i.sets.length, 0),
    failures: log.reduce((n, i) => n + i.failure_sets.length, 0),
  }), [log]);

  if (!goal) return <p style={{ color: "var(--text-muted)" }}>Create a plan first.</p>;

  return (
    <div>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.55, marginBottom: "0.85rem" }}>
        Your training log — every exercise you finished from the calendar, with weight, reps and RIR.
      </p>

      {log.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", marginBottom: "0.85rem" }}>
          {[
            { label: "Exercises", value: totals.exercises },
            { label: "Sets", value: totals.sets },
            { label: "To failure", value: totals.failures },
          ].map(t => (
            <div key={t.label} style={{ ...s.card, padding: "0.6rem", textAlign: "center" }}>
              <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{t.label}</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{t.value}</div>
            </div>
          ))}
        </div>
      )}

      {log.length > 3 && (
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by exercise…"
          style={{ ...s.input, marginTop: 0, marginBottom: "0.85rem" }} />
      )}

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "flex", gap: 6, alignItems: "center" }}>{SPINNER} Loading…</p>}

      {!loading && log.length === 0 && (
        <div style={{ ...s.card, textAlign: "center", padding: "2rem 1rem" }}>
          <div style={{ fontSize: "1.75rem", marginBottom: "0.4rem" }}>🏋️</div>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Nothing logged yet</div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>
            Open a workout in the <strong>Calendar</strong>, enter your weight / reps / RIR per set,
            and press <strong>Finish exercise</strong>. It'll show up here.
          </p>
        </div>
      )}

      {byDate.map(([dateStr, items]) => (
        <div key={dateStr} style={{ marginBottom: "1.1rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.88rem", fontWeight: 700 }}>
              {new Date(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{items[0].activity}</span>
          </div>

          {items.map(item => (
            <div key={`${item.session_id}-${item.exercise_id}`} style={{ ...s.card, padding: "0.7rem 0.85rem", marginBottom: "0.45rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{item.exercise_name}</span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  {item.sets.length} sets{item.top_weight != null ? ` · top ${item.top_weight} kg` : ""}
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.45rem" }}>
                {item.sets.map(set => (
                  <span key={set.set_number} style={{
                    background: set.failure ? "color-mix(in srgb, #ef4444 20%, var(--bg))" : "var(--bg)",
                    border: `1px solid ${set.failure ? "#ef4444" : "var(--border)"}`,
                    borderRadius: 6, padding: "0.2rem 0.45rem", fontSize: "0.72rem", whiteSpace: "nowrap",
                  }}>
                    <span style={{ color: "var(--text-muted)" }}>#{set.set_number}</span>{" "}
                    {set.weight != null ? `${set.weight}kg` : "–"} × {set.reps ?? "–"}
                    {set.rir != null ? ` · RIR ${set.rir}` : ""}
                    {set.failure ? " ⚡" : ""}
                  </span>
                ))}
              </div>

              {item.failure_sets.length > 0 && (
                <div style={{ fontSize: "0.72rem", color: "#ef4444", marginTop: "0.35rem" }}>
                  Reached failure on set {item.failure_sets.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
