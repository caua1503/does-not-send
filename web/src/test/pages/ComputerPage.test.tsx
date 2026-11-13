import { vi, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ComputerPage from "../../pages/computer/ComputerPage.tsx";

vi.mock("../../lib/api.ts", () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  joinWithCode: vi.fn(),
  JoinError: class extends Error {},
}));

it("oferece entrar com código abaixo de nova sessão", () => {
  render(<ComputerPage />);

  expect(screen.getAllByRole("button", { name: /nova sessão/i }).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: /entrar com código/i }));

  expect(screen.getByRole("heading", { name: /entrar com código/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("P79XFJ")).toBeInTheDocument();
});
