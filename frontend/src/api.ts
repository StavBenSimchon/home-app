const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch {
    throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(body.detail as string ?? `Request failed (${res.status})`);
  return body as T;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  metric_name: string | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  ai_response?: Record<string, unknown> | null;
}

export interface Exercise {
  id: string;
  plan_entry_id: string;
  name: string;
  sets: number | null;
  reps: number | null;
  weight: number | null;
  duration_seconds: number | null;
  order_index: number;
  completed: boolean;
  notes: string | null;
  created_at: string;
  reps_max?: number | null;
  rir_target?: number | null;
}

export interface PlanEntry {
  id: string;
  goal_id: string;
  week_number: number;
  day_of_week: number | null;
  activity: string;
  duration_minutes: number | null;
  notes: string | null;
  frequency_hint: string | null;
  completed: boolean;
  created_at: string;
  exercises?: Exercise[];
}

export interface WeightEntry {
  id: string;
  weight_kg: number;
  fat_percentage: number | null;
  muscle_percentage: number | null;
  measured_at: string;
  created_at: string;
}

// ---------- Fitness types (matching backend schemas) ----------

export interface SetLog {
  id?: string;
  session_id?: string;
  exercise_id: string;
  set_number: number;
  weight?: number | null;
  reps?: number | null;
  rir?: number | null;
  completed?: boolean;
}

export interface WorkoutSession {
  id: string;
  goal_id: string;
  plan_entry_id: string | null;
  activity_name: string;
  performed_at: string;
  duration_minutes: number | null;
  status: "in_progress" | "completed";
  set_logs: SetLog[];
  exercise_logs: WorkoutExerciseSnapshot[];
}

export interface WorkoutExerciseSnapshot {
  id: string;
  session_id: string;
  source_exercise_id: string | null;
  exercise_name: string;
  performed_at: string;
  completed_at: string | null;
  set_logs: SetLog[];
}

export interface PreviousSet {
  set_number: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
}

export interface PreviousPerformance {
  exercise_id: string;
  performed_at: string;
  sets: PreviousSet[];
}

export interface LoggedSet {
  set_number: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  failure: boolean;
}

export interface ExerciseLogItem {
  id: string;
  session_id: string;
  source_exercise_id: string | null;
  exercise_name: string;
  activity: string;
  performed_at: string;
  sets: LoggedSet[];
  top_weight: number | null;
  total_reps: number;
  failure_sets: number[];
}

export interface ExerciseLogEdit {
  performed_at?: string;
  exercise_name?: string;
  sets?: { set_number: number; weight: number | null; reps: number | null; rir: number | null }[];
}

export interface CoachMessage {
  role: "user" | "assistant";
  text: string;
}

export interface CoachResponse {
  type: "message";
  message: string;
}

export interface PlanSummary {
  weeks: number;
  activities: number;
  exercises: number;
}

export interface ExerciseNote {
  exercise: string;
  note: string;
  action: "keep" | "increase_load" | "increase_reps" | "swap" | "deload" | string;
}

export interface ProgressionTarget {
  exercise: string;
  week_number: number;
  decision: "keep" | "increase_load" | "increase_reps" | "swap" | "deload" | string;
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  reps_min: number | null;
  reps_max: number | null;
  rir_target: number | null;
  reason: string;
}

export interface InsightWindow {
  days: number;
  workouts_logged: number;
  sets_logged: number;
  total_volume_kg: number;
  failure_sets: number;
  avg_rir: number | null;
  planned_activities: number;
  completed_activities: number;
  adherence_pct: number | null;
  measurements: number;
  body_change: Record<string, number>;
}

export interface InsightPayload {
  severity: string;
  headline: string;
  assessment: string;
  observations: string[];
  recommendations: string[];
  exercise_notes: ExerciseNote[];
  source?: "ai" | "rules";
  metrics?: { last_7_days: InsightWindow; last_14_days: InsightWindow };
  progression_targets?: ProgressionTarget[];
  progression_week?: number;
  progression_applied_at?: string | null;
  progression_updated_exercises?: number;
}

export interface AIInsight {
  id: string;
  goal_id: string;
  kind: string;
  severity: "good" | "watch" | "warning" | "info" | string;
  title: string;
  body: string;
  payload: InsightPayload | null;
  status: "open" | "dismissed";
  created_at: string;
}

export interface ExercisePoint {
  date: string;
  top_weight: number | null;
  top_reps: number | null;
  best_rir: number | null;
  set_count: number;
}

export interface ExerciseTrend {
  exercise_name: string;
  points: ExercisePoint[];
}

export interface ConsistencyStats {
  planned: number;
  completed: number;
  completion_rate: number;
  current_streak: number;
  weekly: { week: number; planned: number; completed: number }[];
}

export interface ProgressData {
  consistency: ConsistencyStats;
  trends: ExerciseTrend[];
}

export interface WeeklyReview {
  metrics: Record<string, number>;
  summary: string;
  recommendation: string;
}

export interface GenerateInsightsResponse {
  type: "none" | "created";
  message?: string;
  insights: AIInsight[];
}

export const api = {
  // Goals
  listGoals: () => request<Goal[]>("/goals/"),
  getGoal: (id: string) => request<Goal>(`/goals/${id}`),
  createGoal: (data: Partial<Goal>) =>
    request<Goal>("/goals/", { method: "POST", body: JSON.stringify(data) }),
  updateGoal: (id: string, data: Partial<Goal>) =>
    request<Goal>(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteGoal: (id: string) =>
    request<void>(`/goals/${id}`, { method: "DELETE" }),

  // Plan entries
  listPlanEntries: (goalId: string) =>
    request<PlanEntry[]>(`/goals/${goalId}/plans/`),
  createPlanEntry: (goalId: string, data: Partial<PlanEntry>) =>
    request<PlanEntry>(`/goals/${goalId}/plans/`, {
      method: "POST", body: JSON.stringify({ goal_id: goalId, ...data }),
    }),
  updatePlanEntry: (goalId: string, entryId: string, data: Partial<PlanEntry>) =>
    request<PlanEntry>(`/goals/${goalId}/plans/${entryId}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
  deletePlanEntry: (goalId: string, entryId: string) =>
    request<void>(`/goals/${goalId}/plans/${entryId}`, { method: "DELETE" }),

  // Exercises
  listExercises: (goalId: string, entryId: string) =>
    request<Exercise[]>(`/goals/${goalId}/plans/${entryId}/exercises/`),
  updateExercise: (goalId: string, entryId: string, exId: string, data: Partial<Exercise>) =>
    request<Exercise>(`/goals/${goalId}/plans/${entryId}/exercises/${exId}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),

  // AI
  generateQuestions: (prompt: string) =>
    request<{ questions: string[] }>("/ai/questions", {
      method: "POST", body: JSON.stringify({ prompt }),
    }),
  generatePlan: (prompt: string, qa: { question: string; answer: string }[]) =>
    request<{ goal: Goal; entries: PlanEntry[] }>("/ai/plan", {
      method: "POST", body: JSON.stringify({ prompt, qa }),
    }),
  continuePlan: (goalId: string, prompt: string, finalize: boolean, history?: { role: string; text: string }[]) =>
    request<{ type: string; message?: string; goal?: Goal; entries?: PlanEntry[] }>("/ai/continue", {
      method: "POST", body: JSON.stringify({ goal_id: goalId, prompt, finalize, history: history ?? [] }),
    }),

  // Weight tracking
  listWeight: () => request<WeightEntry[]>("/weight/"),
  createWeight: (data: { weight_kg: number; fat_percentage?: number; muscle_percentage?: number; measured_at?: string }) =>
    request<WeightEntry>("/weight/", { method: "POST", body: JSON.stringify(data) }),
  updateWeight: (id: string, data: { weight_kg: number; fat_percentage?: number; muscle_percentage?: number; measured_at?: string }) =>
    request<WeightEntry>(`/weight/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWeight: (id: string) =>
    request<void>(`/weight/${id}`, { method: "DELETE" }),

  // Sessions / Set logging
  openSession: (goalId: string, entryId: string, performedAt?: string) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/entries/${entryId}`, {
      method: "POST", body: JSON.stringify({ performed_at: performedAt ?? null }),
    }),
  logSets: (goalId: string, sessionId: string, sets: SetLog[]) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/${sessionId}/sets`, { method: "POST", body: JSON.stringify({ sets }) }),
  finishExercise: (goalId: string, sessionId: string, exerciseId: string, sets: SetLog[]) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/${sessionId}/exercises/${exerciseId}/finish`, {
      method: "POST", body: JSON.stringify({ sets }),
    }),
  completeSession: (goalId: string, sessionId: string) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/${sessionId}/complete`, { method: "POST" }),
  getPrevious: (goalId: string, entryId: string, exerciseId: string, before?: string) =>
    request<PreviousPerformance | null>(
      `/goals/${goalId}/sessions/entries/${entryId}/previous?exercise_id=${exerciseId}${before ? `&before=${before}` : ""}`),
  getExerciseLog: (goalId: string) =>
    request<ExerciseLogItem[]>(`/goals/${goalId}/sessions/log`),
  updateExerciseLog: (goalId: string, logId: string, data: ExerciseLogEdit) =>
    request<ExerciseLogItem>(`/goals/${goalId}/sessions/log/${logId}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
  deleteExerciseLog: (goalId: string, logId: string) =>
    request<void>(`/goals/${goalId}/sessions/log/${logId}`, { method: "DELETE" }),

  // Coach
  coachChat: (goalId: string | null, message: string, history?: { role: string; text: string }[]) =>
    request<CoachResponse>("/coach/chat", {
      method: "POST",
      body: JSON.stringify({ goal_id: goalId, message, history: history ?? [] }),
    }),
  coachFinalize: (goalId: string | null, message: string, history?: { role: string; text: string }[]) =>
    request<{ type: string; summary?: PlanSummary; goal?: Goal; entries?: PlanEntry[] }>("/coach/finalize", {
      method: "POST",
      body: JSON.stringify({ goal_id: goalId, message, history: history ?? [] }),
    }),
  coachHistory: (goalId: string) =>
    request<{ role: string; text: string; created_at: string }[]>(`/coach/history?goal_id=${goalId}`),

  // Insights / Progress
  analyzeInsights: (goalId: string, force = false) =>
    request<AIInsight>(`/goals/${goalId}/insights/analyze?force=${force}`, { method: "POST" }),
  applyProgression: (goalId: string, insightId: string) =>
    request<{ insight: AIInsight; updated: number; week_number: number; already_applied: boolean }>(
      `/goals/${goalId}/insights/${insightId}/apply-progression`, { method: "POST" }),
  generateInsights: (goalId: string) =>
    request<GenerateInsightsResponse>(`/goals/${goalId}/insights/generate`, { method: "POST" }),
  listInsights: (goalId: string, status = "open") =>
    request<AIInsight[]>(`/goals/${goalId}/insights/?status=${status}`),
  dismissInsight: (goalId: string, insightId: string) =>
    request<AIInsight>(`/goals/${goalId}/insights/${insightId}/dismiss`, { method: "POST" }),
  weeklyReview: (goalId: string) =>
    request<WeeklyReview>(`/goals/${goalId}/insights/weekly`),
  getProgress: (goalId: string) =>
    request<ProgressData>(`/goals/${goalId}/progress/`),
};
