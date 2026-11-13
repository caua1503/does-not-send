import { StrictMode } from "react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import imageCompression from "browser-image-compression";
import PhonePage from "../../pages/phone/PhonePage.tsx";

vi.mock("browser-image-compression", () => {
  return {
    default: vi.fn(),
  };
});

const heic2any = vi.fn();

vi.mock("heic2any", () => {
  return { default: heic2any };
});

describe("PhonePage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
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
    localStorage.clear();
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

  it("conclui o pareamento sob StrictMode (efeitos remontados)", async () => {
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/enviar/session-test-id",
        search: "?qrToken=strict-mode-qr",
      },
      writable: true,
    });

    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        phoneCredential: "strict-cred",
        visualId: "S7T23C",
        state: "PAIRED",
      }),
    }));

    render(
      <StrictMode>
        <PhonePage />
      </StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
    });
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
      expect(screen.getByText(/escaneie o qr code novamente/i)).toBeInTheDocument();
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
    localStorage.setItem(
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

  it("envia texto como arquivo na mesma lista (?kind=text)", () => {
    localStorage.setItem(
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

    fireEvent.change(screen.getByPlaceholderText("Digite ou cole um texto..."), {
      target: { value: "  meu texto  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

    expect(xhrInstances.length).toBe(1);
    expect(xhrInstances[0].open).toHaveBeenCalledWith(
      "POST",
      "/api/sessions/session-test-id/files?kind=text"
    );
    expect(xhrInstances[0].send).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Texto \d\d-\d\d-\d\d\.txt/)).toBeInTheDocument();
    expect(screen.getByText("0/1 enviados")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Digite ou cole um texto...")).toHaveValue("");

    vi.unstubAllGlobals();
  });

  it("exibe 'Otimizando...' para foto > 1.2 MB sem bloquear a tela e depois envia comprimida", async () => {
    localStorage.setItem(
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

    const compressedPhoto = new File(
      [new Uint8Array(900 * 1024)],
      "foto-pesada.jpg",
      { type: "image/jpeg" }
    );
    let resolveCompression: (file: File) => void = () => {};
    vi.mocked(imageCompression).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCompression = resolve;
        })
        .then(() => compressedPhoto)
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

    // Resolve a compressão com o arquivo menor
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

  it("falha só no item HEIC quando a conversão falha, sem travar os demais", async () => {
    localStorage.setItem(
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
    heic2any.mockReset();
    heic2any.mockRejectedValue(new Error("libheif error"));

    render(<PhonePage />);

    const input = document.getElementById("phone-file-input") as HTMLInputElement;
    const heic = new File(["heic-content"], "IMG_0001.HEIC", { type: "image/heic" });
    const pdf = new File(["pdf-content"], "doc.pdf", { type: "application/pdf" });

    await act(async () => {
      fireEvent.change(input, { target: { files: [heic, pdf] } });
    });

    expect(await screen.findByText("Não foi possível converter a imagem HEIC")).toBeInTheDocument();
    expect(heic2any).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Otimizando...")).not.toBeInTheDocument();
    // PDF segue direto para o upload
    expect(xhrInstances.length).toBe(1);

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
      localStorage.setItem(
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
  });
});
