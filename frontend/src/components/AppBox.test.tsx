import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppBox from "./AppBox";

describe("AppBox", () => {
  it("renders title and description", () => {
    render(
      <MemoryRouter>
        <AppBox title="Fitness" description="Track goals" icon="🏋️" path="/fitness" />
      </MemoryRouter>
    );
    expect(screen.getByText("Fitness")).toBeTruthy();
    expect(screen.getByText("Track goals")).toBeTruthy();
  });
});
