import { vi, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HostPage from "../../pages/host/HostPage.tsx";
import {
  createSession,
  deleteSession,
  joinTwowaySession,
  joinWithCode,
  leaveSession,
} from "../../lib/api.ts";

vi.mock("../../lib/api.ts", () => ({
  ApiError: class extends Error {},
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  joinTwowaySession: vi.fn(),
  joinWithCode: vi.fn(),
  leaveSession: vi.fn(),
  JoinError: class extends Error {},
  getSession: vi.fn().mockResolvedValue({ id: "s1", state: "PAIRED" }),
  requestLoginCode: vi.fn(),
  wsUrl: (id: string, token: string) => `ws://test/${id}/${token}`,
}));

vi.mock("../../hooks/useHeartbeat.ts", () => ({
  useHeartbeat: vi.fn(),
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: () => <svg />,
  QRCodeCanvas: () => null,
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send() {}

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const activeSession = {
  id: "s1",
  ownerToken: "owner-token",
  computerToken: "owner-token",
  uploadToken: "upload-token",
  qrToken: "qr-token",
  visualId: "P79XFJ",
  shortId: "P79XFJ",
  mode: "oneway" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.mocked(leaveSession).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("abre a tela de nome ao escolher sessão de troca", () => {
  render(<HostPage />);

  fireEvent.click(screen.getAllByRole("button", { name: /sessão de troca/i })[0]!);

  expect(
    screen.getByRole("heading", { name: /criar sessão de troca/i })
  ).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Ex.: Ana")).toBeInTheDocument();
});

it("oferece entrar com código abaixo de nova sessão", () => {
  render(<HostPage />);

  expect(screen.getAllByRole("button", { name: /nova sessão/i }).length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: /entrar com código/i }));

  expect(screen.getByRole("heading", { name: /entrar com código/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("P79XFJ")).toBeInTheDocument();
});

it("usa a mesma entrada para twoway quando o código resolve uma sala", async () => {
  vi.mocked(joinWithCode).mockResolvedValueOnce({
    success: true,
    sessionId: "canonical-id",
    mode: "twoway",
    visualId: "ABC123",
  });
  vi.mocked(joinTwowaySession).mockResolvedValueOnce({
    sessionId: "canonical-id",
    mode: "twoway",
    participant: { id: "participant-id", name: "Ana", device: "phone" },
    credential: "participant-credential",
  });

  render(<HostPage />);
  fireEvent.click(screen.getByRole("button", { name: /entrar com código/i }));
  fireEvent.change(screen.getByPlaceholderText("P79XFJ"), {
    target: { value: "ABC123" },
  });
  fireEvent.change(screen.getByPlaceholderText("000 000"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^entrar$/i }));

  await waitFor(() => {
    expect(
      screen.getByRole("heading", { name: /entrar na sessão de troca/i }),
    ).toBeInTheDocument();
  });
  expect(joinWithCode).toHaveBeenCalledWith("ABC123", "123456");

  fireEvent.change(screen.getByPlaceholderText("Ex.: Ana"), {
    target: { value: "Ana" },
  });
  fireEvent.click(screen.getByRole("button", { name: /entrar na sala/i }));

  await waitFor(() => {
    expect(joinTwowaySession).toHaveBeenCalledWith(
      "canonical-id",
      expect.objectContaining({ name: "Ana", code: "123456" }),
    );
  });
});

it("clicar no nome sem sessão ativa vai direto para a home", () => {
  render(<HostPage />);

  fireEvent.click(screen.getByRole("button", { name: "Ir para a página inicial" }));

  expect(screen.queryByRole("heading", { name: /sair da sessão\?/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /nova sessão/i }).length).toBeGreaterThan(0);
});

it("esconde os botões do cabeçalho dentro da sessão e confirma antes de sair", async () => {
  vi.mocked(createSession).mockResolvedValueOnce(activeSession);
  render(<HostPage />);

  fireEvent.click(screen.getAllByRole("button", { name: /nova sessão/i })[0]!);

  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /sessão de troca/i })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("button", { name: /nova sessão/i })).not.toBeInTheDocument();

  // Cancelar mantém a sessão e os botões escondidos
  fireEvent.click(screen.getByRole("button", { name: "Ir para a página inicial" }));
  expect(screen.getByRole("heading", { name: /sair da sessão\?/i })).toBeInTheDocument();
  expect(screen.getByText(/você é o anfitrião/i)).toBeInTheDocument();
  expect(screen.getByText(/arquivos serão apagados do servidor/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: /sair da sessão\?/i })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("button", { name: /nova sessão/i })).not.toBeInTheDocument();
  expect(deleteSession).not.toHaveBeenCalled();
  expect(leaveSession).not.toHaveBeenCalled();

  // Confirmar chama o servidor e só então limpa o estado local
  fireEvent.click(screen.getByRole("button", { name: "Ir para a página inicial" }));
  fireEvent.click(screen.getByRole("button", { name: /encerrar e sair/i }));

  await waitFor(() =>
    expect(leaveSession).toHaveBeenCalledWith("s1", "owner-token"),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /nova sessão/i }).length).toBeGreaterThan(0),
  );
  expect(screen.getByText(/nenhuma sessão ativa/i)).toBeInTheDocument();
  expect(deleteSession).not.toHaveBeenCalled();
  expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  expect(MockWebSocket.instances.every((ws) => ws.readyState === MockWebSocket.CLOSED)).toBe(
    true,
  );
});

it("não finge que saiu quando o servidor falha ao encerrar", async () => {
  vi.mocked(createSession).mockResolvedValueOnce(activeSession);
  vi.mocked(leaveSession).mockRejectedValueOnce(new Error("offline"));
  render(<HostPage />);

  fireEvent.click(screen.getAllByRole("button", { name: /nova sessão/i })[0]!);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /nova sessão/i })).not.toBeInTheDocument(),
  );

  fireEvent.click(screen.getByRole("button", { name: "Ir para a página inicial" }));
  fireEvent.click(screen.getByRole("button", { name: /encerrar e sair/i }));

  expect(
    await screen.findByText(/não foi possível encerrar a sessão/i),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /nova sessão/i })).not.toBeInTheDocument();
});
