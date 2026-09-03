import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ExerciseLogItem, type Goal } from "../../api";
import { SPINNER, s } from "./shared";

interface Props { goal: Goal | null }

type EditSet = { weight: string; reps: string; rir: string };

export default function Workout({ goal }: Props) {
  const [log, setLog] = useState<ExerciseLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ExerciseLogItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editSets, setEditSets] = useState<EditSet[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!goal) { setLoading(false); return; }
    setLoading(true);
    try { setLog(await api.getExerciseLog(goal.id)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, [goal]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? log.filter(item => item.exercise_name.toLowerCase().includes(q)) : log;
  }, [log, query]);

  const byDate = useMemo(() => {
    const groups: Record<string, ExerciseLogItem[]> = {};
    for (const item of filtered) (groups[item.performed_at] ??= []).push(item);
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const totals = useMemo(() => ({
    exercises: log.length,
    sets: log.reduce((total, item) => total + item.sets.length, 0),
    failures: log.reduce((total, item) => total + item.failure_sets.length, 0),
  }), [log]);

  function startEdit(item: ExerciseLogItem) {
    setEditing(item);
    setEditName(item.exercise_name);
    setEditDate(item.performed_at);
    setEditSets(item.sets.map(set => ({
      weight: set.weight != null ? String(set.weight) : "",
      reps: set.reps != null ? String(set.reps) : "",
      rir: set.rir != null ? String(set.rir) : "",
    })));
    setError("");
  }

  function updateSet(index: number, field: keyof EditSet, value: string) {
    setEditSets(current => current.map((set, i) => i === index ? { ...set, [field]: value } : set));
  }

  async function saveEdit() {
    if (!goal || !editing || !editName.trim() || !editDate || !editSets.length) return;
    setSaving(true);
    setError("");
    try {
      await api.updateExerciseLog(goal.id, editing.id, {
        exercise_name: editName.trim(),
        performed_at: editDate,
        sets: editSets.map((set, index) => ({
          set_number: index + 1,
          weight: set.weight === "" ? null : Number(set.weight),
          reps: set.reps === "" ? null : Number(set.reps),
          rir: set.rir === "" ? null : Number(set.rir),
        })),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  }

  async function remove(item: ExerciseLogItem) {
    if (!goal || !window.confirm(`Delete the logged ${item.exercise_name} from ${item.performed_at}?`)) return;
    setError("");
    try {
      await api.deleteExerciseLog(goal.id, item.id);
      if (editing?.id === item.id) setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!goal) return <p style={{ color: "var(--text-muted)" }}>Create a plan first.</p>;

  return (
    <div>
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.55, marginBottom: "0.85rem" }}>
        Permanent training history. Plan changes cannot remove these entries; only Delete here can.
      </p>

      {error && (
        <div style={{ background: "color-mix(in srgb, #ef4444 15%, var(--surface))", border: "1px solid #ef4444", borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: "0.78rem", marginBottom: "0.7rem" }}>
          ⚠️ {error}
        </div>
      )}

      {log.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem", marginBottom: "0.85rem" }}>
          {[
            { label: "Exercises", value: totals.exercises },
            { label: "Sets", value: totals.sets },
            { label: "To failure", value: totals.failures },
          ].map(tile => (
            <div key={tile.label} style={{ ...s.card, padding: "0.6rem", textAlign: "center" }}>
              <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{tile.label}</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{tile.value}</div>
            </div>
          ))}
        </div>
      )}

      {log.length > 3 && (
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter by exercise…"
          style={{ ...s.input, marginTop: 0, marginBottom: "0.85rem" }} />
      )}

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "flex", gap: 6, alignItems: "center" }}>{SPINNER} Loading…</p>}

      {!loading && log.length === 0 && (
        <div style={{ ...s.card, textAlign: "center", padding: "2rem 1rem" }}>
          <div style={{ fontSize: "1.75rem", marginBottom: "0.4rem" }}>🏋️</div>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Nothing logged yet</div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.55, margin: 0 }}>
            Finish an exercise from the Calendar after entering weight, reps and RIR.
          </p>
        </div>
      )}

      {byDate.map(([dateStr, items]) => (
        <div key={dateStr} style={{ marginBottom: "1.1rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.88rem", fontWeight: 700 }}>
              {new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{items[0].activity}</span>
          </div>

          {items.map(item => (
            <div key={item.id} style={{ ...s.card, padding: "0.7rem 0.85rem", marginBottom: "0.45rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{item.exercise_name}</span>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
                    {item.sets.length} sets{item.top_weight != null ? ` · top ${item.top_weight} kg` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  <button onClick={() => startEdit(item)} style={s.btnSmall}>Edit</button>
                  <button onClick={() => remove(item)} style={{ ...s.btnSmall, color: "#ef4444" }}>Delete</button>
                </div>
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
                    {set.rir != null ? ` · RIR ${set.rir}` : ""}{set.failure ? " ⚡" : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <div onClick={() => setEditing(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 110, padding: "0.75rem" }}>
          <div onClick={event => event.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "18px 18px 0 0", padding: "1.25rem", width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", margin: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Edit logged exercise</h2>
              <button onClick={() => setEditing(null)} style={s.btnSmall}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", marginBottom: "0.75rem" }}>
              <label style={s.label}>Exercise<input style={s.input} value={editName} onChange={event => setEditName(event.target.value)} /></label>
              <label style={s.label}>Date<input style={s.input} type="date" value={editDate} onChange={event => setEditDate(event.target.value)} /></label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2rem 1fr 1fr 1fr 2rem", gap: "0.35rem", fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: "0.25rem", textAlign: "center" }}>
              <span>Set</span><span>Weight</span><span>Reps</span><span>RIR</span><span />
            </div>
            {editSets.map((set, index) => (
              <div key={index} style={{ display: "grid", gridTemplateColumns: "2rem 1fr 1fr 1fr 2rem", gap: "0.35rem", alignItems: "center", marginBottom: "0.35rem" }}>
                <span style={{ fontWeight: 600, textAlign: "center" }}>{index + 1}</span>
                {(["weight", "reps", "rir"] as const).map(field => (
                  <input key={field} inputMode="decimal" value={set[field]} onChange={event => updateSet(index, field, event.target.value)}
                    style={{ ...s.input, marginTop: 0, padding: "0.4rem", textAlign: "right" }} />
                ))}
                <button onClick={() => setEditSets(current => current.filter((_, i) => i !== index))}
                  disabled={editSets.length === 1}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", opacity: editSets.length === 1 ? 0.4 : 1 }}>✕</button>
              </div>
            ))}

            <button onClick={() => setEditSets(current => [...current, { weight: "", reps: "", rir: "" }])}
              style={{ ...s.btnSmall, marginTop: "0.25rem" }}>+ Add set</button>

            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.9rem" }}>
              <button onClick={saveEdit} disabled={saving || !editName.trim() || !editDate || !editSets.length}
                style={{ ...s.btnPrimary, flex: 1, padding: "0.65rem", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button onClick={() => setEditing(null)} style={s.btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
