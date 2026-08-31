import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Exercise,
  type Goal,
  type PlanEntry,
  type PreviousPerformance,
  type SetLog,
  type WorkoutSession,
} from "../../api";
import { SPINNER, s } from "./shared";

interface Props {
  goal: Goal;
  entry: PlanEntry;
  onClose: () => void;
}

type Draft = Record<string, Record<number, { weight?: number; reps?: number; rir?: number }>>;

export default function WorkoutLogger({ goal, entry, onClose }: Props) {
  const exercises = useMemo(
    () => [...(entry.exercises ?? [])].sort((a, b) => a.order_index - b.order_index),
    [entry.exercises]
  );

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previous, setPrevious] = useState<Record<string, PreviousPerformance | null>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // open (or reuse) today's session and hydrate what was already logged
  const open = useCallback(async () => {
    try {
      const ws = await api.openSession(goal.id, entry.id);
      setSession(ws);
      const hydrated: Draft = {};
      const finished: Record<string, boolean> = {};
      for (const log of ws.set_logs ?? []) {
        const perEx = (hydrated[log.exercise_id] ??= {});
        perEx[log.set_number] = {
          weight: log.weight ?? undefined,
          reps: log.reps ?? undefined,
          rir: log.rir ?? undefined,
        };
        finished[log.exercise_id] = true;
      }
      setDraft(hydrated);
      setDone(prev => ({ ...finished, ...prev }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [goal.id, entry.id]);

  useEffect(() => { open(); }, [open]);

  // previous performance per exercise (from earlier sessions)
  useEffect(() => {
    exercises.forEach(ex => {
      api.getPrevious(goal.id, entry.id, ex.id)
        .then(p => setPrevious(prev => ({ ...prev, [ex.id]: p })))
        .catch(() => {});
    });
  }, [goal.id, entry.id, exercises]);

  function setField(exId: string, setNo: number, field: "weight" | "reps" | "rir", raw: string) {
    const value = raw === "" ? undefined : Number(raw);
    setDraft(prev => {
      const perEx = { ...(prev[exId] ?? {}) };
      perEx[setNo] = { ...(perEx[setNo] ?? {}), [field]: Number.isNaN(value as number) ? undefined : value };
      return { ...prev, [exId]: perEx };
    });
  }

  function draftToSets(exId: string): SetLog[] {
    const perEx = draft[exId] ?? {};
    return Object.entries(perEx)
      .map(([setNo, v]) => ({
        exercise_id: exId,
        set_number: Number(setNo),
        weight: v.weight ?? null,
        reps: v.reps ?? null,
        rir: v.rir ?? null,
      }))
      .filter(sl => sl.weight != null || sl.reps != null || sl.rir != null);
  }

  async function toggleDone(ex: Exercise) {
    if (!session || busy[ex.id]) return;
    setBusy(prev => ({ ...prev, [ex.id]: true }));
    setError("");
    try {
      if (done[ex.id]) {
        await api.unfinishExercise(goal.id, session.id, ex.id);
        setDone(prev => ({ ...prev, [ex.id]: false }));
      } else {
        const sets = draftToSets(ex.id);
        if (sets.length === 0) {
          setExpanded(ex.id);
          setError(`Enter at least one set for ${ex.name} before finishing it.`);
          setBusy(prev => ({ ...prev, [ex.id]: false }));
          return;
        }
        const ws = await api.finishExercise(goal.id, session.id, ex.id, sets);
        setSession(ws);
        setDone(prev => ({ ...prev, [ex.id]: true }));
        setExpanded(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(prev => ({ ...prev, [ex.id]: false }));
  }

  async function autosave(exId: string) {
    if (!session) return;
    const sets = draftToSets(exId);
    if (!sets.length) return;
    await api.logSets(goal.id, session.id, sets).catch(() => {});
  }

  async function completeWorkout() {
    if (!session) return;
    setBusy(prev => ({ ...prev, __all: true }));
    try {
      await api.completeSession(goal.id, session.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(prev => ({ ...prev, __all: false }));
    }
  }

  const doneCount = exercises.filter(ex => done[ex.id]).length;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, padding: "0.75rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "18px 18px 0 0", padding: "1.35rem", width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto", margin: "auto" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.85rem", gap: "0.5rem" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>{entry.activity}</h2>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
              {exercises.length > 0 ? `${exercises.length} exercises` : "No exercises"}
              {entry.duration_minutes ? ` · ~${entry.duration_minutes} min` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            {exercises.length > 0 && (
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: doneCount === exercises.length ? "#22c55e" : "var(--text-muted)" }}>
                {doneCount}/{exercises.length}
              </span>
            )}
            <button onClick={onClose} style={{ background: "var(--bg)", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "var(--text-muted)" }}>✕</button>
          </div>
        </div>

        {exercises.length > 0 && (
          <div style={{ height: 5, background: "var(--bg)", borderRadius: 3, marginBottom: "0.9rem", overflow: "hidden" }}>
            <div style={{ width: `${(doneCount / exercises.length) * 100}%`, height: "100%", background: doneCount === exercises.length ? "#22c55e" : "var(--primary)", transition: "width 0.25s" }} />
          </div>
        )}

        {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", display: "flex", gap: 6, alignItems: "center" }}>{SPINNER} Loading…</p>}

        {error && (
          <div style={{ background: "color-mix(in srgb, #ef4444 15%, var(--surface))", border: "1px solid #ef4444", borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: "0.78rem", marginBottom: "0.7rem" }}>
            ⚠️ {error}
          </div>
        )}

        {exercises.length === 0 && !loading && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <p style={{ fontSize: "0.88rem", color: "var(--text)", lineHeight: 1.6, marginBottom: "1rem" }}>
              {entry.notes || "Low-intensity cardio / active recovery session."}
            </p>
            <button
              onClick={async () => {
                try {
                  await api.updatePlanEntry(goal.id, entry.id, { completed: !entry.completed });
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
              style={{
                ...(entry.completed ? s.btnSecondary : s.btnPrimary),
                padding: "0.65rem 1.25rem", fontSize: "0.9rem", fontWeight: 600,
              }}>
              {entry.completed ? "Mark incomplete" : "Mark completed ✓"}
            </button>
          </div>
        )}

        {/* exercises */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {exercises.map((ex, i) => {
            const isDone = Boolean(done[ex.id]);
            const isOpen = expanded === ex.id;
            const setCount = ex.sets ?? 3;
            const prev = previous[ex.id];
            return (
              <div key={ex.id} style={{
                background: "var(--bg)", borderRadius: 11,
                border: isDone ? "1px solid #22c55e" : "1px solid var(--border)",
                overflow: "hidden",
              }}>
                {/* row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", padding: "0.75rem 0.85rem", cursor: "pointer" }}
                  onClick={() => setExpanded(isOpen ? null : ex.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.92rem", opacity: isDone ? 0.65 : 1 }}>
                      {i + 1}. {ex.name}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                      {ex.sets ?? "—"} sets
                      {ex.reps ? ` × ${ex.reps}${ex.reps_max ? `–${ex.reps_max}` : ""} reps` : ""}
                      {ex.weight != null ? ` · ${ex.weight} kg target` : ""}
                      {ex.rir_target != null ? ` · RIR ${ex.rir_target}` : ""}
                      {ex.duration_seconds ? ` · ${ex.duration_seconds}s` : ""}
                    </div>
                    {prev && prev.sets.length > 0 && (
                      <div style={{ fontSize: "0.72rem", color: "var(--primary)", marginTop: "0.15rem" }}>
                        Previous: {prev.sets[0].weight ?? "–"} kg × {prev.sets[0].reps ?? "–"} × {prev.sets.length} ({prev.performed_at})
                      </div>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); toggleDone(ex); }} disabled={busy[ex.id]}
                    title={isDone ? "Mark unfinished" : "Finish exercise"}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, opacity: busy[ex.id] ? 0.5 : 1 }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" style={{ display: "block" }}>
                      <circle cx="12" cy="12" r="10" fill={isDone ? "#22c55e" : "none"} stroke={isDone ? "#22c55e" : "var(--border)"} strokeWidth="2" />
                      {isDone && <path d="M7.5 12.5l3 3 6-6.5" stroke="#04210b" strokeWidth="2.5" fill="none" />}
                    </svg>
                  </button>
                </div>

                {/* set entry */}
                {isOpen && (
                  <div style={{ padding: "0 0.85rem 0.85rem" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                      <thead>
                        <tr style={{ color: "var(--text-muted)", fontSize: "0.68rem", textTransform: "uppercase" }}>
                          <th style={{ textAlign: "left", padding: "0.15rem 0" }}>Set</th>
                          <th style={{ textAlign: "right" }}>Weight</th>
                          <th style={{ textAlign: "right" }}>Reps</th>
                          <th style={{ textAlign: "right" }}>RIR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: setCount }, (_, idx) => {
                          const setNo = idx + 1;
                          const cur = draft[ex.id]?.[setNo] ?? {};
                          const prevSet = prev?.sets.find(ps => ps.set_number === setNo);
                          return (
                            <tr key={setNo}>
                              <td style={{ padding: "0.2rem 0", fontWeight: 600 }}>{setNo}</td>
                              {(["weight", "reps", "rir"] as const).map(field => (
                                <td key={field} style={{ padding: "0.15rem 0 0.15rem 0.35rem", textAlign: "right" }}>
                                  <input
                                    inputMode="decimal"
                                    disabled={isDone}
                                    placeholder={String(
                                      field === "weight"
                                        ? (ex.weight ?? prevSet?.weight ?? "—")
                                        : field === "reps"
                                          ? (ex.reps ?? prevSet?.reps ?? "—")
                                          : (ex.rir_target ?? prevSet?.rir ?? "—")
                                    )}
                                    value={cur[field] ?? ""}
                                    onChange={e => setField(ex.id, setNo, field, e.target.value)}
                                    onBlur={() => autosave(ex.id)}
                                    style={{
                                      width: "100%", maxWidth: 70, background: "var(--surface)",
                                      border: "1px solid var(--border)", borderRadius: 6,
                                      padding: "0.3rem 0.4rem", color: "var(--text)", fontSize: "0.85rem", textAlign: "right",
                                      opacity: isDone ? 0.6 : 1,
                                    }} />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
                      RIR 0 = failure · 1 = ~1 rep left · 2 = ~2 left · 3+ = easy
                    </div>
                    {ex.notes && <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>{ex.notes}</div>}
                    <button onClick={() => toggleDone(ex)} disabled={busy[ex.id]}
                      style={{
                        ...(isDone ? s.btnSecondary : s.btnPrimary),
                        width: "100%", marginTop: "0.6rem", padding: "0.5rem",
                        opacity: busy[ex.id] ? 0.6 : 1,
                      }}>
                      {busy[ex.id] ? "Saving…" : isDone ? "Unmark exercise" : "Finish exercise ✓"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {entry.notes && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.55, marginTop: "0.9rem" }}>{entry.notes}</p>
        )}

        {session && (
          <button onClick={completeWorkout} disabled={Boolean(busy.__all)}
            style={{ ...s.btnPrimary, width: "100%", marginTop: "1rem", padding: "0.7rem", fontSize: "0.92rem", opacity: busy.__all ? 0.6 : 1 }}>
            {busy.__all ? "Saving…" : "Complete workout ✓"}
          </button>
        )}
      </div>
    </div>
  );
}
