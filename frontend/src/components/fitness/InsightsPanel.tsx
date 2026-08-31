import { useCallback, useEffect, useState } from "react";
import { api, type AIInsight, type Goal, type InsightWindow } from "../../api";
import { SPINNER, s } from "./shared";

const TONE: Record<string, { color: string; icon: string }> = {
  good: { color: "#22c55e", icon: "✅" },
  watch: { color: "#eab308", icon: "👀" },
  warning: { color: "#ef4444", icon: "⚠️" },
  info: { color: "var(--primary)", icon: "🧠" },
};

const ACTION_LABEL: Record<string, string> = {
  keep: "keep",
  increase_load: "add load",
  increase_reps: "add reps",
  swap: "swap it",
  deload: "deload",
};

export default function InsightsPanel({ goal, onPlanUpdated }: { goal: Goal; onPlanUpdated: () => void }) {
  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [applyStatus, setApplyStatus] = useState("");

  // show the most recent analysis if one exists (no AI call)
  const loadExisting = useCallback(async () => {
    try {
      const open = await api.listInsights(goal.id, "open");
      const analysis = open.find(i => i.kind === "analysis" && i.payload);
      if (analysis) setInsight(analysis);
    } catch { /* ignore */ }
  }, [goal.id]);

  useEffect(() => { loadExisting(); }, [loadExisting]);

  async function run(force: boolean) {
    setLoading(true);
    setError("");
    setApplyStatus("");
    try {
      setInsight(await api.analyzeInsights(goal.id, force));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function applyTargets() {
    if (!insight || applying) return;
    setApplying(true);
    setError("");
    try {
      const result = await api.applyProgression(goal.id, insight.id);
      setInsight(result.insight);
      setApplyStatus(
        result.already_applied
          ? `Week ${result.week_number} targets were already applied.`
          : `Updated ${result.updated} exercises in week ${result.week_number}.`
      );
      onPlanUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setApplying(false);
  }

  const payload = insight?.payload ?? null;
  const tone = TONE[insight?.severity ?? "info"] ?? TONE.info;
  const m7 = payload?.metrics?.last_7_days;
  const m14 = payload?.metrics?.last_14_days;
  const targets = payload?.progression_targets ?? [];
  const applied = Boolean(payload?.progression_applied_at);

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: insight || error ? "0.6rem" : 0 }}>
        <button onClick={() => run(false)} disabled={loading}
          style={{ ...s.btnSecondary, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.35rem", opacity: loading ? 0.6 : 1 }}>
          {loading ? <>{SPINNER} Analysing…</> : "🧠 Insights"}
        </button>
        {insight && !loading && (
          <button onClick={() => run(true)} style={{ ...s.btnSmall }} title="Run a fresh analysis">↻ Refresh</button>
        )}
        {insight?.created_at && !loading && (
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            {new Date(insight.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            {payload?.source === "rules" ? " · offline analysis" : ""}
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: "color-mix(in srgb, #ef4444 15%, var(--surface))", border: "1px solid #ef4444", borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: "0.78rem" }}>
          ⚠️ {error}
        </div>
      )}

      {applyStatus && !error && (
        <div style={{ background: "color-mix(in srgb, #22c55e 15%, var(--surface))", border: "1px solid #22c55e", borderRadius: 8, padding: "0.5rem 0.7rem", fontSize: "0.78rem", marginBottom: "0.6rem" }}>
          ✓ {applyStatus}
        </div>
      )}

      {payload && !error && (
        <div style={{ ...s.card, borderLeft: `3px solid ${tone.color}`, padding: "0.9rem 1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.35rem" }}>
            <span>{tone.icon}</span>
            <span style={{ fontWeight: 700, fontSize: "0.92rem" }}>{payload.headline}</span>
          </div>

          <p style={{ fontSize: "0.84rem", lineHeight: 1.6, marginBottom: "0.6rem" }}>{payload.assessment}</p>

          {(m7 || m14) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.7rem" }}>
              {m7 && <WindowBox label="Last 7 days" w={m7} />}
              {m14 && <WindowBox label="Last 14 days" w={m14} />}
            </div>
          )}

          {payload.observations.length > 0 && (
            <Section title="What I see">
              {payload.observations.map((o, i) => <Bullet key={i} text={o} />)}
            </Section>
          )}

          {payload.recommendations.length > 0 && (
            <Section title="What to do">
              {payload.recommendations.map((r, i) => <Bullet key={i} text={r} marker="→" color="var(--primary)" />)}
            </Section>
          )}

          {payload.exercise_notes.length > 0 && (
            <Section title="Exercises">
              {payload.exercise_notes.map((n, i) => (
                <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", fontSize: "0.8rem", padding: "0.15rem 0" }}>
                  <span style={{
                    background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5,
                    padding: "0.1rem 0.35rem", fontSize: "0.68rem", whiteSpace: "nowrap", textTransform: "uppercase",
                    color: n.action === "swap" || n.action === "deload" ? "#ef4444" : "var(--text-muted)",
                  }}>
                    {ACTION_LABEL[n.action] ?? n.action}
                  </span>
                  <span><strong>{n.exercise}</strong>{n.note ? ` — ${n.note}` : ""}</span>
                </div>
              ))}
            </Section>
          )}

          {targets.length > 0 && (
            <Section title={`Week ${payload.progression_week} targets`}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.55rem" }}>
                {targets.map((target, i) => (
                  <div key={`${target.exercise}-${i}`} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.45rem 0.55rem" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.8rem" }}>{target.exercise}</strong>
                      <span style={{ fontSize: "0.67rem", color: target.decision === "deload" ? "#ef4444" : "var(--primary)", textTransform: "uppercase" }}>
                        {ACTION_LABEL[target.decision] ?? target.decision}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.76rem", marginTop: "0.2rem" }}>
                      {target.current_weight_kg != null ? `${target.current_weight_kg} kg` : "No logged load"}
                      <span style={{ color: "var(--text-muted)" }}> → </span>
                      <strong>{target.target_weight_kg != null ? `${target.target_weight_kg} kg` : "bodyweight"}</strong>
                      {target.reps_min != null && (
                        <span style={{ color: "var(--text-muted)" }}>
                          {` · ${target.reps_min}${target.reps_max && target.reps_max !== target.reps_min ? `–${target.reps_max}` : ""} reps`}
                        </span>
                      )}
                      {target.rir_target != null && <span style={{ color: "var(--text-muted)" }}>{` · RIR ${target.rir_target}`}</span>}
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.4, marginTop: "0.15rem" }}>{target.reason}</div>
                  </div>
                ))}
              </div>
              <button onClick={applyTargets} disabled={applying || applied}
                style={{
                  ...(applied ? s.btnSecondary : s.btnPrimary), width: "100%", padding: "0.55rem",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem",
                  opacity: applying || applied ? 0.65 : 1,
                }}>
                {applying ? <>{SPINNER} Applying…</> : applied ? "✓ Applied to next week" : "Apply next-week targets"}
              </button>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function WindowBox({ label, w }: { label: string; w: InsightWindow }) {
  const body = w.body_change ?? {};
  return (
    <div style={{ background: "var(--bg)", borderRadius: 8, padding: "0.5rem 0.6rem" }}>
      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontSize: "0.74rem", lineHeight: 1.6 }}>
        <div>{w.workouts_logged} workouts · {w.sets_logged} sets</div>
        <div>{w.total_volume_kg.toLocaleString()} kg volume</div>
        {w.adherence_pct != null && <div>{w.adherence_pct.toFixed(0)}% adherence</div>}
        {w.avg_rir != null && <div>avg RIR {w.avg_rir}{w.failure_sets ? ` · ${w.failure_sets} to failure` : ""}</div>}
        {body.weight_kg != null && (
          <div>
            weight {body.weight_kg > 0 ? "+" : ""}{body.weight_kg} kg
            {body.fat_kg != null ? ` · fat ${body.fat_kg > 0 ? "+" : ""}${body.fat_kg} kg` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "0.55rem" }}>
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.2rem" }}>{title}</div>
      {children}
    </div>
  );
}

function Bullet({ text, marker = "•", color = "var(--text-muted)" }: { text: string; marker?: string; color?: string }) {
  return (
    <div style={{ display: "flex", gap: "0.4rem", fontSize: "0.8rem", lineHeight: 1.55, padding: "0.1rem 0" }}>
      <span style={{ color, flexShrink: 0 }}>{marker}</span>
      <span>{text}</span>
    </div>
  );
}
