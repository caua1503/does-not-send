import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import PhonePage from "../../pages/phone/PhonePage.tsx";

vi.mock("browser-image-compression", () => {
  return {
    default: vi.fn(async (file) => file),
  };
});

describe("PhoneReconnectionPersistence - Cenários de Reconexão e Persistência", () => {
  const fetchMock = vi.fn();
  let mockSockets: any[] = [];

  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = MockWebSocket.OPEN;
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number; reason?: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    sentMessages: string[] = [];

    constructor(url: string) {
      this.url = url;
      mockSockets.push(this);
      setTimeout(() => {
        if (this.onopen) this.onopen();
      }, 0);
    }

    send(data: string) {
      this.sentMessages.push(data);
    }

    close(code = 1000, reason = "") {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) this.onclose({ code, reason });
    }

    receiveMessage(data: Record<string, unknown>) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(data) });
      }
    }
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSockets = [];
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", MockWebSocket);

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "?qrToken=qr-token-initial",
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  // Cenário 1: Autenticar normalmente utilizando o QR Code
  it("Cenário 1: Autentica normalmente com QR code e persiste em localStorage", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        phoneCredential: "phone-secret-persisted",
        visualId: "V1D99",
        shortId: "V1D99",
        state: "PAIRED",
        pairedAt: new Date().toISOString(),
      }),
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    });

    // Validar que foi persistido em localStorage (sobrevive a tab kills e recarregamento)
    const stored = JSON.parse(
      localStorage.getItem("dns_phone_cred_sess-persist-123") || "{}"
    );
    expect(stored.phoneCredential).toBe("phone-secret-persisted");
    expect(stored.visualId).toBe("V1D99");
  });

  // Cenário 2: Autenticar e enviar imagem (erro no upload NÃO deve invalidar sessão)
  it("Cenário 2: Erro 401 ou 404 no envio de arquivo isola erro no item e NÃO invalida a sessão", async () => {
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-persisted",
        visualId: "V1D99",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "",
      },
      writable: true,
    });

    const xhrInstances: any[] = [];
    class MockXHR {
      status = 401;
      upload = { onprogress: null as any };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn(() => {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      });
      constructor() {
        xhrInstances.push(this);
      }
    }
    vi.stubGlobal("XMLHttpRequest", MockXHR);

    render(<PhonePage />);

    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();

    const input = document.getElementById("phone-file-input") as HTMLInputElement;
    const testFile = new File(["test image bytes"], "foto.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [testFile] } });

    await waitFor(() => {
      expect(xhrInstances.length).toBe(1);
    });

    await waitFor(() => {
      // O item específico exibe erro de envio
      expect(screen.getByText("Falha de autorização no envio")).toBeInTheDocument();
    });

    // A sessão continua totalmente ativa e disponível, NÃO exibe tela de "Sessão Indisponível"
    expect(screen.queryByText(/sessão indisponível/i)).not.toBeInTheDocument();
    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  // Cenários 3 & 4: Abrir outro app e retornar ao navegador / Forçar reload
  it("Cenários 3 e 4: Após reload ou retorno ao navegador, recupera sessão de localStorage sem re-parear", async () => {
    // Simula sessão gravada em localStorage antes do reload
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-recovered",
        visualId: "REC42",
      })
    );

    // URL limpa sem query param (ou com query param)
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);

    // NÃO deve chamar pair
    expect(fetchMock).not.toHaveBeenCalled();

    // Sessão recuperada e pronta para envio
    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    const visualBadge = screen.getByTestId("phone-visual-id");
    expect(visualBadge).toHaveTextContent("ID: REC42");

    // Conexão WebSocket reconecta usando a credencial recuperada
    await waitFor(() => {
      expect(mockSockets.length).toBeGreaterThanOrEqual(1);
    });
    const ws = mockSockets[0];
    act(() => {
      if (ws.onopen) ws.onopen();
    });

    expect(ws.sentMessages).toContain(
      JSON.stringify({
        type: "auth",
        role: "phone",
        secret: "phone-secret-recovered",
      })
    );
  });

  // Cenário 5: Fechar e reabrir navegador (localStorage sobrevive, sessionStorage não)
  it("Cenário 5: Fechar e reabrir navegador preserva credencial mesmo com sessionStorage vazio", () => {
    sessionStorage.clear(); // sessionStorage foi perdido
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-persisted-survives",
        visualId: "SRV88",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);

    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    expect(screen.getByTestId("phone-visual-id")).toHaveTextContent("ID: SRV88");
  });

  // Cenário 6: Perder conexão e reconectar
  it("Cenário 6: Desconexão temporária de WebSocket exibe estado reconectando e retoma quando conexão volta", async () => {
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-persisted",
        visualId: "V1D99",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(mockSockets.length).toBeGreaterThanOrEqual(1);
    });

    const ws = mockSockets[0];
    act(() => {
      ws.receiveMessage({ type: "auth_ok", role: "phone" });
      ws.close(1006, "Network drop");
    });

    await waitFor(() => {
      expect(screen.getByTestId("status-reconnecting")).toBeInTheDocument();
    });

    // Sessão NÃO é encerrada na UI por queda temporária
    expect(screen.queryByText(/sessão indisponível/i)).not.toBeInTheDocument();
  });

  // Cenário 7: Recarregar com qrToken na URL já pareado reaproveita a credencial salva
  it("Cenário 7: Se a página recarregar com qrToken na URL já pareado, recupera credencial do localStorage", async () => {
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-already-paired",
        visualId: "PRD11",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "?qrToken=already-used-qr-token",
      },
      writable: true,
    });

    render(<PhonePage />);

    // Por ter encontrado em localStorage, nem tenta parear de novo
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    expect(screen.getByTestId("phone-visual-id")).toHaveTextContent("ID: PRD11");
  });

  // Sair da sessão pelo celular
  it("Sair da sessão apaga a credencial, fecha o WebSocket e volta ao estado inicial", async () => {
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-leave",
        visualId: "SAI00",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(mockSockets.length).toBeGreaterThanOrEqual(1);
    });
    const ws = mockSockets[0];
    act(() => {
      ws.receiveMessage({ type: "auth_ok", role: "phone" });
    });

    const leaveButton = await screen.findByRole("button", { name: /sair da sessão/i });
    fireEvent.click(leaveButton);

    expect(localStorage.getItem("dns_phone_cred_sess-persist-123")).toBeNull();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(screen.queryByText(/escolher arquivos/i)).not.toBeInTheDocument();
    expect(screen.getByText(/escaneie o qr code novamente/i)).toBeInTheDocument();
  });

  it("Ler o QR Code de outro computador substitui a credencial salva", async () => {
    localStorage.setItem(
      "dns_phone_cred_sess-other-456",
      JSON.stringify({
        phoneCredential: "phone-secret-other-machine",
        visualId: "OUT31",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "?qrToken=qr-token-initial",
      },
      writable: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        phoneCredential: "phone-secret-new-machine",
        visualId: "NEW42",
        shortId: "NEW42",
        state: "PAIRED",
        pairedAt: new Date().toISOString(),
      }),
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByTestId("phone-visual-id")).toHaveTextContent("ID: NEW42");
    });
    const stored = JSON.parse(
      localStorage.getItem("dns_phone_cred_sess-persist-123") || "{}"
    );
    expect(stored.phoneCredential).toBe("phone-secret-new-machine");
  });

  // Cenário 8: Sessão encerrada no servidor limpa localStorage
  it("Cenário 8: Sessão fechada no servidor (session_closed) remove credencial do localStorage", async () => {
    localStorage.setItem(
      "dns_phone_cred_sess-persist-123",
      JSON.stringify({
        phoneCredential: "phone-secret-to-close",
        visualId: "CLS00",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/sess-persist-123",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(mockSockets.length).toBeGreaterThanOrEqual(1);
    });

    const ws = mockSockets[0];
    act(() => {
      ws.receiveMessage({ type: "auth_ok", role: "phone" });
      ws.receiveMessage({ type: "session_closed", reason: "user_closed" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("status-session-closed")).toBeInTheDocument();
    });

    // Credencial deve ser removida do localStorage para não manter sessão órfã
    expect(localStorage.getItem("dns_phone_cred_sess-persist-123")).toBeNull();
  });
});
