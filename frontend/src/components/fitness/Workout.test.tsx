import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api, type ExerciseLogItem, type Goal } from "../../api";
import Workout from "./Workout";

const goal: Goal = {
  id: "goal-1",
  title: "Goal",
  description: null,
  metric_name: null,
  current_value: null,
  target_value: null,
  unit: null,
  start_date: null,
  target_date: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const item: ExerciseLogItem = {
  id: "log-1",
  session_id: "session-1",
  source_exercise_id: null,
  exercise_name: "Bench Press",
  activity: "Push",
  performed_at: "2026-09-01",
  sets: [{ set_number: 1, weight: 80, reps: 10, rir: 2, failure: false }],
  top_weight: 80,
  total_reps: 10,
  failure_sets: [],
};

describe("Workout history", () => {
  afterEach(() => vi.restoreAllMocks());

  it("edits date/set quantity and explicitly deletes a finished log", async () => {
    vi.spyOn(api, "getExerciseLog").mockResolvedValue([item]);
    const update = vi.spyOn(api, "updateExerciseLog").mockResolvedValue(item);
    const remove = vi.spyOn(api, "deleteExerciseLog").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<Workout goal={goal} />);
    await screen.findByText("Bench Press");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit logged exercise" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-02" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add set" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][2].performed_at).toBe("2026-09-02");
    expect(update.mock.calls[0][2].sets).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("goal-1", "log-1"));
  });
});
