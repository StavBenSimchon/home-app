import { useEffect, useState } from "react";
import { api, type CoachAction, type CoachMessage, type Goal } from "../../api.ts";
import { SPINNER, s } from "./shared";

interface Props {
  goal: Goal | null;
  onPlanUpdated: () => void;
}

export default function AICoach({ goal, onPlanUpdated }: Props) {
  // If no goal yet: onboarding intake
  if (!goal) return <Onboarding onComplete={onPlanUpdated} />;
  // If goal: coach that refines with data + insights
  return <CoachChat goal={goal} onPlanUpdated={onPlanUpdated} />;
}

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [input, setInput] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<"describe" | "questions" | "generating" | "done">("describe");
  const [error, setError] = useState("");

  async function handleStart() {
    if (!input.trim()) return;
    setError("");
    setPhase("questions");
    try {
      const res = await api.generateQuestions(input);
      setQuestions(res.questions);
      setIdx(0);
      setAnswers([]);
      setAnswer("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function handleAnswer() {
    if (!answer.trim()) return;
    const updated = [...answers, { q: questions[idx], a: answer }];
    setAnswers(updated);
    setAnswer("");
    if (idx + 1 < questions.length) setIdx(idx + 1);
    else { generate(updated); }
  }

  async function generate(qa: { q: string; a: string }[]) {
    setPhase("generating");
    try {
      await api.generatePlan(input, qa.map(x => ({ question: x.q, answer: x.a })));
      setPhase("done");
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("questions");
    }
  }

  return (
    <div>
      <div style={{ ...s.card, marginBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "1.1rem" }}>🧠</span>
          <span style={{ fontWeight: 600 }}>AI Coach</span>
        </div>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Describe your goal — I'll build a personalized plan, put it on your calendar, and keep improving it as you progress.
        </p>
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
          placeholder="e.g. Lose body fat from 25% to 15% while building muscle, training 4x/week"
          style={{ ...s.input, resize: "vertical", marginTop: "0.5rem", lineHeight: 1.5 }} />
        {phase === "describe" || phase === "questions" ? (
          <button onClick={handleStart} disabled={!input.trim()}
            style={{ ...s.btnPrimary, marginTop: "0.6rem", opacity: !input.trim() ? 0.6 : 1 }}>
            {phase === "describe" ? "Let's go →" : "Restart questions"}
          </button>
        ) : null}
        {error && <p style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.4rem" }}>{error}</p>}
      </div>

      {phase === "questions" && questions.length > 0 && (
        <div style={{ ...s.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Question {idx + 1} of {questions.length}</span>
          </div>
          <div style={{ background: "var(--bg)", borderRadius: 8, padding: "0.7rem", marginBottom: "0.6rem", fontSize: "0.9rem", lineHeight: 1.5 }}>{questions[idx]}</div>
          {answers.map((qa, i) => (
            <p key={i} style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.2rem" }}>
              <span style={{ color: "var(--primary)" }}>You:</span> {qa.a}
            </p>
          ))}
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
            <input value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Your answer…"
              style={{ ...s.input, marginTop: 0 }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAnswer(); } }} />
            <button onClick={handleAnswer} disabled={!answer.trim()} style={{ ...s.btnPrimary, opacity: !answer.trim() ? 0.6 : 1 }}>Next</button>
          </div>
        </div>
      )}

      {phase === "generating" && (
        <div style={{ ...s.card, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "2.5rem" }}>
          {SPINNER} <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Building your plan…</span>
        </div>
      )}

      {phase === "done" && (
        <div style={{ ...s.card, textAlign: "center", color: "#22c55e", fontWeight: 600 }}>
          Plan created — check your Calendar! ✓
        </div>
      )}
    </div>
  );
}

function CoachChat({ goal, onPlanUpdated }: { goal: Goal; onPlanUpdated: () => void }) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [applying, setApplying] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api.coachHistory(goal.id)
      .then((h: { role: string; text: string }[]) => setMessages(h as unknown as CoachMessage[]))
      .catch(() => {});
  }, [goal.id]);

  async function handleSend(text: string) {
    if (!text.trim() || pending) return;
    setInput("");
    const history = messages.slice(-12).map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, { role: "user", text }]);
    setPending(true);
    try {
      const res = await api.coachChat(goal.id, text, history as { role: string; text: string }[]);
      const newMsg: CoachMessage = {
        role: "assistant",
        text: res.message ?? "(no reply)",
        action: res.action ?? null,
      };
      setMessages(prev => [...prev, newMsg]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", text: e instanceof Error ? e.message : String(e) }]);
    }
    setPending(false);
  }

  async function handleApply(idx: number, action: CoachAction) {
    setApplying(prev => ({ ...prev, [idx]: true }));
    try {
      await api.coachApply(goal.id, action);
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, action: null, text: m.text } : m));
      onPlanUpdated();
    } catch { /* keep action */ }
    setApplying(prev => ({ ...prev, [idx]: false }));
  }

  async function handleFinalize() {
    const history = messages.slice(-12).map(m => ({ role: m.role, text: m.text }));
    setPending(true);
    try {
      const res = await api.coachFinalize(goal.id, "finalize", history as { role: string; text: string }[]);
      if (res && (res as { type?: string }).type === "finalized") onPlanUpdated();
    } catch { /* ignore */ }
    setPending(false);
  }

  useEffect(() => {
    api.generateInsights(goal.id).catch(() => {});
  }, [goal.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 180px)" }}>
      <div style={{ ...s.card, flex: 1, display: "flex", flexDirection: "column", minHeight: 0, marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ fontSize: "1.1rem" }}>🧠</span>
            <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>AI Coach</span>
          </div>
          <button onClick={handleFinalize} disabled={pending} style={{ ...s.btnSmall, opacity: pending ? 0.5 : 1 }}>Finalize plan</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.6rem" }}>
          {messages.length === 0 && (
            <div style={{ background: "var(--bg)", borderRadius: 8, padding: "0.75rem", fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              I'm your coach — I've analyzed your latest workouts, measurements, and schedule. Tell me what to change, or ask anything about your plan.
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
                {["Make workouts shorter", "Replace bench press", "I can train only 3x this week", "Add another walk", "No cable machine anymore"].map(t => (
                  <button key={t} onClick={() => handleSend(t)} style={{ ...s.btnSmall, fontSize: "0.72rem" }}>{t}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              background: m.role === "user" ? "var(--primary)" : "var(--bg)",
              color: m.role === "user" ? "#fff" : "var(--text)",
              borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              padding: "0.45rem 0.75rem", fontSize: "0.82rem", maxWidth: "88%", lineHeight: 1.55, whiteSpace: "pre-wrap",
            }}>
              {m.text}
              {m.action && (
                <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ fontSize: "0.72rem", opacity: 0.85 }}>Suggested change: <code style={{ background: "rgba(0,0,0,0.25)", padding: "1px 5px", borderRadius: 4 }}>{m.action.type}</code></div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button onClick={() => handleApply(i, m.action!)} disabled={applying[i]}
                      style={{ background: "#22c55e", color: "#052005", border: "none", borderRadius: 6, padding: "0.3rem 0.6rem", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", opacity: applying[i] ? 0.5 : 1 }}>
                      {applying[i] ? "Applying…" : "Apply ✓"}
                    </button>
                    <button onClick={() => setMessages(prev => prev.map((msg, j) => j === i ? { ...msg, action: null } : msg))}
                      style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "0.3rem 0.6rem", fontSize: "0.72rem", cursor: "pointer" }}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {pending && (
            <div style={{ alignSelf: "flex-start", background: "var(--bg)", borderRadius: "12px 12px 12px 4px", padding: "0.4rem 0.7rem", display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {SPINNER} Thinking…
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.4rem", marginTop: "auto" }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Tell your coach what to change…"
            style={{ ...s.input, marginTop: 0 }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSend(input); } }} />
          <button onClick={() => handleSend(input)} disabled={!input.trim() || pending}
            style={{ ...s.btnPrimary, opacity: !input.trim() || pending ? 0.6 : 1 }}>Send</button>
        </div>
      </div>
    </div>
  );
}
