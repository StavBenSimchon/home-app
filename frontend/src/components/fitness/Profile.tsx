import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Goal, type WeightEntry } from "../../api";
import { s } from "./shared";

interface Props { goal: Goal | null; onGoalChanged: () => void }

export default function Profile({ goal, onGoalChanged }: Props) {
  const navigate = useNavigate();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: goal?.title ?? "", description: goal?.description ?? "",
    metric_name: goal?.metric_name ?? "", unit: goal?.unit ?? "",
    current_value: goal?.current_value?.toString() ?? "", target_value: goal?.target_value?.toString() ?? "",
  });

  const load = useCallback(async () => {
    try {
      setGoals(await api.listGoals());
      setWeights(await api.listWeight());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (goal) setForm({
      title: goal.title, description: goal.description ?? "",
      metric_name: goal.metric_name ?? "", unit: goal.unit ?? "",
      current_value: goal.current_value?.toString() ?? "", target_value: goal.target_value?.toString() ?? "",
    });
  }, [goal?.id]);

  async function handleSave() {
    if (!goal || !form.title) return;
    await api.updateGoal(goal.id, {
      title: form.title, description: form.description || null,
      metric_name: form.metric_name || null, unit: form.unit || null,
      current_value: form.current_value ? Number(form.current_value) : null,
      target_value: form.target_value ? Number(form.target_value) : null,
    });
    setEditing(false);
    onGoalChanged();
  }

  const latest = [...weights].sort((a, b) => b.measured_at.localeCompare(a.measured_at))[0];

  return (
    <div>
      {/* Other apps */}
      <button onClick={() => navigate("/settle-up")} style={{ ...s.btnSecondary, width: "100%", marginBottom: "1rem", textAlign: "left" }}>
        💰 Settle Up →
      </button>

      {/* Goal card */}
      {goal && (
        <div style={{ ...s.card, marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{goal.title}</div>
              {goal.description && <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>{goal.description}</div>}
            </div>
            <button onClick={() => setEditing(!editing)} style={s.btnSmall}>{editing ? "Cancel" : "Edit"}</button>
          </div>

          {editing ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
              <label style={s.label}>Title<input style={s.input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
              <label style={s.label}>Metric<input style={s.input} value={form.metric_name} onChange={e => setForm({ ...form, metric_name: e.target.value })} /></label>
              <label style={s.label}>Current<input style={s.input} type="number" value={form.current_value} onChange={e => setForm({ ...form, current_value: e.target.value })} /></label>
              <label style={s.label}>Target<input style={s.input} type="number" value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })} /></label>
              <label style={s.label}>Unit<input style={s.input} value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
              <label style={s.label}>Description<input style={s.input} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
              <button onClick={handleSave} style={{ ...s.btnPrimary, gridColumn: "1 / -1" }}>Save</button>
            </div>
          ) : (
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              {goal.metric_name && <div>{goal.metric_name}: {goal.current_value ?? "?"}{goal.unit}</div>}
              {goal.target_value != null && <div>Target: {goal.target_value}{goal.unit}</div>}
              {goal.start_date && <div>Started: {goal.start_date}</div>}
            </div>
          )}
          {goal.target_value != null && goal.current_value != null && (
            <div style={{ background: "var(--bg)", borderRadius: 8, height: 6, marginTop: "0.75rem", overflow: "hidden" }}>
              <div style={{
                width: `${Math.min(Math.round(((goal.current_value - (goal.target_value ?? 0)) / (goal.current_value || 1)) * 100), 100)}%`,
                height: "100%", background: "var(--primary)", borderRadius: 8,
              }} />
            </div>
          )}
        </div>
      )}

      {/* Body measurements summary */}
      {latest && (
        <div style={{ ...s.card, marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Latest measurement · {latest.measured_at}</div>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <div><div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{latest.weight_kg} kg</div><div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Weight</div></div>
            {latest.fat_percentage != null && (
              <div><div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{latest.fat_percentage}%</div><div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Fat</div></div>
            )}
            {latest.muscle_percentage != null && (
              <div><div style={{ fontSize: "1.3rem", fontWeight: 700 }}>{latest.muscle_percentage}%</div><div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Muscle</div></div>
            )}
          </div>
        </div>
      )}

      {goals.length > 1 && (
        <div>
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Other goals</div>
          {goals.filter(g => g.id !== goal?.id).map(g => (
            <div key={g.id} style={{ ...s.card, marginBottom: "0.5rem", padding: "0.65rem 0.9rem" }}>
              <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{g.title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
