import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import PhonePage from "../../pages/phone/PhonePage.tsx";

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
});
