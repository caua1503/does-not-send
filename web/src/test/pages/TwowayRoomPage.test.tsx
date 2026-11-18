import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TwowayRoomPage } from "../../pages/twoway/TwowayRoomPage.tsx";
import { useLoginCode, useCountdownSeconds } from "../../hooks/useLoginCode.ts";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";
import { copyText } from "../../lib/clipboard.ts";
import { leaveSession, requestLoginCode } from "../../lib/api.ts";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-value={value} />,
}));

vi.mock("../../hooks/useSessionEvents.ts", () => ({
  useSessionEvents: vi.fn().mockReturnValue({
    files: [],
    connected: true,
    sessionClosed: false,
    closedReason: null,
    reconnecting: false,
    sendClose: vi.fn(),
  }),
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

vi.mock("../../hooks/useLoginCode.ts", () => ({
  useLoginCode: vi.fn(),
  useCountdownSeconds: vi.fn(),
}));

vi.mock("../../lib/clipboard.ts", () => ({
  copyText: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../lib/api.ts", () => ({
  ApiError: class extends Error {},
  getSession: vi.fn().mockResolvedValue({ id: "session-id", state: "PAIRED" }),
  listFiles: vi.fn().mockResolvedValue([]),
  deleteItem: vi.fn(),
  deleteSession: vi.fn(),
  leaveSession: vi.fn().mockResolvedValue(undefined),
  requestLoginCode: vi.fn().mockResolvedValue(undefined),
}));

const props = {
  sessionId: "session-id",
  token: "token",
  visualId: "ABC123",
  qrToken: "qr-token",
  hostId: "host-id",
  onExit: vi.fn(),
};

describe("TwowayRoomPage", () => {
  beforeEach(() => {
    vi.mocked(useLoginCode).mockReturnValue({ code: null, deadline: null });
    vi.mocked(useCountdownSeconds).mockReturnValue(0);
    vi.mocked(useSessionEvents).mockReturnValue({
      files: [],
      connected: true,
      sessionClosed: false,
      closedReason: null,
      reconnecting: false,
      sendClose: vi.fn(),
    });
    vi.mocked(copyText).mockClear();
    vi.mocked(requestLoginCode).mockClear();
    vi.mocked(leaveSession).mockReset().mockResolvedValue(undefined);
    props.onExit.mockClear();
  });

  it("copia o ID ao clicar nele e gera o código numérico", async () => {
    render(<TwowayRoomPage {...props} role="host" />);

    fireEvent.click(screen.getByRole("button", { name: /^copiar id$/i }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("ABC123"));

    fireEvent.click(screen.getByRole("button", { name: /gerar código/i }));
    await waitFor(() =>
      expect(requestLoginCode).toHaveBeenCalledWith("session-id", "token"),
    );
  });

  it("mostra 'Copiado' no ID por instantes e volta ao valor", async () => {
    render(<TwowayRoomPage {...props} role="host" />);

    const idButton = screen.getByRole("button", { name: /^copiar id$/i });
    expect(idButton).toHaveTextContent("ABC123");

    fireEvent.click(idButton);
    await waitFor(() => expect(idButton).toHaveTextContent("Copiado"));
    expect(copyText).toHaveBeenCalledWith("ABC123");

    await waitFor(() => expect(idButton).toHaveTextContent("ABC123"), { timeout: 2500 });
  });

  it("não tem botão separado 'Copiar ID'", () => {
    render(<TwowayRoomPage {...props} role="host" />);

    expect(screen.queryByText("Copiar ID")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /copiar id/i })).toHaveLength(1);
  });

  it("exibe o código gerado para copiar", async () => {
    vi.mocked(useLoginCode).mockReturnValue({
      code: "123456",
      deadline: Date.now() + 120_000,
    });
    vi.mocked(useCountdownSeconds).mockReturnValue(120);

    render(<TwowayRoomPage {...props} role="host" />);

    const code = screen.getByTestId("manual-login-code-value");
    expect(code).toHaveTextContent("123 456");

    fireEvent.click(code);
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("123456"));
  });

  it("não mostra geração de código para convidado", () => {
    render(<TwowayRoomPage {...props} role="guest" />);

    expect(screen.queryByRole("button", { name: /gerar código/i })).not.toBeInTheDocument();
  });

  it("anfitrião vê o botão de gerar link de convite", () => {
    render(<TwowayRoomPage {...props} role="host" />);

    expect(
      screen.getByRole("button", { name: /gerar link de convite/i }),
    ).toBeInTheDocument();
  });

  it("convidado não vê o botão de gerar link de convite", () => {
    render(<TwowayRoomPage {...props} role="guest" />);

    expect(
      screen.queryByRole("button", { name: /gerar link de convite/i }),
    ).not.toBeInTheDocument();
  });

  it("convidado confirma a saída antes de deixar a sala", async () => {
    render(<TwowayRoomPage {...props} role="guest" />);

    fireEvent.click(screen.getByRole("button", { name: /^sair$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/você sairá da sessão/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/pode voltar com o código/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /^sair$/i }));

    await waitFor(() => expect(leaveSession).toHaveBeenCalledWith("session-id", "token"));
    await waitFor(() => expect(props.onExit).toHaveBeenCalled());
  });

  it("anfitrião vê aviso destrutivo ao encerrar a sala", () => {
    render(<TwowayRoomPage {...props} role="host" />);

    fireEvent.click(screen.getByRole("button", { name: /encerrar sessão/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/apagados do servidor/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /encerrar e apagar/i })).toBeInTheDocument();
  });

  it("convidado conta 10s e volta ao início uma única vez", () => {
    vi.mocked(useSessionEvents).mockReturnValue({
      files: [],
      connected: false,
      sessionClosed: true,
      closedReason: "host_left",
      reconnecting: false,
      sendClose: vi.fn(),
    });
    vi.useFakeTimers();
    try {
      render(<TwowayRoomPage {...props} role="guest" />);

      expect(screen.getByText(/voltando para o início em 10s/i)).toBeInTheDocument();
      expect(screen.getByText(/10 segundos/i)).toHaveAttribute("aria-live", "polite");

      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByText(/voltando para o início em 9s/i)).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(9000));
      expect(props.onExit).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(20_000));
      expect(props.onExit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("botão manual volta na hora e cancela o timer", () => {
    vi.mocked(useSessionEvents).mockReturnValue({
      files: [],
      connected: false,
      sessionClosed: true,
      closedReason: "host_closed",
      reconnecting: false,
      sendClose: vi.fn(),
    });
    vi.useFakeTimers();
    try {
      render(<TwowayRoomPage {...props} role="guest" />);

      act(() => vi.advanceTimersByTime(4000));
      fireEvent.click(screen.getByRole("button", { name: /voltar ao início/i }));
      expect(props.onExit).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(20_000));
      expect(props.onExit).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["host_left", /o anfitrião saiu e a sessão foi encerrada/i],
    ["host_disconnected", /o anfitrião perdeu a conexão/i],
    ["host_closed", /o anfitrião encerrou a sessão/i],
    ["inactivity", /expirou por inatividade/i],
  ])("convidado entende o fechamento com reason %s", (reason, message) => {
    vi.mocked(useSessionEvents).mockReturnValue({
      files: [],
      connected: false,
      sessionClosed: true,
      closedReason: reason,
      reconnecting: false,
      sendClose: vi.fn(),
    });

    render(<TwowayRoomPage {...props} role="guest" />);

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});
