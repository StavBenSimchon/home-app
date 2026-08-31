import { useCallback, useEffect, useState } from "react";
import { api, type Goal, type PlanEntry } from "../../api";
import AICoach from "./AICoach";
import Calendar from "./Calendar";
import Workout from "./Workout";
import Progress from "./Progress";
import Profile from "./Profile";

const TABS = [
  { id: "calendar", label: "Calendar", icon: "📅" },
  { id: "workout", label: "Workout", icon: "🏋️" },
  { id: "progress", label: "Progress", icon: "📈" },
  { id: "coach", label: "AI Coach", icon: "🧠" },
  { id: "profile", label: "Profile", icon: "👤" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function Fitness() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [goal, setGoal] = useState<Goal | null>(null);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const goalId = goal?.id ?? null;
  const hasGoal = Boolean(goalId);

  const loadGoal = useCallback(async () => {
    try {
      const goals = await api.listGoals();
      const g = goals[0] ?? null;
      setGoal(g);
    } catch { setGoal(null); }
    setLoading(false);
  }, []);

  const loadEntries = useCallback(async (id: string | null) => {
    if (!id) { setEntries([]); return; }
    try { setEntries(await api.listPlanEntries(id)); } catch { setEntries([]); }
  }, []);

  useEffect(() => { loadGoal(); }, [loadGoal]);
  useEffect(() => { if (goalId) loadEntries(goalId); }, [goalId, loadEntries]);

  function refresh() {
    if (goalId) loadEntries(goalId);
  }

  async function handleToggle(entry: PlanEntry) {
    if (!goalId) return;
    await api.updatePlanEntry(goalId, entry.id, { completed: !entry.completed });
    refresh();
  }

  const sharedProps = { goal: goal as Goal | null, entries, refresh, onToggle: handleToggle };

  if (!hasGoal && !loading) {
    return (
      <main className="responsive-container">
        <PageHeader />
        <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center", padding: "5rem 1rem" }}>
          <div style={{ fontSize: "2.75rem", marginBottom: "0.5rem" }}>🧠</div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Meet your AI Coach</h1>
          <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", lineHeight: 1.6, fontSize: "0.95rem" }}>
            Answer a few questions and your coach builds a personalized plan, schedules it on your calendar,
            and adjusts it as you progress.
          </p>
          <button onClick={() => setTab("coach")}
            style={{ background: "var(--primary)", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem 1.5rem", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer" }}>
            Start onboarding →
          </button>
          <TabBar current={tab} onChange={setTab} />
        </div>
        <div className="fitness-content" style={{ display: "none" }}>
          {tab === "coach" && <AICoach goal={goal} onPlanUpdated={refresh} />}
        </div>
      </main>
    );
  }

  return (
    <main className="responsive-container" style={{ paddingBottom: "4.5rem" }}>
      <PageHeader />
      <div className="fitness-content">
        {tab === "calendar" && <Calendar {...sharedProps} />}
        {tab === "workout" && (goal ? <Workout goal={goal} onDone={refresh} /> : <p style={{ color: "var(--text-muted)", padding: "2rem" }}>Create a plan first.</p>)}
        {tab === "progress" && <Progress goal={goal} />}
        {tab === "coach" && <AICoach goal={goal} onPlanUpdated={refresh} />}
        {tab === "profile" && <Profile goal={goal} onGoalChanged={() => { loadGoal(); refresh(); }} />}
      </div>
      <TabBar current={tab} onChange={setTab} />
    </main>
  );

  function PageHeader() {
    return (
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 700 }}>Fitness</h1>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
          {goal ? goal.title : "Your AI-powered coach"}
        </p>
      </div>
    );
  }

  function TabBar({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
    return (
      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "var(--surface)", borderTop: "1px solid var(--border)",
        display: "flex", justifyContent: "space-around",
        padding: "0.45rem 0", zIndex: 90,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "0.1rem",
              fontSize: "0.65rem", color: current === t.id ? "var(--primary)" : "var(--text-muted)",
              fontWeight: current === t.id ? 600 : 400,
            }}>
            <span style={{ fontSize: "1.2rem" }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    );
  }
}
