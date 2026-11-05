import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import imageCompression from "browser-image-compression";
import PhonePage from "../../pages/phone/PhonePage.tsx";

vi.mock("browser-image-compression", () => {
  return {
    default: vi.fn(),
  };
});

describe("PhonePage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?token=upload-token-test",
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("renderiza área de escolher arquivos quando URL válida com token legado", () => {
    render(<PhonePage />);
    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
  });

  it("renderiza erro de sessão se token não for passado", () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);
    expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
  });

  it("pareia com qrToken, armazena no sessionStorage e exibe visualId no cabeçalho", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=secret-qr-token",
      },
      writable: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        phoneCredential: "phone-secret-cred-123",
        visualId: "A7K92F",
        shortId: "A7K92F",
        state: "PAIRED",
        pairedAt: new Date().toISOString(),
      }),
    });

    render(<PhonePage />);

    expect(screen.getByText(/conectando ao computador/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/sessions/session-test-id/pair");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ qrToken: "secret-qr-token" });

    // Header exibe visual ID
    const visualBadge = screen.getByTestId("phone-visual-id");
    expect(visualBadge).toBeInTheDocument();
    expect(visualBadge).toHaveTextContent("ID: A7K92F");

    // sessionStorage preenchido
    const stored = JSON.parse(
      sessionStorage.getItem("dns_phone_cred_session-test-id") || "{}"
    );
    expect(stored.phoneCredential).toBe("phone-secret-cred-123");
    expect(stored.visualId).toBe("A7K92F");
  });

  it("recupera credencial e visualId do sessionStorage sem chamar pair", () => {
    sessionStorage.setItem(
      "dns_phone_cred_session-test-id",
      JSON.stringify({
        phoneCredential: "cached-credential",
        visualId: "X8M41P",
      })
    );

    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    const visualBadge = screen.getByTestId("phone-visual-id");
    expect(visualBadge).toHaveTextContent("ID: X8M41P");
  });

  it("trata erro 401 no pareamento com mensagem clara", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=invalid-qr",
      },
      writable: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        error: "Invalid QR token",
        code: "INVALID",
        statusCode: 401,
      }),
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
      expect(
        screen.getByText(/sessão inválida ou qr code expirado/i)
      ).toBeInTheDocument();
    });
  });

  it("trata erro 410 no pareamento com mensagem de sessão encerrada", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=closed-qr",
      },
      writable: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({
        error: "Session is closed",
        code: "CLOSED",
        statusCode: 410,
      }),
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
      expect(
        screen.getByText(/sessão encerrada pelo computador/i)
      ).toBeInTheDocument();
    });
  });

  it("trata erro 409 no pareamento com mensagem de QR já consumido", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=already-used",
      },
      writable: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: "QR code already consumed",
        code: "ALREADY_CONSUMED",
        statusCode: 409,
      }),
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
      expect(
        screen.getByText(/qr code já utilizado por outro aparelho/i)
      ).toBeInTheDocument();
    });
  });

  it("trata erro de rede no pareamento com 'sem conexão com o servidor'", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=network-err-qr",
      },
      writable: true,
    });

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
      expect(
        screen.getByText(/sem conexão com o servidor/i)
      ).toBeInTheDocument();
    });
  });

  it("trata erro HTTP 500 no pareamento com 'servidor temporariamente indisponível'", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=500-qr",
      },
      writable: true,
    });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: "Internal Server Error",
        statusCode: 500,
      }),
    });

    render(<PhonePage />);

    await waitFor(() => {
      expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
      expect(
        screen.getByText(/servidor temporariamente indisponível/i)
      ).toBeInTheDocument();
    });
  });

  it("envia header Authorization com Bearer phoneCredential no upload via XHR", async () => {
    sessionStorage.setItem(
      "dns_phone_cred_session-test-id",
      JSON.stringify({
        phoneCredential: "secret-phone-credential-xyz",
        visualId: "B2N88K",
      })
    );

    const xhrInstances: any[] = [];
    class MockXHR {
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      upload = { onprogress: null };
      status = 201;
      onload: any = null;
      onerror: any = null;

      constructor() {
        xhrInstances.push(this);
      }
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR);

    render(<PhonePage />);

    const input = document.getElementById("phone-file-input") as HTMLInputElement;
    const testFile = new File(["test-content"], "test-photo.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(input, { target: { files: [testFile] } });

    expect(xhrInstances.length).toBe(1);
    const xhr = xhrInstances[0];
    expect(xhr.open).toHaveBeenCalledWith(
      "POST",
      "/api/sessions/session-test-id/files"
    );
    expect(xhr.setRequestHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer secret-phone-credential-xyz"
    );

    vi.unstubAllGlobals();
  });

  it("exibe 'Otimizando...' para foto > 1.2 MB sem bloquear a tela e depois envia comprimida", async () => {
    sessionStorage.setItem(
      "dns_phone_cred_session-test-id",
      JSON.stringify({
        phoneCredential: "secret-phone-credential-xyz",
        visualId: "B2K9",
      })
    );

    const xhrInstances: any[] = [];
    class MockXHR {
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      upload = { onprogress: null };
      status = 201;
      onload: any = null;
      onerror: any = null;

      constructor() {
        xhrInstances.push(this);
      }
    }

    vi.stubGlobal("XMLHttpRequest", MockXHR);

    let resolveCompression: (file: File) => void = () => {};
    vi.mocked(imageCompression).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCompression = resolve;
        })
    );

    render(<PhonePage />);

    const input = document.getElementById("phone-file-input") as HTMLInputElement;
    const bigPhoto = new File(
      [new Uint8Array(2.5 * 1024 * 1024)],
      "foto-pesada.jpg",
      { type: "image/jpeg" }
    );

    fireEvent.change(input, { target: { files: [bigPhoto] } });

    // Mostra estado Otimizando... para a foto
    expect(screen.getByText("Otimizando...")).toBeInTheDocument();
    expect(screen.getByText("foto-pesada.jpg")).toBeInTheDocument();

    // A tela NÃO está bloqueada: o input continua ativo e utilizável
    expect(input).not.toBeDisabled();
    expect(xhrInstances.length).toBe(0);

    // Resolve a compressão para um arquivo menor
    const compressedPhoto = new File(
      [new Uint8Array(900 * 1024)],
      "foto-pesada.jpg",
      { type: "image/jpeg" }
    );
    await act(async () => {
      resolveCompression(compressedPhoto);
    });

    // Estado Otimizando... desaparece e upload inicia
    await waitFor(() => {
      expect(screen.queryByText("Otimizando...")).not.toBeInTheDocument();
      expect(xhrInstances.length).toBe(1);
    });

    const xhr = xhrInstances[0];
    expect(xhr.open).toHaveBeenCalledWith(
      "POST",
      "/api/sessions/session-test-id/files"
    );
    expect(xhr.send).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  describe("Estados de conectividade e avisos", () => {
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
      mockSockets = [];
      vi.stubGlobal("WebSocket", MockWebSocket);
      sessionStorage.setItem(
        "dns_phone_cred_session-test-id",
        JSON.stringify({
          phoneCredential: "phone-secret-cred-123",
          visualId: "X9K22",
        })
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("exibe aviso 'reconectando...' quando conexão WS é perdida", async () => {
      render(<PhonePage />);

      await waitFor(() => {
        expect(mockSockets.length).toBeGreaterThanOrEqual(1);
      });

      const ws = mockSockets[0];
      act(() => {
        ws.receiveMessage({ type: "auth_ok", role: "phone" });
        // Simula desconexão anormal
        ws.close(1006, "Abnormal closure");
      });

      await waitFor(() => {
        expect(screen.getByTestId("status-reconnecting")).toBeInTheDocument();
        expect(screen.getByText(/reconectando\.\.\./i)).toBeInTheDocument();
      });
    });

    it("exibe aviso 'sessão encerrada' ao receber session_closed e bloqueia botão de envio", async () => {
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
        expect(screen.getAllByText(/sessão encerrada/i).length).toBeGreaterThanOrEqual(1);
      });

      const input = document.getElementById("phone-file-input") as HTMLInputElement;
      expect(input).toBeDisabled();
      expect(screen.getByText(/envio bloqueado/i)).toBeInTheDocument();
    });

    it("exibe aviso 'computador desconectado' no aviso de encerramento quando reason é computer_lost", async () => {
      render(<PhonePage />);

      await waitFor(() => {
        expect(mockSockets.length).toBeGreaterThanOrEqual(1);
      });

      const ws = mockSockets[0];
      act(() => {
        ws.receiveMessage({ type: "auth_ok", role: "phone" });
        ws.receiveMessage({ type: "session_closed", reason: "computer_lost" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("status-session-closed")).toBeInTheDocument();
        expect(screen.getByText(/computador desconectado/i)).toBeInTheDocument();
      });
    });
  });
});
