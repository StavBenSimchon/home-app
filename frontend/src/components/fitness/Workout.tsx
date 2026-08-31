import { useCallback, useEffect, useState } from "react";
import { api, type Exercise, type Goal, type PlanEntry, type SetLog, type WorkoutSession } from "../../api";
import { SPINNER, s } from "./shared";

interface Props {
  goal: Goal;
  entry?: PlanEntry | null;
  onClose?: () => void;
  onDone?: () => void;
}

export default function Workout({ goal, entry, onClose, onDone }: Props) {
  if (!entry) return <WorkoutPicker goal={goal} />;
  return <WorkoutSessionView goal={goal} entry={entry} onClose={onClose} onDone={onDone} />;
}

function WorkoutPicker({ goal }: { goal: Goal }) {
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [selected, setSelected] = useState<PlanEntry | null>(null);
  useEffect(() => {
    api.listPlanEntries(goal.id).then(setEntries).catch(() => setEntries([]));
  }, [goal.id]);
  if (selected) return <WorkoutSessionView goal={goal} entry={selected} onClose={() => setSelected(null)} />;
  const withExercises = entries.filter(e => e.exercises && e.exercises.length > 0);
  return (
    <div>
      <p style={{ color: "var(--text-muted)", marginBottom: "0.75rem" }}>Pick a workout:</p>
      {withExercises.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>No workouts with exercises in your plan.</p>}
      {withExercises.map(e => (
        <div key={e.id} onClick={() => setSelected(e)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.75rem 0.9rem", marginBottom: "0.5rem", cursor: "pointer" }}>
          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{e.activity}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{e.exercises?.length ?? 0} exercises{e.duration_minutes ? ` · ~${e.duration_minutes} min` : ""}</div>
        </div>
      ))}
    </div>
  );
}

function WorkoutSessionView({ goal, entry, onClose, onDone }: { goal: Goal; entry: PlanEntry; onClose?: () => void; onDone?: () => void }) {
  const [exercises] = useState<Exercise[]>(entry.exercises ?? []);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [logs, setLogs] = useState<Record<string, Record<number, SetLog>>>({});
  const [previous, setPrevious] = useState<Record<string, { weight: number | null; reps: number | null; rir: number | null }[]>>({});
  const [starting, setStarting] = useState(true);
  const [completing, setCompleting] = useState(false);

  const start = useCallback(async () => {
    try {
      const s = await api.startSession(goal.id, entry.id);
      setSession(s);
    } catch { /* offline ok */ }
    setStarting(false);
  }, [goal.id, entry.id]);

  useEffect(() => { start(); }, [start]);

  useEffect(() => {
    // Load previous performance for each exercise
    exercises.forEach(ex => {
      api.getPrevious(goal.id, entry.id, ex.id).then(p => {
        if (p) setPrevious(prev => ({ ...prev, [ex.id]: p.sets.map(s => ({ weight: s.weight, reps: s.reps, rir: s.rir })) }));
      }).catch(() => {});
    });
  }, [goal.id, entry.id, exercises]);

  function setField(exId: string, setNum: number, field: "weight" | "reps" | "rir", value: string) {
    const num = value === "" ? undefined : parseFloat(value);
    setLogs(prev => {
      const exLogs = { ...(prev[exId] ?? {}) };
      const current = exLogs[setNum] ?? { exercise_id: exId, set_number: setNum };
      const updated = { ...current, [field]: num };
      exLogs[setNum] = updated;
      return { ...prev, [exId]: exLogs };
    });
  }

  async function persistSet(exId: string, setNum: number) {
    if (!session) return;
    const log = logs[exId]?.[setNum];
    if (!log) return;
    await api.logSets(goal.id, session.id, [log]).catch(() => {});
  }

  async function completeSession() {
    if (!session) return;
    setCompleting(true);
    try {
      // Persist anything pending
      const pending = Object.values(logs).flatMap(l => Object.values(l));
      if (pending.length) await api.logSets(goal.id, session.id, pending).catch(() => {});
      await api.completeSession(goal.id, session.id);
      onDone?.();
      onClose?.();
    } catch { setCompleting(false); }
  }

  const doneExercises = exercises.filter(e => e.completed || Object.values(logs[e.id] ?? {}).some(l => l.weight != null || l.reps != null)).length;
  const total = exercises.length;

  return (
    <Overlay onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>{entry.activity}</h2>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{total} exercises{entry.duration_minutes ? ` · ~${entry.duration_minutes} min` : ""}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ fontSize: "0.75rem", color: doneExercises === total ? "#22c55e" : "var(--text-muted)", fontWeight: 600 }}>
            {doneExercises}/{total}
          </div>
          {onClose && <button onClick={onClose} style={{ background: "var(--bg)", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}>✕</button>}
        </div>
      </div>

      {total > 0 && (
        <div style={{ height: 5, background: "var(--bg)", borderRadius: 3, marginBottom: "1rem", overflow: "hidden" }}>
          <div style={{ width: `${(doneExercises / total) * 100}%`, height: "100%", background: doneExercises === total ? "#22c55e" : "var(--primary)", transition: "width 0.3s" }} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {exercises.map((ex, i) => {
          const setCount = ex.sets ?? 3;
          const prev = previous[ex.id];
          const exLogs = logs[ex.id] ?? {};
          const isDone = Object.values(exLogs).some(l => l.weight != null || l.reps != null);
          return (
            <div key={ex.id} style={{ background: "var(--bg)", borderRadius: 12, padding: "0.9rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{i + 1}. {ex.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {ex.sets} sets × {ex.reps}{ex.reps_max ? `–${ex.reps_max}` : ""} reps{ex.weight ? ` · ${ex.weight} kg` : ""}
                    {ex.rir_target != null && ` · RIR ${ex.rir_target}`}
                  </div>
                  {prev && prev.length > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "var(--primary)", marginTop: "0.15rem" }}>
                      Previous: {prev[0]?.weight ?? "?"} kg × {prev[0]?.reps ?? "?"} × {prev.length}
                    </div>
                  )}
                </div>
                {isDone && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                    <th style={{ textAlign: "left", padding: "0.15rem 0" }}>Set</th>
                    <th style={{ textAlign: "right", padding: "0.15rem 0" }}>Weight</th>
                    <th style={{ textAlign: "right", padding: "0.15rem 0" }}>Reps</th>
                    <th style={{ textAlign: "right", padding: "0.15rem 0" }}>RIR</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: setCount }, (_, sIdx) => {
                    const setNum = sIdx + 1;
                    const log = exLogs[setNum];
                    return (
                      <tr key={setNum}>
                        <td style={{ padding: "0.25rem 0", fontWeight: 600 }}>{setNum}</td>
                        {["weight", "reps", "rir"].map(field => (
                          <td key={field} style={{ padding: "0.15rem 0", textAlign: "right" }}>
                            <input
                              inputMode="decimal"
                              placeholder={prev?.[sIdx] ? String(prev[sIdx][field as "weight" | "reps" | "rir"] ?? "") : ""}
                              value={log?.[field as "weight" | "reps" | "rir"] ?? ""}
                              onChange={e => setField(ex.id, setNum, field as "weight" | "reps" | "rir", e.target.value)}
                              onBlur={() => persistSet(ex.id, setNum)}
                              style={{ width: "100%", maxWidth: 64, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.4rem", color: "var(--text)", fontSize: "0.82rem", textAlign: "right" }}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                RIR: 0 = failure · 1 = ~1 left · 2 = ~2 left · 3+ = easy
              </div>
            </div>
          );
        })}
      </div>

      {session && (
        <button onClick={completeSession} disabled={completing}
          style={{ ...s.btnPrimary, width: "100%", marginTop: "1.25rem", padding: "0.75rem", fontSize: "0.95rem", display: "flex", justifyContent: "center", alignItems: "center", gap: "0.4rem", opacity: completing ? 0.7 : 1 }}>
          {completing ? <>{SPINNER} Completing…</> : doneExercises === total ? "Complete workout ✓" : "Finish & mark workout"}
        </button>
      )}
      {starting && <p style={{ color: "var(--text-muted)", textAlign: "center", marginTop: "1rem", fontSize: "0.85rem" }}>Starting session…</p>}
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, padding: "0.75rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "18px 18px 0 0", padding: "1.5rem", width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", margin: "auto" }}>
        {children}
      </div>
    </div>
  );
}
