import { useState } from "react";
import { api, type Goal, type PlanEntry, type AIInsight } from "../../api";
import { ActivityRow, getCurrentWeek, DAYS } from "./shared";
import Workout from "./Workout";

interface Props {
  goal: Goal | null;
  entries: PlanEntry[];
  onToggle: (e: PlanEntry) => void;
  refresh: () => void;
}

export default function Calendar({ goal, entries, onToggle, refresh }: Props) {
  const [openedEntry, setOpenedEntry] = useState<PlanEntry | null>(null);
  const [insight, setInsight] = useState<AIInsight | null>(null);

  if (!goal) return <p style={{ color: "var(--text-muted)" }}>Create a plan first with the AI Coach.</p>;

  const week = getCurrentWeek(goal.start_date);
  const weekEntries = entries.filter(e => e.week_number === week);
  const byDay: Record<number, PlanEntry[]> = {};
  for (const e of weekEntries) {
    const day = e.day_of_week;
    if (day === null) continue;
    (byDay[day] ??= []).push(e);
  }
  const flexible = weekEntries.filter(e => e.day_of_week === null);

  const DOW = (new Date().getDay() + 6) % 7;
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const todayList = weekEntries.filter(e => e.day_of_week === DOW || e.day_of_week === null);
  const doneToday = todayList.filter(e => e.completed).length;

  async function handleInsight() {
    if (!goal) return;
    const r = await api.generateInsights(goal.id);
    setInsight(r.insights[0] ?? null);
    const open = await api.listInsights(goal.id, "open");
    if (open.length && !r.insights.length) setInsight(open[0]);
  }

  return (
    <div>
      {/* Today */}
      <div style={{ background: "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 75%, #000))", borderRadius: 14, padding: "1.1rem", color: "#fff", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "0.72rem", opacity: 0.8, textTransform: "uppercase" }}>Today</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{dateStr}</div>
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{doneToday}/{todayList.length}</div>
        </div>
        {todayList.length === 0 && <div style={{ fontSize: "0.85rem", opacity: 0.85 }}>Rest day.</div>}
        {todayList.map(e => (
          <div key={e.id} onClick={() => {
            if (e.exercises && e.exercises.length > 0) setOpenedEntry(e);
            else onToggle(e);
          }} style={{ cursor: "pointer" }}>
            <ActivityRow e={e} onToggle={onToggle} onOpen={(ent) => setOpenedEntry(ent)} />
          </div>
        ))}
        {todayList.every(e => e.completed) && todayList.length > 0 && (
          <div style={{ fontSize: "0.88rem", fontWeight: 500, padding: "0.35rem 0.5rem", background: "rgba(255,255,255,0.15)", borderRadius: 8, marginTop: "0.4rem" }}>All done today 🎉</div>
        )}
      </div>

      {insight && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "0.75rem 0.9rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.3rem" }}>
            <span>🧠</span><span style={{ fontSize: "0.82rem", fontWeight: 600 }}>AI Insight</span>
            <button onClick={() => setInsight(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.7rem" }}>✕</button>
          </div>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{insight.body}</p>
        </div>
      )}

      {/* Week */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Week {week}</h2>
        <button onClick={handleInsight} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, padding: "0.2rem 0.6rem", fontSize: "0.75rem", color: "var(--text)", cursor: "pointer" }}>🧠 Check</button>
      </div>

      <div className="calendar-grid">
        {DAYS.map((label, i) => {
          const day = (i + 6) % 7;
          const dayEntries = byDay[day] ?? [];
          const done = dayEntries.filter(e => e.completed).length;
          const isToday = day === DOW;
          return (
            <div key={label} className="calendar-day" style={{
              background: isToday ? "color-mix(in srgb, var(--primary) 12%, var(--bg))" : "var(--bg)",
              borderRadius: 10, padding: "0.45rem",
              border: isToday ? "1.5px solid var(--primary)" : "1.5px solid transparent",
              minHeight: dayEntries.length ? "auto" : "2.5rem",
            }}>
              <div style={{ fontSize: "0.66rem", fontWeight: 700, color: isToday ? "var(--primary)" : "var(--text-muted)", textTransform: "uppercase", marginBottom: "0.2rem" }}>{label}</div>
              {dayEntries.map(e => (
                <div key={e.id} onClick={() => setOpenedEntry(e)} style={{
                  fontSize: "0.7rem", lineHeight: 1.25, display: "flex", alignItems: "center", gap: "0.2rem",
                  borderRadius: 5, padding: "2px 3px", cursor: "pointer",
                  opacity: e.completed ? 0.55 : 1, textDecoration: e.completed ? "line-through" : "none",
                  background: e.completed ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent",
                }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.activity}{e.duration_minutes ? ` · ${e.duration_minutes}m` : ""}</span>
                </div>
              ))}
              {dayEntries.length > 0 && done === dayEntries.length && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
              )}
            </div>
          );
        })}
      </div>

      {flexible.length > 0 && (
        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {flexible.map(e => (
            <div key={e.id} onClick={() => setOpenedEntry(e)} style={{
              background: e.completed ? "color-mix(in srgb, var(--primary) 15%, var(--bg))" : "var(--bg)",
              borderRadius: 8, padding: "0.25rem 0.55rem", fontSize: "0.72rem", cursor: "pointer",
              textDecoration: e.completed ? "line-through" : "none", opacity: e.completed ? 0.6 : 1,
              border: e.completed ? "1px solid var(--primary)" : "1px solid var(--border)",
            }}>
              <span>{e.activity}{e.duration_minutes ? ` (${e.duration_minutes}m)` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Workout overlay */}
      {openedEntry && goal && <Workout entry={openedEntry} goal={goal} onClose={() => { setOpenedEntry(null); refresh(); }} />}
    </div>
  );
}
