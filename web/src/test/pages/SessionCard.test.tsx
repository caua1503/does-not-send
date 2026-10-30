import { vi, it, expect, describe } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionCard } from "../../pages/computer/SessionCard.tsx";

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

  it("abre e fecha modal de QR Code ampliado", () => {
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

    // Modal começa fechado
    expect(
      screen.queryByRole("heading", { name: /qr code para envio de arquivos/i })
    ).not.toBeInTheDocument();

    // Clica para ampliar
    fireEvent.click(zoomButton);
    expect(
      screen.getByRole("heading", { name: /qr code para envio de arquivos/i })
    ).toBeInTheDocument();

    // Fecha modal clicando no botão Fechar
    const closeBtn = screen.getByRole("button", { name: /fechar/i });
    fireEvent.click(closeBtn);
    expect(
      screen.queryByRole("heading", { name: /qr code para envio de arquivos/i })
    ).not.toBeInTheDocument();
  });

  it("fecha modal de QR Code ampliado com tecla Esc", () => {
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
});
