import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SessionPage } from "../../pages/SessionPage.tsx";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";

vi.mock("../../hooks/useSessionEvents.ts", () => ({
  useSessionEvents: vi.fn(),
}));

vi.mock("../../hooks/useSessionUpload.ts", () => ({
  useSessionUpload: vi.fn().mockReturnValue({
    items: [],
    textError: null,
    fileInputRef: { current: null },
    handleFilesChosen: vi.fn(),
    sendText: vi.fn(),
    replaceEditedImage: vi.fn(),
    retryUpload: vi.fn(),
    totalFiles: 0,
    completedFiles: 0,
    isUploading: false,
  }),
}));

vi.mock("../../lib/api.ts", () => ({
  getSession: vi.fn().mockResolvedValue({
    id: "session-id",
    state: "PAIRED",
    fileCount: 0,
    createdAt: "",
  }),
  leaveSession: vi.fn().mockResolvedValue(undefined),
}));

function mockClosed(reason: string) {
  vi.mocked(useSessionEvents).mockReturnValue({
    files: [],
    connected: false,
    sessionClosed: true,
    closedReason: reason,
    reconnecting: false,
    sendClose: vi.fn(),
  });
}

describe("SessionPage (oneway) — sessão encerrada", () => {
  const onLeave = vi.fn();

  beforeEach(() => {
    onLeave.mockClear();
    mockClosed("host_left");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("convidado conta 10s e volta ao início uma única vez", () => {
    vi.useFakeTimers();
    render(
      <SessionPage role="guest" sessionId="session-id" token="token" onLeave={onLeave} />,
    );

    expect(screen.getByText(/voltando para o início em 10s/i)).toBeInTheDocument();
    expect(screen.getByText(/10 segundos/i)).toHaveAttribute("aria-live", "polite");

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(/voltando para o início em 9s/i)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(9000));
    expect(onLeave).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20_000));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("botão manual volta na hora e cancela o timer", () => {
    vi.useFakeTimers();
    render(
      <SessionPage role="guest" sessionId="session-id" token="token" onLeave={onLeave} />,
    );

    act(() => vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole("button", { name: /voltar ao início/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20_000));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["host_left", /o anfitrião saiu e a sessão foi encerrada/i],
    ["host_disconnected", /o anfitrião perdeu a conexão/i],
    ["host_closed", /o anfitrião encerrou a sessão/i],
    ["inactivity", /expirou por inatividade/i],
  ])("mostra a mensagem do reason %s", (reason, message) => {
    mockClosed(reason);
    render(
      <SessionPage role="guest" sessionId="session-id" token="token" onLeave={onLeave} />,
    );

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
