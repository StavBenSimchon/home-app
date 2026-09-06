import { useCallback, useEffect, useState } from "react";
import { api, type AIInsight, type PlanEntry, type ProgressData } from "../../api";

const SPINNER = (
  <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, animation: "spin 0.8s linear infinite", verticalAlign: "middle" }}>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
  </svg>
);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NOW = new Date();
const TODAY_DOW_DB = (NOW.getDay() + 6) % 7; // 0=Mon..6=Sun
const TODAY_DATE = `${NOW.getDate()}/${NOW.getMonth() + 1}`;

function getCurrentWeek(startDate: string | null): number {
  if (!startDate) return 1;
  const [y, m, d] = startDate.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((todayMidnight.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

export { DAYS, NOW, TODAY_DOW_DB, TODAY_DATE, getCurrentWeek, SPINNER };

export const s = {
  card: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem" } as const,
  btnPrimary: { background: "var(--primary)", color: "#fff", border: "none", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" } as const,
  btnSecondary: { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" } as const,
  btnSmall: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0.55rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer", color: "var(--text)" } as const,
  input: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.55rem 0.75rem", color: "var(--text)", fontSize: "0.85rem", width: "100%", marginTop: "0.25rem" } as const,
  label: { fontSize: "0.82rem", color: "var(--text-muted)", display: "flex", flexDirection: "column" as const },
};

/** Hook handling entries loading for fitness screens. */
export function useFitnessData(goalId: string | null) {
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!goalId) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    try {
      const list = await api.listPlanEntries(goalId);
      setEntries(list);
    } catch { setEntries([]); }
    setLoading(false);
  }, [goalId]);

  useEffect(() => { refresh(); }, [refresh]);

  const summary = useCallback(() => ({
    today: entries.filter(e => e.day_of_week === TODAY_DOW_DB && e.week_number === getCurrentWeek(null)),
    week: getCurrentWeek(null),
  }), [entries]);

  return { entries, insight, setInsight, progress, setProgress, loading, refresh, summary };
}

export function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        width: 20, height: 20, borderRadius: "50%",
        border: on ? "2px solid var(--primary)" : "2px solid var(--border)",
        background: on ? "var(--primary)" : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, cursor: "pointer", transition: "all 0.15s",
      }}>
      {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M20 6L9 17l-5-5" /></svg>}
    </div>
  );
}

export function ActivityRow({ e, onToggle, onOpen }: { e: PlanEntry; onToggle: (e: PlanEntry) => void; onOpen: (e: PlanEntry) => void }) {
  return (
    <div onClick={() => onOpen(e)}
      style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.75rem", background: "var(--bg)", borderRadius: 10, cursor: "pointer", marginBottom: "0.35rem" }}>
      <ToggleSwitch on={e.completed} onToggle={() => onToggle(e)} />
      <span style={{ fontSize: "0.9rem", flex: 1, textDecoration: e.completed ? "line-through" : "none", opacity: e.completed ? 0.6 : 1 }}>{e.activity}</span>
      {e.duration_minutes && <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{e.duration_minutes}m</span>}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M9 18l6-6-6-6" /></svg>
    </div>
  );
}
