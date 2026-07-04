import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Goal, type PlanEntry, type Exercise } from "../api";

const SPINNER = (
  <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, animation: "spin 0.8s linear infinite", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
  </svg>
);

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- chat state machine ----------
type ChatStep = "idle" | "input" | "questions" | "generating" | "done";

export default function Fitness() {
  const navigate = useNavigate();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // chat state
  const [chatStep, setChatStep] = useState<ChatStep>("idle");
  const [chatInput, setChatInput] = useState("");
  const [aiQuestions, setAiQuestions] = useState<string[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [qaList, setQaList] = useState<{ question: string; answer: string }[]>([]);
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatPending, setChatPending] = useState(false);

  // goal form
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [goalForm, setGoalForm] = useState({ title: "", description: "", metric_name: "", current_value: "", target_value: "", unit: "", start_date: "", target_date: "" });

  // entry form
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryForm, setEntryForm] = useState({ week_number: "1", day_of_week: "0", activity: "", duration_minutes: "", notes: "", frequency_hint: "" });

  // workout detail
  const [workoutEntry, setWorkoutEntry] = useState<PlanEntry | null>(null);
  const [workoutExercises, setWorkoutExercises] = useState<Exercise[]>([]);

  // refine chat (per goal)
  const [refineMessages, setRefineMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [refineInput, setRefineInput] = useState("");
  const [refinePending, setRefinePending] = useState(false);

  // reset refine chat when switching goals
  useEffect(() => { setRefineMessages([]); setRefineInput(""); }, [selectedGoalId]);

  async function handleRefineSend() {
    if (!refineInput.trim() || !selectedGoalId || refinePending) return;
    const msg = refineInput.trim();
    const history = refineMessages.map(m => ({ role: m.role, text: m.text }));
    setRefineInput("");
    setRefineMessages(prev => [...prev, { role: "user", text: msg }]);
    setRefinePending(true);
    try {
      const res = await api.continuePlan(selectedGoalId, msg, false, history);
      if (res.message) setRefineMessages(prev => [...prev, { role: "assistant", text: res.message! }]);
    } catch (err: unknown) {
      setRefineMessages(prev => [...prev, { role: "assistant", text: err instanceof Error ? err.message : "Error" }]);
    }
    setRefinePending(false);
  }

  async function handleRefineFinish() {
    if (!selectedGoalId || refinePending) return;
    const lastMsg = refineMessages.filter(m => m.role === "user").pop()?.text || "finalize the plan";
    const history = refineMessages.map(m => ({ role: m.role, text: m.text }));
    setRefinePending(true);
    setRefineMessages(prev => [...prev, { role: "user", text: "Finish and update the plan." }]);
    try {
      const res = await api.continuePlan(selectedGoalId, lastMsg, true, history);
      if (res.type === "finalized") {
        await load();
        await loadEntries(selectedGoalId);
        setRefineMessages([]);
      }
    } catch (err: unknown) {
      setRefineMessages(prev => [...prev, { role: "assistant", text: err instanceof Error ? err.message : "Error finalizing" }]);
    }
    setRefinePending(false);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const gs = await api.listGoals();
      setGoals(gs);
      if (gs.length > 0 && !selectedGoalId) setSelectedGoalId(gs[0].id);
    } catch { setGoals([]); }
    setLoading(false);
  }, [selectedGoalId]);

  const loadEntries = useCallback(async (gid: string) => {
    try { setEntries(await api.listPlanEntries(gid)); }
    catch { setEntries([]); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedGoalId) loadEntries(selectedGoalId); }, [selectedGoalId, loadEntries]);

  // ---------- chat ----------
  async function handleStartChat() {
    if (!chatInput.trim()) return;
    setChatPending(true);
    setChatError("");
    try {
      const res = await api.generateQuestions(chatInput);
      setAiQuestions(res.questions);
      setChatStep("questions");
      setQIdx(0);
      setQaList([]);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : "Failed to get questions");
      setChatStep("input");
    }
    setChatPending(false);
  }

  async function handleAnswer() {
    if (!chatAnswer.trim()) return;
    const updated = [...qaList, { question: aiQuestions[qIdx], answer: chatAnswer }];
    setQaList(updated);
    setChatAnswer("");

    if (qIdx + 1 < aiQuestions.length) {
      setQIdx(qIdx + 1);
    } else {
      setChatStep("generating");
      try {
        const result = await api.generatePlan(chatInput, updated);
        setChatStep("done");
        await load();
        if (result.goal) setSelectedGoalId(result.goal.id);
      } catch (err: unknown) {
        setChatError(err instanceof Error ? err.message : "Plan generation failed");
        setChatStep("questions");
      }
    }
  }

  function resetChat() {
    setChatStep("idle");
    setChatInput("");
    setAiQuestions([]);
    setQIdx(0);
    setQaList([]);
    setChatAnswer("");
    setChatError("");
  }

  // ---------- goal CRUD ----------
  function resetGoalForm(g?: Goal | null) {
    setGoalForm({
      title: g?.title ?? "", description: g?.description ?? "", metric_name: g?.metric_name ?? "",
      current_value: g?.current_value?.toString() ?? "", target_value: g?.target_value?.toString() ?? "",
      unit: g?.unit ?? "", start_date: g?.start_date ?? "", target_date: g?.target_date ?? "",
    });
  }

  async function handleSaveGoal() {
    const body: Record<string, unknown> = { title: goalForm.title, description: goalForm.description || null, metric_name: goalForm.metric_name || null, unit: goalForm.unit || null, start_date: goalForm.start_date || null, target_date: goalForm.target_date || null };
    if (goalForm.current_value) body.current_value = Number(goalForm.current_value);
    if (goalForm.target_value) body.target_value = Number(goalForm.target_value);
    if (editingGoal) await api.updateGoal(editingGoal.id, body);
    else await api.createGoal(body);
    setShowGoalForm(false);
    setEditingGoal(null);
    await load();
  }

  async function handleDeleteGoal(id: string) {
    await api.deleteGoal(id);
    if (selectedGoalId === id) setSelectedGoalId(null);
    await load();
  }

  // ---------- entry completion toggle ----------
  async function toggleCompleted(entry: PlanEntry) {
    if (!selectedGoalId) return;
    await api.updatePlanEntry(selectedGoalId, entry.id, { completed: !entry.completed });
    await loadEntries(selectedGoalId);
  }

  // ---------- entry form ----------
  async function handleSaveEntry() {
    if (!selectedGoalId) return;
    const body: Record<string, unknown> = { week_number: Number(entryForm.week_number), activity: entryForm.activity };
    const dow = Number(entryForm.day_of_week);
    if (dow >= 0 && dow <= 6) body.day_of_week = dow;
    if (entryForm.duration_minutes) body.duration_minutes = Number(entryForm.duration_minutes);
    if (entryForm.notes) body.notes = entryForm.notes;
    if (entryForm.frequency_hint) body.frequency_hint = entryForm.frequency_hint;
    await api.createPlanEntry(selectedGoalId, body);
    setShowEntryForm(false);
    setEntryForm({ week_number: "1", day_of_week: "0", activity: "", duration_minutes: "", notes: "", frequency_hint: "" });
    await loadEntries(selectedGoalId);
  }

  async function handleDeleteEntry(eid: string) {
    if (!selectedGoalId) return;
    await api.deletePlanEntry(selectedGoalId, eid);
    await loadEntries(selectedGoalId);
  }

  // ---------- workout detail ----------
  async function openWorkout(entry: PlanEntry) {
    setWorkoutEntry(entry);
    try {
      if (selectedGoalId) {
        const exs = await api.listExercises(selectedGoalId, entry.id);
        setWorkoutExercises(exs);
      }
    } catch { setWorkoutExercises([]); }
  }

  async function toggleExercise(ex: Exercise) {
    if (!selectedGoalId || !workoutEntry) return;
    await api.updateExercise(selectedGoalId, workoutEntry.id, ex.id, { completed: !ex.completed });
    setWorkoutExercises(prev => prev.map(e => e.id === ex.id ? { ...e, completed: !e.completed } : e));
  }

  const selectedGoal = goals.find((g) => g.id === selectedGoalId);
  const byWeek: Record<number, PlanEntry[]> = {};
  for (const e of entries) {
    if (!byWeek[e.week_number]) byWeek[e.week_number] = [];
    byWeek[e.week_number].push(e);
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <button onClick={() => navigate("/")} style={s.link}>&larr; Dashboard</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700 }}>Fitness</h1>
        <button onClick={() => { resetGoalForm(); setEditingGoal(null); setShowGoalForm(true); }} style={s.btnPrimary}>+ New Goal</button>
      </div>

      {/* ---------- Chat ---------- */}
      {(chatStep === "idle" || chatStep === "input") && (
        <div style={{ ...s.card, marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...s.label, marginBottom: "0.25rem" }}>Describe your fitness goal</label>
              <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder='e.g. "I want to lose body fat from 25% to 10% in 6 months…"' rows={2}
                style={{ ...s.input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleStartChat(); } }} />
            </div>
            <button onClick={handleStartChat} disabled={chatPending || !chatInput.trim()}
              style={{ ...s.btnPrimary, whiteSpace: "nowrap", minWidth: 120, height: 40, opacity: (!chatInput.trim() || chatPending) ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              {chatPending ? <>{SPINNER} Loading…</> : "Generate Plan"}
            </button>
          </div>
          {chatError && <p style={{ color: "#ef4444", fontSize: "0.82rem", marginTop: "0.5rem" }}>{chatError}</p>}
        </div>
      )}

      {chatStep === "questions" && (
        <div style={{ ...s.card, marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Question {qIdx + 1} of {aiQuestions.length}</span>
            <button onClick={resetChat} style={s.btnSmall}>Cancel</button>
          </div>
          <div style={{ background: "var(--bg)", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
            {aiQuestions[qIdx]}
          </div>
          {qaList.map((qa, i) => (
            <div key={i} style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              <span style={{ color: "var(--primary)" }}>You:</span> {qa.answer}
            </div>
          ))}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input value={chatAnswer} onChange={e => setChatAnswer(e.target.value)} placeholder="Your answer…"
              style={{ ...s.input, flex: 1 }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAnswer(); } }} />
            <button onClick={handleAnswer} disabled={!chatAnswer.trim()} style={{ ...s.btnPrimary, opacity: !chatAnswer.trim() ? 0.6 : 1 }}>Next</button>
          </div>
          {chatError && <p style={{ color: "#ef4444", fontSize: "0.82rem", marginTop: "0.5rem" }}>{chatError}</p>}
        </div>
      )}

      {chatStep === "generating" && (
        <div style={{ ...s.card, marginBottom: "1.5rem", textAlign: "center", padding: "2rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          {SPINNER}
          <span style={{ color: "var(--text-muted)" }}>Generating your personalized plan…</span>
        </div>
      )}

      {chatStep === "done" && (
        <div style={{ ...s.card, marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#22c55e", fontWeight: 600 }}>Plan created!</span>
          <button onClick={resetChat} style={s.btnSmall}>New goal</button>
        </div>
      )}

      {/* ---------- Goals ---------- */}
      {goals.length === 0 && !loading && <p style={{ color: "var(--text-muted)" }}>No goals yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
        {goals.map(g => (
          <GoalCard key={g.id} goal={g} active={g.id === selectedGoalId}
            onSelect={() => setSelectedGoalId(g.id)}
            onEdit={() => { resetGoalForm(g); setEditingGoal(g); setShowGoalForm(true); }}
            onDelete={() => handleDeleteGoal(g.id)} />
        ))}
      </div>

      {/* ---------- Goal form ---------- */}
      {showGoalForm && (
        <Overlay onClose={() => { setShowGoalForm(false); setEditingGoal(null); }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>{editingGoal ? "Edit Goal" : "New Goal"}</h2>
          <div style={s.grid2}>
            <label style={s.label}>Title *<input style={s.input} value={goalForm.title} onChange={e => setGoalForm({ ...goalForm, title: e.target.value })} /></label>
            <label style={s.label}>Description<input style={s.input} value={goalForm.description} onChange={e => setGoalForm({ ...goalForm, description: e.target.value })} /></label>
            <label style={s.label}>Metric name<input style={s.input} placeholder="e.g. Body Fat %" value={goalForm.metric_name} onChange={e => setGoalForm({ ...goalForm, metric_name: e.target.value })} /></label>
            <label style={s.label}>Unit<input style={s.input} placeholder="e.g. %" value={goalForm.unit} onChange={e => setGoalForm({ ...goalForm, unit: e.target.value })} /></label>
            <label style={s.label}>Current value<input style={s.input} type="number" step="any" value={goalForm.current_value} onChange={e => setGoalForm({ ...goalForm, current_value: e.target.value })} /></label>
            <label style={s.label}>Target value<input style={s.input} type="number" step="any" value={goalForm.target_value} onChange={e => setGoalForm({ ...goalForm, target_value: e.target.value })} /></label>
            <label style={s.label}>Start date<input style={s.input} type="date" value={goalForm.start_date} onChange={e => setGoalForm({ ...goalForm, start_date: e.target.value })} /></label>
            <label style={s.label}>Target date<input style={s.input} type="date" value={goalForm.target_date} onChange={e => setGoalForm({ ...goalForm, target_date: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button onClick={() => { setShowGoalForm(false); setEditingGoal(null); }} style={s.btnSecondary}>Cancel</button>
            <button onClick={handleSaveGoal} style={s.btnPrimary} disabled={!goalForm.title}>Save</button>
          </div>
        </Overlay>
      )}

      {/* ---------- Refine Chat ---------- */}
      {selectedGoal && (
        <div style={{ ...s.card, marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Refine Plan</span>
            {refineMessages.length > 0 && (
              <button onClick={() => setRefineMessages([])} style={s.btnSmall}>Clear chat</button>
            )}
          </div>
          {refineMessages.length > 0 && (
            <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {refineMessages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  background: m.role === "user" ? "var(--primary)" : "var(--bg)",
                  color: m.role === "user" ? "#fff" : "var(--text)",
                  borderRadius: 12, padding: "0.4rem 0.75rem", fontSize: "0.82rem", maxWidth: "85%", lineHeight: 1.5, whiteSpace: "pre-wrap",
                }}>{m.text}</div>
              ))}
              {refinePending && (
                <div style={{ alignSelf: "flex-start", background: "var(--bg)", borderRadius: 12, padding: "0.4rem 0.75rem", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6 }}>
                  {SPINNER} Thinking…
                </div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input value={refineInput} onChange={e => setRefineInput(e.target.value)} placeholder="Ask to change exercises, add jogging, adjust difficulty…"
              style={{ ...s.input, flex: 1, marginTop: 0 }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefineSend(); } }} />
            <button onClick={handleRefineSend} disabled={!refineInput.trim() || refinePending}
              style={{ ...s.btnPrimary, whiteSpace: "nowrap", opacity: (!refineInput.trim() || refinePending) ? 0.6 : 1 }}>Send</button>
            <button onClick={handleRefineFinish} disabled={refinePending}
              style={{ ...s.btnSecondary, whiteSpace: "nowrap", opacity: refinePending ? 0.6 : 1 }}>Finish</button>
          </div>
        </div>
      )}

      {/* ---------- Calendar ---------- */}
      {selectedGoal && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Plan: {selectedGoal.title}</h2>
            <button onClick={() => setShowEntryForm(true)} style={s.btnSecondary}>+ Add Activity</button>
          </div>

          {Object.keys(byWeek).length === 0 && <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>No activities planned yet.</p>}

          {Object.entries(byWeek).sort(([a], [b]) => Number(a) - Number(b)).map(([wn, weekEntries]) => (
            <WeekCalendar key={wn} weekLabel={`Week ${wn}`} entries={weekEntries}
              onToggle={toggleCompleted} onDelete={handleDeleteEntry}
              onOpenWorkout={openWorkout} />
          ))}
        </section>
      )}

      {/* ---------- Entry form ---------- */}
      {showEntryForm && (
        <Overlay onClose={() => setShowEntryForm(false)}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>New Activity</h2>
          <div style={s.grid2}>
            <label style={s.label}>Week *<input style={s.input} type="number" min="1" value={entryForm.week_number} onChange={e => setEntryForm({ ...entryForm, week_number: e.target.value })} /></label>
            <label style={s.label}>Day<select style={s.input} value={entryForm.day_of_week} onChange={e => setEntryForm({ ...entryForm, day_of_week: e.target.value })}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select></label>
            <label style={s.label}>Activity *<input style={s.input} value={entryForm.activity} onChange={e => setEntryForm({ ...entryForm, activity: e.target.value })} /></label>
            <label style={s.label}>Duration (min)<input style={s.input} type="number" value={entryForm.duration_minutes} onChange={e => setEntryForm({ ...entryForm, duration_minutes: e.target.value })} /></label>
            <label style={s.label}>Frequency hint<input style={s.input} placeholder="e.g. 3x this week" value={entryForm.frequency_hint} onChange={e => setEntryForm({ ...entryForm, frequency_hint: e.target.value })} /></label>
            <label style={s.label}>Notes<input style={s.input} value={entryForm.notes} onChange={e => setEntryForm({ ...entryForm, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button onClick={() => setShowEntryForm(false)} style={s.btnSecondary}>Cancel</button>
            <button onClick={handleSaveEntry} style={s.btnPrimary} disabled={!entryForm.activity}>Save</button>
          </div>
        </Overlay>
      )}

      {/* ---------- Workout detail ---------- */}
      {workoutEntry && (
        <Overlay onClose={() => { setWorkoutEntry(null); setWorkoutExercises([]); }} wide>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>{workoutEntry.activity}</h2>
              {workoutEntry.duration_minutes && (
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{workoutEntry.duration_minutes} min</span>
              )}
            </div>
            <button onClick={() => { setWorkoutEntry(null); setWorkoutExercises([]); }} style={{ ...s.btnSmall, fontSize: "0.8rem" }}>Close</button>
          </div>
          {workoutEntry.notes && (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>{workoutEntry.notes}</p>
          )}

          {workoutExercises.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "2rem 0" }}>No exercises listed for this activity.</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {workoutExercises.map((ex, i) => (
              <div key={ex.id} style={{
                display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.75rem 1rem",
                background: "var(--bg)", borderRadius: 10, border: ex.completed ? "1px solid var(--primary)" : "1px solid transparent",
                opacity: ex.completed ? 0.6 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <input type="checkbox" checked={ex.completed} onChange={() => toggleExercise(ex)}
                    style={{ width: 20, height: 20, accentColor: "var(--primary)", cursor: "pointer", flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: "0.95rem", flex: 1, textDecoration: ex.completed ? "line-through" : "none" }}>
                    {i + 1}. {ex.name}
                  </span>
                  {ex.notes && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", maxWidth: "40%", textAlign: "right" }}>{ex.notes}</span>}
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", paddingLeft: "2.75rem" }}>
                  {ex.sets != null && <Badge label="Sets" value={`${ex.sets}`} />}
                  {ex.reps != null && <Badge label="Reps" value={`${ex.reps}`} />}
                  {ex.weight != null && <Badge label="Weight" value={`${ex.weight} kg`} />}
                  {ex.duration_seconds != null && <Badge label="Duration" value={`${ex.duration_seconds}s`} />}
                </div>
              </div>
            ))}
          </div>
        </Overlay>
      )}
    </main>
  );
}

// ---------- Sub-components ----------

function GoalCard({ goal, active, onSelect, onEdit, onDelete }: { goal: Goal; active: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const progress = goal.current_value != null && goal.target_value != null
    ? Math.min(Math.round(((goal.current_value - goal.target_value) / goal.current_value) * 100), 100) : null;
  return (
    <div onClick={onSelect} style={{
      background: active ? "var(--surface-hover)" : "var(--surface)",
      border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
      borderRadius: 12, padding: "1rem 1.25rem", cursor: "pointer", transition: "all 0.12s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>{goal.title}</div>
          {goal.description && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>{goal.description}</div>}
        </div>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <button onClick={e => { e.stopPropagation(); onEdit(); }} style={s.btnSmall}>Edit</button>
          <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ ...s.btnSmall, color: "#ef4444" }}>Delete</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
        {goal.metric_name && <Stat label={goal.metric_name} value={`${goal.current_value ?? "?"}${goal.unit ?? ""} → ${goal.target_value ?? "?"}${goal.unit ?? ""}`} />}
        {goal.start_date && <Stat label="Start" value={goal.start_date} />}
        {goal.target_date && <Stat label="Target" value={goal.target_date} />}
      </div>
      {progress != null && (
        <div style={{ background: "var(--bg)", borderRadius: 8, height: 6, marginTop: "0.75rem", overflow: "hidden" }}>
          <div style={{ width: `${Math.min(progress, 100)}%`, height: "100%", background: progress >= 100 ? "#22c55e" : "var(--primary)", borderRadius: 8, transition: "width 0.3s" }} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div>
    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{label}</span>
    <p style={{ fontSize: "0.88rem", fontWeight: 500 }}>{value}</p>
  </div>;
}

function WeekCalendar({ weekLabel, entries, onToggle, onDelete, onOpenWorkout }: {
  weekLabel: string; entries: PlanEntry[];
  onToggle: (e: PlanEntry) => void; onDelete: (id: string) => void; onOpenWorkout: (e: PlanEntry) => void;
}) {
  const flexible = entries.filter(e => e.day_of_week == null);
  const fixed = entries.filter(e => e.day_of_week != null);

  return (
    <div style={{ ...s.card, marginBottom: "0.75rem" }}>
      <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>{weekLabel}</h3>
      {flexible.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          {flexible.map(e => {
            const done = e.completed;
            return (
              <div key={e.id} onClick={() => onOpenWorkout(e)}
                style={{ background: done ? "var(--primary)" : "var(--bg)", borderRadius: 6, padding: "0.25rem 0.5rem", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", opacity: done ? 0.7 : 1, textDecoration: done ? "line-through" : "none" }}>
                <input type="checkbox" checked={done} onChange={() => onToggle(e)} onClick={e => e.stopPropagation()} style={{ accentColor: "var(--primary)", cursor: "pointer" }} />
                <span style={{ flex: 1 }}>{e.activity}{e.duration_minutes ? ` (${e.duration_minutes}m)` : ""}{e.frequency_hint ? ` · ${e.frequency_hint}` : ""}</span>
                <button onClick={e => { e.stopPropagation(); onDelete(e.id); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.75rem", padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "4px" }}>
        {DAYS.map((day, idx) => {
          const dayEntries = fixed.filter(e => e.day_of_week === idx);
          return (
            <div key={day} style={{ background: "var(--bg)", borderRadius: 8, padding: "0.45rem", minHeight: 80 }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "0.25rem" }}>{day}</div>
              {dayEntries.map(e => {
                const done = e.completed;
                return (
                  <div key={e.id} onClick={() => onOpenWorkout(e)}
                    style={{ fontSize: "0.76rem", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: "0.2rem", cursor: "pointer", borderRadius: 4, padding: "1px 0", textDecoration: done ? "line-through" : "none", opacity: done ? 0.5 : 1 }}>
                    <input type="checkbox" checked={done} onChange={() => onToggle(e)} onClick={e => e.stopPropagation()} style={{ marginTop: 2, accentColor: "var(--primary)", cursor: "pointer", flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{e.activity}{e.duration_minutes ? ` · ${e.duration_minutes}m` : ""}</span>
                    <button onClick={e => { e.stopPropagation(); onDelete(e.id); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.65rem", padding: 0, lineHeight: 1, flexShrink: 0 }}>✕</button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "1.5rem", width: "100%", maxWidth: wide ? 640 : 500, maxHeight: "90vh", overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.2rem 0.5rem", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--text-muted)", marginRight: "0.2rem" }}>{label}:</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </span>
  );
}

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem" } as React.CSSProperties,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
  btnSecondary: { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" } as React.CSSProperties,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as React.CSSProperties,
  link: { background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1.5rem" } as React.CSSProperties,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%", marginTop: "0.25rem" } as React.CSSProperties,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" } as React.CSSProperties,
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" } as React.CSSProperties,
};
