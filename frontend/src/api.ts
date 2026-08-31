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
  plan_entry_id: string;
  performed_at: string;
  duration_minutes: number | null;
  status: "in_progress" | "completed";
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

export interface CoachAction {
  type: string;
  params?: Record<string, unknown>;
}

export interface CoachMessage {
  role: "user" | "assistant";
  text: string;
  action?: CoachAction | null;
}

export interface CoachResponse {
  type: "message" | "action";
  message: string;
  action?: CoachAction | null;
}

export interface AIInsight {
  id: string;
  goal_id: string;
  kind: string;
  severity: "good" | "warning" | "info";
  title: string;
  body: string;
  action: CoachAction | null;
  status: "open" | "applied" | "dismissed";
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
  startSession: (goalId: string, entryId: string) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/entries/${entryId}`, { method: "POST", body: JSON.stringify({}) }),
  logSets: (goalId: string, sessionId: string, sets: SetLog[]) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/${sessionId}/sets`, { method: "POST", body: JSON.stringify({ sets }) }),
  completeSession: (goalId: string, sessionId: string) =>
    request<WorkoutSession>(`/goals/${goalId}/sessions/${sessionId}/complete`, { method: "POST" }),
  getPrevious: (goalId: string, entryId: string, exerciseId: string) =>
    request<PreviousPerformance | null>(`/goals/${goalId}/sessions/entries/${entryId}/previous?exercise_id=${exerciseId}`),

  // Coach
  coachChat: (goalId: string | null, message: string, history?: { role: string; text: string }[]) =>
    request<CoachResponse>("/coach/chat", {
      method: "POST",
      body: JSON.stringify({ goal_id: goalId, message, history: history ?? [] }),
    }),
  coachFinalize: (goalId: string | null, message: string, history?: { role: string; text: string }[]) =>
    request<CoachResponse & { goal?: Goal; entries?: PlanEntry[] }>("/coach/finalize", {
      method: "POST",
      body: JSON.stringify({ goal_id: goalId, message, history: history ?? [] }),
    }),
  coachApply: (goalId: string, action: CoachAction) =>
    request<{ applied: boolean; result: Record<string, unknown> }>("/coach/actions", {
      method: "POST",
      body: JSON.stringify({ goal_id: goalId, action }),
    }),
  coachHistory: (goalId: string) =>
    request<{ role: string; text: string; created_at: string }[]>(`/coach/history?goal_id=${goalId}`),

  // Insights / Progress
  generateInsights: (goalId: string) =>
    request<GenerateInsightsResponse>(`/goals/${goalId}/insights/generate`, { method: "POST" }),
  listInsights: (goalId: string, status = "open") =>
    request<AIInsight[]>(`/goals/${goalId}/insights/?status=${status}`),
  dismissInsight: (goalId: string, insightId: string) =>
    request<AIInsight>(`/goals/${goalId}/insights/${insightId}/dismiss`, { method: "POST" }),
  applyInsight: (goalId: string, insightId: string) =>
    request<AIInsight>(`/goals/${goalId}/insights/${insightId}/apply`, { method: "POST" }),
  weeklyReview: (goalId: string) =>
    request<WeeklyReview>(`/goals/${goalId}/insights/weekly`),
  getProgress: (goalId: string) =>
    request<ProgressData>(`/goals/${goalId}/progress/`),
};
