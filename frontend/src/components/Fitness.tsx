import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Goal, type PlanEntry, type Exercise } from "../api";
import WeightTracker from "./WeightTracker";

const SPINNER = (
  <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, animation: "spin 0.8s linear infinite", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
  </svg>
);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const _now = new Date();
const TODAY_DOW = _now.getDay();
const TODAY_STR = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
const TODAY_DOW_DB = (TODAY_DOW + 6) % 7;
const TODAY_DATE_STR = `${_now.getDate()}/${_now.getMonth() + 1}`;

function getCurrentWeek(startDate: string | null): number {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const now = new Date();
  const diff = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.floor(diff / 7) + 1);
}

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

  // tab
  const [activeTab, setActiveTab] = useState<"plan" | "weight">("plan");

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
    <main className="responsive-container">
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <button onClick={() => navigate("/")} style={s.link}>&larr; Dashboard</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "clamp(1.35rem, 5vw, 1.75rem)", fontWeight: 700 }}>Fitness</h1>
        <button onClick={() => { resetGoalForm(); setEditingGoal(null); setShowGoalForm(true); }} style={s.btnPrimary}>+ New Goal</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--border)" }}>
        {(["plan", "weight"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              background: "none", border: "none", padding: "0.5rem 1rem", fontSize: "0.9rem", fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "var(--primary)" : "var(--text-muted)", cursor: "pointer",
              borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent", marginBottom: -1,
            }}>
            {tab === "plan" ? "Plan" : "Weight"}
          </button>
        ))}
      </div>

      {activeTab === "plan" && (
        <>{/* ---------- Chat ---------- */}
      {(chatStep === "idle" || chatStep === "input") && (
        <div style={{ ...s.card, marginBottom: "1.5rem" }}>
          <div className="responsive-flex">
            <div className="grow">
              <label style={{ ...s.label, marginBottom: "0.25rem" }}>Describe your fitness goal</label>
              <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder='e.g. "I want to lose body fat from 25% to 10% in 6 months…"' rows={2}
                style={{ ...s.input, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleStartChat(); } }} />
            </div>
            <button onClick={handleStartChat} disabled={chatPending || !chatInput.trim()}
              style={{ ...s.btnPrimary, whiteSpace: "nowrap", height: 40, opacity: (!chatInput.trim() || chatPending) ? 0.6 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
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
          <div className="responsive-grid-2">
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
          <div className="responsive-flex" style={{ gap: "0.4rem" }}>
            <input value={refineInput} onChange={e => setRefineInput(e.target.value)} placeholder="Ask to change exercises, add jogging, adjust difficulty…"
              style={{ ...s.input, marginTop: 0 }}
              className="grow"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefineSend(); } }} />
            <button onClick={handleRefineSend} disabled={!refineInput.trim() || refinePending}
              style={{ ...s.btnPrimary, whiteSpace: "nowrap", opacity: (!refineInput.trim() || refinePending) ? 0.6 : 1 }}>Send</button>
            <button onClick={handleRefineFinish} disabled={refinePending}
              style={{ ...s.btnSecondary, whiteSpace: "nowrap", opacity: refinePending ? 0.6 : 1 }}>Finish</button>
          </div>
        </div>
      )}

      {/* ---------- Calendar ---------- */}
      {selectedGoal && (() => {
        const currentWeek = getCurrentWeek(selectedGoal.start_date);
        const todayEntries = entries.filter(e => e.day_of_week === TODAY_DOW_DB && e.week_number === currentWeek);
        const todayDone = todayEntries.filter(e => e.completed);
        const todayPending = todayEntries.filter(e => !e.completed);
        return (
          <>
            {/* Today's Workout */}
            {todayEntries.length > 0 && (
              <div style={{ background: "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 80%, #000))", borderRadius: 16, padding: "1.25rem", marginBottom: "1.5rem", color: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Today</div>
                    <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>{DAYS[TODAY_DOW]} {TODAY_DATE_STR}, Week {currentWeek}</div>
                  </div>
                  <div style={{ fontSize: "2rem", fontWeight: 700 }}>{todayDone.length}/{todayEntries.length}</div>
                </div>
                {todayPending.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.6rem 0.8rem", background: "rgba(255,255,255,0.15)", borderRadius: 10, fontSize: "0.9rem", fontWeight: 500 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                    All done for today!
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    {todayPending.map(e => (
                      <div key={e.id} onClick={() => openWorkout(e)}
                        style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.75rem", background: "rgba(255,255,255,0.12)", borderRadius: 10, cursor: "pointer", transition: "background 0.15s", backdropFilter: "blur(4px)" }}>
                        <div onClick={(ev) => { ev.stopPropagation(); toggleCompleted(e); }}
                          style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", transition: "all 0.2s" }} />
                        <span style={{ fontSize: "0.9rem", fontWeight: 500, flex: 1 }}>{e.activity}</span>
                        {e.duration_minutes && <span style={{ fontSize: "0.78rem", opacity: 0.7 }}>{e.duration_minutes}m</span>}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <div>
              <h2 style={{ fontSize: "1.35rem", fontWeight: 700 }}>Plan</h2>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>{selectedGoal.title}</p>
            </div>
            <button onClick={() => setShowEntryForm(true)} style={{ ...s.btnPrimary, borderRadius: 10, padding: "0.5rem 1rem" }}>+ Add</button>
          </div>

          {Object.keys(byWeek).length === 0 && <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>No activities planned yet.</p>}

          {Object.entries(byWeek).sort(([a], [b]) => Number(a) - Number(b)).map(([wn, weekEntries]) => (
            <WeekCalendar key={wn} weekLabel={`Week ${wn}`} weekNum={Number(wn)} goalStartDate={selectedGoal.start_date} entries={weekEntries}
              onToggle={toggleCompleted} onDelete={handleDeleteEntry}
              onOpenWorkout={openWorkout} />
          ))}
        </section>
          </>
        );
      })()}

      {/* ---------- Entry form ---------- */}
      {showEntryForm && (
        <Overlay onClose={() => setShowEntryForm(false)}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>New Activity</h2>
          <div className="responsive-grid-2">
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
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
              <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>{workoutEntry.activity}</h2>
              <button onClick={() => { setWorkoutEntry(null); setWorkoutExercises([]); }}
                style={{ background: "var(--bg)", border: "none", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {workoutEntry.duration_minutes && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.25rem 0.6rem", background: "var(--bg)", borderRadius: 6, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                {workoutEntry.duration_minutes} min
              </div>
            )}
          </div>
          {workoutEntry.notes && (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.6, padding: "0.6rem 0.8rem", background: "var(--bg)", borderRadius: 8 }}>{workoutEntry.notes}</p>
          )}

          {workoutExercises.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "2rem 0" }}>No exercises listed for this activity.</p>
          )}

          {workoutExercises.length > 0 && (() => {
            const exDone = workoutExercises.filter(e => e.completed).length;
            const exTotal = workoutExercises.length;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", padding: "0.6rem 0.75rem", background: "var(--bg)", borderRadius: 8 }}>
                <div style={{ flex: 1, height: 6, background: "var(--surface)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(exDone / exTotal) * 100}%`, height: "100%", background: exDone === exTotal ? "#22c55e" : "var(--primary)", borderRadius: 3, transition: "width 0.3s" }} />
                </div>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: exDone === exTotal ? "#22c55e" : "var(--text-muted)", whiteSpace: "nowrap" }}>{exDone}/{exTotal}</span>
              </div>
            );
          })()}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {workoutExercises.map((ex, i) => (
              <div key={ex.id} onClick={() => toggleExercise(ex)} style={{
                display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.75rem 1rem", cursor: "pointer",
                background: ex.completed ? "var(--surface)" : "var(--bg)", borderRadius: 10,
                border: ex.completed ? "1px solid var(--primary)" : "1px solid transparent",
                opacity: ex.completed ? 0.6 : 1, transition: "all 0.2s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", border: ex.completed ? "2px solid var(--primary)" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: ex.completed ? "var(--primary)" : "transparent" }}>
                    {ex.completed && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                  </div>
                  <span style={{ fontWeight: 600, fontSize: "0.95rem", flex: 1, textDecoration: ex.completed ? "line-through" : "none" }}>
                    {i + 1}. {ex.name}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", paddingLeft: "2.25rem" }}>
                  {ex.sets != null && <Badge label="Sets" value={`${ex.sets}`} />}
                  {ex.reps != null && <Badge label="Reps" value={`${ex.reps}`} />}
                  {ex.weight != null && <Badge label="Weight" value={`${ex.weight} kg`} />}
                  {ex.duration_seconds != null && <Badge label="Duration" value={`${ex.duration_seconds}s`} />}
                </div>
                {ex.notes && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", paddingLeft: "2.25rem", marginTop: "-0.2rem" }}>{ex.notes}</div>}
              </div>
            ))}
          </div>
        </Overlay>
      )}
    </>)}
      {activeTab === "weight" && <WeightTracker />}
    </main>
  );
}

const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem" } as const,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as const,
  btnSecondary: { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" } as const,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as const,
  link: { background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.9rem", padding: 0, marginBottom: "1.5rem" } as const,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%", marginTop: "0.25rem" } as const,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" as const },
};

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "1.05rem", fontWeight: 600, overflowWrap: "break-word" }}>{goal.title}</div>
          {goal.description && <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>{goal.description}</div>}
        </div>
        <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0 }}>
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

function WeekCalendar({ weekLabel, weekNum, goalStartDate, entries, onToggle, onDelete, onOpenWorkout }: {
  weekLabel: string; weekNum: number; goalStartDate: string | null; entries: PlanEntry[];
  onToggle: (e: PlanEntry) => void; onDelete: (id: string) => void; onOpenWorkout: (e: PlanEntry) => void;
}) {
  const flexible = entries.filter(e => e.day_of_week == null);
  const fixed = entries.filter(e => e.day_of_week != null);
  const completed = entries.filter(e => e.completed).length;
  const total = entries.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const currentWeek = getCurrentWeek(goalStartDate);
  const isCurrentWeek = weekNum === currentWeek;

  return (
    <div style={{ background: "var(--surface)", border: isCurrentWeek ? "1.5px solid var(--primary)" : "1px solid var(--border)", borderRadius: 14, padding: "1rem", marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600 }}>{weekLabel}</h3>
          {pct === 100 && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>}
        </div>
        {total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 500 }}>{completed}/{total}</span>
            <div style={{ width: 50, height: 4, background: "var(--bg)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#22c55e" : "var(--primary)", borderRadius: 2, transition: "width 0.3s" }} />
            </div>
          </div>
        )}
      </div>
      {flexible.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
          {flexible.map(e => {
            const done = e.completed;
            return (
              <div key={e.id} onClick={() => onOpenWorkout(e)}
                style={{ background: done ? "color-mix(in srgb, var(--primary) 15%, var(--bg))" : "var(--bg)", borderRadius: 8, padding: "0.3rem 0.6rem", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.35rem", cursor: "pointer", opacity: done ? 0.6 : 1, textDecoration: done ? "line-through" : "none", border: done ? "1px solid var(--primary)" : "1px solid transparent", maxWidth: "100%", overflow: "hidden", transition: "all 0.15s" }}>
                <div onClick={(ev) => { ev.stopPropagation(); onToggle(e); }}
                  style={{ width: 14, height: 14, borderRadius: "50%", border: done ? "1.5px solid var(--primary)" : "1.5px solid var(--border)", background: done ? "var(--primary)" : "transparent", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {done && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}
                </div>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.activity}{e.duration_minutes ? ` (${e.duration_minutes}m)` : ""}</span>
                <button onClick={ev => { ev.stopPropagation(); onDelete(e.id); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.65rem", padding: 0, lineHeight: 1, flexShrink: 0, opacity: 0.5 }}>✕</button>
              </div>
            );
          })}
        </div>
      )}
          <div className="calendar-grid">
        {DAYS.map((day, idx) => {
          const dayNum = (idx + 6) % 7;
          const dayEntries = fixed.filter(e => e.day_of_week === dayNum);
          const dayDone = dayEntries.filter(e => e.completed).length;
          const dayTotal = dayEntries.length;
          const cellDate = goalStartDate
            ? new Date(new Date(goalStartDate).getTime() + ((weekNum - 1) * 7 + idx) * 86400000)
            : null;
          const dateStr = cellDate ? `${cellDate.getDate()}/${cellDate.getMonth() + 1}` : "";
          const isToday = cellDate
            ? `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, "0")}-${String(cellDate.getDate()).padStart(2, "0")}` === TODAY_STR
            : false;
          return (
            <div key={day} className="calendar-day" style={{
              background: isToday ? "color-mix(in srgb, var(--primary) 10%, var(--bg))" : "var(--bg)",
              borderRadius: 10, padding: "0.5rem", minHeight: dayTotal > 0 ? "auto" : "3rem",
              border: isToday ? "1.5px solid var(--primary)" : "1.5px solid transparent",
              transition: "all 0.15s",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 700, color: isToday ? "var(--primary)" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{day}</div>
                {dayTotal > 0 && dayDone === dayTotal && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </div>
              {dateStr && <div style={{ fontSize: "0.6rem", color: isToday ? "var(--primary)" : "var(--text-muted)", marginBottom: "0.2rem" }}>{dateStr}</div>}
              {dayEntries.map(e => {
                const done = e.completed;
                return (
                  <div key={e.id} onClick={() => onOpenWorkout(e)}
                    style={{ fontSize: "0.73rem", lineHeight: 1.3, display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer", borderRadius: 5, padding: "2px 3px", marginBottom: "1px", background: done ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", textDecoration: done ? "line-through" : "none", opacity: done ? 0.5 : 1, transition: "all 0.15s" }}>
                    <div onClick={(ev) => { ev.stopPropagation(); onToggle(e); }}
                      style={{ width: 12, height: 12, borderRadius: "50%", border: done ? "1.5px solid var(--primary)" : "1.5px solid var(--border)", background: done ? "var(--primary)" : "transparent", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {done && <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>}
                    </div>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.activity}{e.duration_minutes ? ` · ${e.duration_minutes}m` : ""}</span>
                    <button onClick={ev => { ev.stopPropagation(); onDelete(e.id); }} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "0.6rem", padding: 0, lineHeight: 1, flexShrink: 0, opacity: 0.6 }}>✕</button>
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

function Overlay({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, padding: "1rem" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "16px 16px 0 0", padding: "1.5rem", width: "100%", maxWidth: wide ? 640 : 500, maxHeight: "90vh", overflowY: "auto", margin: "auto" }}>
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
