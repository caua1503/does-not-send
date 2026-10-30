import { vi, it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock API
vi.mock("../../lib/api.ts", () => ({
  createSession: vi.fn().mockResolvedValue({
    id: "session-1",
    ownerToken: "owner-token",
    uploadToken: "upload-token",
    createdAt: new Date().toISOString(),
  }),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  heartbeat: vi.fn().mockResolvedValue(undefined),
  listFiles: vi.fn().mockResolvedValue([]),
  previewUrl: vi.fn().mockReturnValue("http://localhost/preview"),
  downloadUrl: vi.fn().mockReturnValue("http://localhost/download"),
  zipUrl: vi.fn().mockReturnValue("http://localhost/zip"),
  wsUrl: vi.fn().mockReturnValue("ws://localhost/ws"),
}));

// Mock hooks that open real connections
vi.mock("../../hooks/useSessionEvents.ts", () => ({
  useSessionEvents: vi.fn().mockReturnValue({ files: [], connected: false }),
}));
vi.mock("../../hooks/useHeartbeat.ts", () => ({
  useHeartbeat: vi.fn(),
}));

import ComputerPage from "../../pages/computer/ComputerPage.tsx";

describe("ComputerPage", () => {
  it("renderiza botão Nova sessão", () => {
    render(<ComputerPage />);
    const buttons = screen.getAllByRole("button", { name: /nova sessão/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("renderiza empty state quando sem sessões", () => {
    render(<ComputerPage />);
    expect(screen.getByText(/nenhuma sessão ativa/i)).toBeInTheDocument();
  });
});
