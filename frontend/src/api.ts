const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail ?? "Request failed");
  return body;
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
};
