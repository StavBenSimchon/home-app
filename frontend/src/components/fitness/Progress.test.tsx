import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api, type Goal } from "../../api";
import Progress from "./Progress";

const goal: Goal = {
  id: "goal-1",
  title: "Fitness goal",
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

describe("Progress body metrics graph", () => {
  afterEach(() => vi.restoreAllMocks());

  it("isolates a selected metric and returns to all lines", async () => {
    vi.spyOn(api, "listWeight").mockResolvedValue([
      {
        id: "weight-1",
        weight_kg: 80,
        fat_percentage: 20,
        muscle_percentage: 40,
        measured_at: "2026-08-31",
        created_at: "2026-08-31T00:00:00Z",
      },
      {
        id: "weight-2",
        weight_kg: 79,
        fat_percentage: 19,
        muscle_percentage: 41,
        measured_at: "2026-09-01",
        created_at: "2026-09-01T00:00:00Z",
      },
    ]);
    vi.spyOn(api, "getProgress").mockResolvedValue({
      consistency: {
        planned: 0,
        completed: 0,
        completion_rate: 0,
        current_streak: 0,
        weekly: [],
      },
      trends: [],
    });

    const { container } = render(<Progress goal={goal} />);

    await waitFor(() => expect(container.querySelectorAll("polyline")).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Fat kg" }));
    await waitFor(() => expect(container.querySelectorAll("polyline")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Fat kg" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Fat kg" }));
    await waitFor(() => expect(container.querySelectorAll("polyline")).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "Muscle kg" }));
    await waitFor(() => expect(container.querySelectorAll("polyline")).toHaveLength(1));
  });
});
