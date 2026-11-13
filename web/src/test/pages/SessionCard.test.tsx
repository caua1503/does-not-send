import { vi, it, expect, describe, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionCard } from "../../pages/computer/SessionCard.tsx";

// jsdom não implementa canvas — mock mínimo para QRCodeCanvas não quebrar
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillStyle: "",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    scale: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    globalAlpha: 1,
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi
    .fn()
    .mockReturnValue("data:image/png;base64,FAKEPNG");
});

vi.mock("../../hooks/useSessionEvents.ts", () => ({
  useSessionEvents: vi.fn().mockReturnValue({ files: [], connected: true }),
}));
vi.mock("../../hooks/useHeartbeat.ts", () => ({
  useHeartbeat: vi.fn(),
}));

describe("SessionCard QR Code zoom", () => {
  const session = {
    id: "test-session-id",
    ownerToken: "test-owner-token",
    uploadToken: "test-upload-token",
  };

  it("abre e fecha overlay de QR Code ampliado", () => {
    render(
      <SessionCard
        session={session}
        publicBaseUrl="http://192.168.1.100:3000"
        onClose={vi.fn()}
        selected={true}
        onSelect={vi.fn()}
      />
    );

    const zoomButton = screen.getByRole("button", { name: /ampliar qr code/i });
    expect(zoomButton).toBeInTheDocument();

    // Overlay começa fechado
    expect(
      screen.queryByRole("heading", { name: /qr code para envio de arquivos/i })
    ).not.toBeInTheDocument();

    // Clica para ampliar
    fireEvent.click(zoomButton);
    expect(
      screen.getByRole("heading", { name: /qr code para envio de arquivos/i })
    ).toBeInTheDocument();

    // Fecha clicando no botão Fechar
    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    fireEvent.click(closeBtn);
    expect(
      screen.queryByRole("heading", { name: /qr code para envio de arquivos/i })
    ).not.toBeInTheDocument();
  });

  it("fecha overlay de QR Code ampliado com tecla Esc", () => {
    render(
      <SessionCard
        session={session}
        publicBaseUrl="http://192.168.1.100:3000"
        onClose={vi.fn()}
        selected={true}
        onSelect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /ampliar qr code/i }));
    expect(
      screen.getByRole("heading", { name: /qr code para envio de arquivos/i })
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("heading", { name: /qr code para envio de arquivos/i })
    ).not.toBeInTheDocument();
  });

  it("exibe o visualId em destaque no card e no modal ampliado", () => {
    const sessionWithVisualId = {
      id: "test-session-id",
      ownerToken: "test-owner-token",
      qrToken: "test-qr-token",
      visualId: "A7K92F",
    };

    render(
      <SessionCard
        session={sessionWithVisualId}
        publicBaseUrl="http://192.168.1.100:3000"
        onClose={vi.fn()}
        selected={false}
        onSelect={vi.fn()}
      />
    );

    // ID exibido no card
    const cardId = screen.getByTestId("session-visual-id");
    expect(cardId).toBeInTheDocument();
    expect(cardId).toHaveTextContent("ID: A7K92F");

    // Abre modal ampliado
    fireEvent.click(screen.getByRole("button", { name: /ampliar qr code/i }));
    const modalId = screen.getByTestId("session-modal-visual-id");
    expect(modalId).toBeInTheDocument();
    expect(modalId).toHaveTextContent("ID: A7K92F");
  });

  it("gera o código numérico sob demanda", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionCard
        session={session}
        publicBaseUrl="http://192.168.1.100:3000"
        onClose={vi.fn()}
        selected={false}
        onSelect={vi.fn()}
      />
    );

    // Sem código até o usuário pedir
    expect(screen.queryByTestId("manual-login-code-value")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /gerar código/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/sessions/test-session-id/login-code"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    vi.unstubAllGlobals();
  });
});
