import { useState } from "react";
import { type Goal, type PlanEntry } from "../../api";
import { getCurrentWeek, DAYS } from "./shared";
import InsightsPanel from "./InsightsPanel";
import WorkoutLogger from "./WorkoutLogger";

interface Props {
  goal: Goal | null;
  entries: PlanEntry[];
  onToggle: (e: PlanEntry) => void;
  refresh: () => void;
}

export default function Calendar({ goal, entries, onToggle, refresh }: Props) {
  const [openedEntry, setOpenedEntry] = useState<PlanEntry | null>(null);

  if (!goal) return <p style={{ color: "var(--text-muted)" }}>Create a plan first with the AI Coach.</p>;

  const DOW = (new Date().getDay() + 6) % 7; // 0=Mon..6=Sun, same as db
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const currentWeek = getCurrentWeek(goal.start_date);
  const startDate = goal.start_date ? new Date(goal.start_date) : null;
  const weeks = [...new Set(entries.map(e => e.week_number))].sort((a, b) => a - b);

  function dayDate(weekNum: number, dayDow: number): string {
    if (!startDate) return "";
    const offset = (weekNum - 1) * 7 + dayDow;
    const d = new Date(startDate.getTime() + offset * 86400000);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  const todayList = entries.filter(e => e.week_number === currentWeek && (e.day_of_week === DOW || e.day_of_week === null));
  const doneToday = todayList.filter(e => e.completed).length;

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
          <ActivityCard key={e.id} e={e} onToggle={onToggle} onOpen={setOpenedEntry} />
        ))}
        {todayList.every(e => e.completed) && todayList.length > 0 && (
          <div style={{ fontSize: "0.88rem", fontWeight: 500, padding: "0.35rem 0.5rem", background: "rgba(255,255,255,0.15)", borderRadius: 8, marginTop: "0.4rem" }}>All done today 🎉</div>
        )}
      </div>

      <InsightsPanel goal={goal} onPlanUpdated={refresh} />

      {/* Weeks */}
      {weeks.map(weekNum => {
        const weekEntries = entries.filter(e => e.week_number === weekNum);
        const byDay: Record<number, PlanEntry[]> = {};
        for (const e of weekEntries) {
          if (e.day_of_week == null) continue;
          (byDay[e.day_of_week] ??= []).push(e);
        }
        const flexible = weekEntries.filter(e => e.day_of_week === null);
        return (
          <WeekSection key={weekNum} weekNum={weekNum} currentWeek={currentWeek}
            currentDate={dayDate}
            byDay={byDay} flexible={flexible} DOW={DOW}
            onToggle={onToggle} onOpen={setOpenedEntry} />
        );
      })}

      {/* Workout overlay */}
      {/* Workout logger */}
      {openedEntry && (
        <WorkoutLogger goal={goal} entry={openedEntry} onClose={() => { setOpenedEntry(null); refresh(); }} />
      )}
    </div>
  );
}

function WeekSection({ weekNum, currentWeek, currentDate, byDay, flexible, DOW, onToggle, onOpen }: {
  weekNum: number; currentWeek: number; currentDate: (wn: number, dow: number) => string;
  byDay: Record<number, PlanEntry[]>; flexible: PlanEntry[];
  DOW: number;
  onToggle: (e: PlanEntry) => void;
  onOpen: (e: PlanEntry) => void;
}) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700 }}>Week {weekNum}{weekNum === currentWeek ? " (current)" : ""}</h2>
      </div>

      <div className="calendar-grid">
        {DAYS.map((label, i) => {
          const day = (i + 6) % 7;
          const dayEntries = byDay[day] ?? [];
          const isToday = day === DOW && weekNum === currentWeek;
          const date = currentDate(weekNum, day);
          return (
            <div key={label} className="calendar-day" style={{
              background: isToday ? "color-mix(in srgb, var(--primary) 12%, var(--bg))" : "var(--bg)",
              borderRadius: 10, padding: "0.45rem",
              border: isToday ? "1.5px solid var(--primary)" : "1.5px solid transparent",
              minHeight: dayEntries.length ? "auto" : "2.5rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                <span style={{ fontSize: "0.66rem", fontWeight: 700, color: isToday ? "var(--primary)" : "var(--text-muted)", textTransform: "uppercase" }}>{label}</span>
                <span style={{ fontSize: "0.62rem", color: isToday ? "var(--primary)" : "var(--text-muted)" }}>{date}</span>
              </div>
              {dayEntries.map(e => (
                <ActivityCard key={e.id} e={e} onToggle={onToggle} onOpen={onOpen} compact />
              ))}
            </div>
          );
        })}
      </div>

      {flexible.length > 0 && (
        <div style={{ marginTop: "0.4rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {flexible.map(e => (
            <ActivityCard key={e.id} e={e} onToggle={onToggle} onOpen={onOpen} pill />
          ))}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  e: PlanEntry;
  onToggle: (e: PlanEntry) => void;
  onOpen: (e: PlanEntry) => void;
  compact?: boolean;
  pill?: boolean;
}

function ActivityCard({ e, onToggle, onOpen, compact, pill }: CardProps) {
  function handleClick(ev: React.MouseEvent) {
    ev.stopPropagation();
    onOpen(e);
  }

  const baseStyle = {
    background: compact || pill ? "var(--surface)" : undefined,
    borderRadius: compact ? 7 : pill ? 8 : 9,
    border: "1px solid var(--border)",
    padding: pill ? "0.25rem 0.55rem" : compact ? "0.3rem 0.45rem" : "0.45rem 0.6rem",
    fontSize: pill ? "0.72rem" : compact ? "0.7rem" : "0.78rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "flex-start",
    gap: "0.3rem",
    minWidth: 0,
  } as const;

  return (
    <div onClick={handleClick} style={baseStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
            {e.activity}
          </div>
          {e.exercises && e.exercises.length > 0 && (
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.1rem" }}>
              {e.exercises.length} exercises{e.duration_minutes ? ` · ~${e.duration_minutes}m` : ""}
            </div>
          )}
          {(!e.exercises || e.exercises.length === 0) && e.duration_minutes && (
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
              ~{e.duration_minutes}m
            </div>
          )}
        </div>
      <button onClick={(ev) => { ev.stopPropagation(); onToggle(e); }}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, marginTop: "0.1rem" }}>
        <svg width={pill ? 12 : 14} height={pill ? 12 : 14} viewBox="0 0 24 24" style={{ display: "block" }}>
          <circle cx="12" cy="12" r="10" fill="none" stroke={e.completed ? "var(--primary)" : "var(--border)"} strokeWidth="2" />
          {e.completed && <path d="M8 12l3 3 5-6" stroke="var(--primary)" strokeWidth="2" fill="none" />}
        </svg>
      </button>
    </div>
  );
}


