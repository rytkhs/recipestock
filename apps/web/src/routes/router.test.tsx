import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRouter } from "./router";

describe("AppRouter", () => {
  it("renders the initial route", async () => {
    render(<AppRouter />);

    await expect(
      screen.findByRole("heading", { name: "Recipe Stock" }),
    ).resolves.toBeInTheDocument();
  });
});
