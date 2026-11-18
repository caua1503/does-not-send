import { StrictMode } from "react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import InvitePage from "../../pages/guest/InvitePage.tsx";

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("InvitePage", () => {
  const fetchMock = vi.fn();
  const assign = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    assign.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/i/abc12345",
        search: "",
        assign,
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("valida, resgata, salva a credencial e abre a sessão como convidado", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/invites/abc12345")) {
        return reply(200, { state: "valid", sessionId: "sess-1" });
      }
      if (url.endsWith("/api/invites/abc12345/redeem")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body)).deviceId).toMatch(/^[0-9a-f]{32}$/);
        return reply(200, {
          success: true,
          phoneCredential: "guest-cred",
          visualId: "AB12",
          shortId: "AB12",
          state: "PAIRED",
          pairedAt: "2026-01-01T00:00:00.000Z",
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<InvitePage />);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/entrar/sess-1"));
    expect(JSON.parse(localStorage.getItem("dns_guest_cred_sess-1") || "{}")).toMatchObject({
      guestCredential: "guest-cred",
      visualId: "AB12",
    });
    expect(localStorage.getItem("dns_device_id")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("sob StrictMode faz um único resgate", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/redeem")) {
        return reply(200, {
          success: true,
          phoneCredential: "strict-cred",
          visualId: "AB12",
          state: "PAIRED",
          pairedAt: "2026-01-01T00:00:00.000Z",
        });
      }
      return reply(200, { state: "valid", sessionId: "sess-1" });
    });

    render(
      <StrictMode>
        <InvitePage />
      </StrictMode>,
    );

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/entrar/sess-1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("com credencial já salva da sessão, entra direto sem resgatar de novo", async () => {
    localStorage.setItem(
      "dns_guest_cred_sess-1",
      JSON.stringify({ guestCredential: "existing-cred", visualId: "AB12" }),
    );
    fetchMock.mockResolvedValue(reply(200, { state: "used", sessionId: "sess-1" }));

    render(<InvitePage />);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/entrar/sess-1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/invites/abc12345");
  });

  it("convite de twoway vai para a escolha de nome sem resgatar", async () => {
    fetchMock.mockResolvedValue(
      reply(200, { state: "valid", sessionId: "sess-2", mode: "twoway" }),
    );

    render(<InvitePage />);

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "/entrar/sess-2?mode=twoway&code=abc12345",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["expired", /convite expirou/i],
    ["used", /convite já foi usado/i],
    ["revoked", /convite foi revogado/i],
  ])("mostra estado %s sem resgatar", async (state, message) => {
    fetchMock.mockResolvedValue(reply(200, { state, sessionId: "sess-1" }));

    render(<InvitePage />);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("convite inexistente mostra erro e oferece código ou home", async () => {
    fetchMock.mockResolvedValue(reply(404, { error: "Invite not found", statusCode: 404 }));

    render(<InvitePage />);

    expect(await screen.findByText(/convite não encontrado/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /entrar com código/i }));
    expect(assign).toHaveBeenCalledWith("/?entrar=1");

    fireEvent.click(screen.getByRole("button", { name: /voltar ao início/i }));
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("erro do redeem durante a corrida vira estado claro", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/redeem")) {
        return reply(410, { error: "Invite is used", code: "USED", statusCode: 410 });
      }
      return reply(200, { state: "valid", sessionId: "sess-1" });
    });

    render(<InvitePage />);

    expect(await screen.findByText(/convite já foi usado/i)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
