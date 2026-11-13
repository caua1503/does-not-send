import { it, expect, describe, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";

describe("useSessionEvents", () => {
  it("retorna files vazio e connected false quando sessionId é null", () => {
    const { result } = renderHook(() => useSessionEvents(null, null));
    expect(result.current.files).toEqual([]);
    expect(result.current.connected).toBe(false);
  });

  it("retorna files vazio e connected false quando token é null", () => {
    const { result } = renderHook(() => useSessionEvents("session-123", null));
    expect(result.current.files).toEqual([]);
    expect(result.current.connected).toBe(false);
  });

  describe("WebSocket lifecycle and messaging", () => {
    let mockSockets: MockWebSocket[] = [];

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

      // Test helper
      receiveMessage(data: Record<string, unknown>) {
        if (this.onmessage) {
          this.onmessage({ data: JSON.stringify(data) });
        }
      }
    }

    beforeEach(() => {
      vi.useFakeTimers();
      mockSockets = [];
      vi.stubGlobal("WebSocket", MockWebSocket);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("envia auth primeiro ao conectar com role e secret", () => {
      const { result } = renderHook(() =>
        useSessionEvents("session-1", "phone-cred", { role: "phone" })
      );

      // Avança timer do constructor
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(mockSockets.length).toBe(1);
      const ws = mockSockets[0]!;
      expect(ws.sentMessages.length).toBe(1);
      expect(JSON.parse(ws.sentMessages[0]!)).toEqual({
        type: "auth",
        role: "phone",
        secret: "phone-cred",
      });
      expect(result.current.connected).toBe(false);

      // Backend responde auth_ok
      act(() => {
        ws.receiveMessage({ type: "auth_ok", role: "phone" });
      });

      expect(result.current.connected).toBe(true);
    });

    it("envia heartbeat a cada 10s após autenticação", () => {
      renderHook(() =>
        useSessionEvents("session-1", "comp-token", { role: "computer" })
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const ws = mockSockets[0]!;
      // Autentica
      act(() => {
        ws.receiveMessage({ type: "auth_ok", role: "computer" });
      });

      // Avança 9s: nenhum heartbeat ainda
      act(() => {
        vi.advanceTimersByTime(9000);
      });
      expect(ws.sentMessages.filter((m) => JSON.parse(m).type === "heartbeat").length).toBe(0);

      // Avança +1s (total 10s): 1 heartbeat enviado
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(ws.sentMessages.filter((m) => JSON.parse(m).type === "heartbeat").length).toBe(1);

      // Avança mais 10s: 2º heartbeat enviado
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(ws.sentMessages.filter((m) => JSON.parse(m).type === "heartbeat").length).toBe(2);
    });

    it("reconecta automaticamente a cada 2s para o telefone", () => {
      const { result } = renderHook(() =>
        useSessionEvents("session-1", "phone-cred", { role: "phone", reconnectInterval: 2000 })
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(mockSockets.length).toBe(1);
      const ws1 = mockSockets[0]!;

      // Autentica ws1
      act(() => {
        ws1.receiveMessage({ type: "auth_ok", role: "phone" });
      });
      expect(result.current.connected).toBe(true);

      // Queda de conexão (código anormal, ex 1006)
      act(() => {
        ws1.close(1006, "Connection dropped");
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.reconnecting).toBe(true);

      // Avança 1s: ainda não reconectou
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockSockets.length).toBe(1);

      // Avança +1s (total 2s): reconexão tentada
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(mockSockets.length).toBe(2);

      const ws2 = mockSockets[1]!;
      act(() => {
        vi.advanceTimersByTime(1);
      });

      // Novo socket envia auth imediatamente
      expect(ws2.sentMessages.length).toBe(1);
      expect(JSON.parse(ws2.sentMessages[0]!)).toEqual({
        type: "auth",
        role: "phone",
        secret: "phone-cred",
      });
    });

    it("ao receber session_closed encerra e bloqueia reconexão", () => {
      const onClosed = vi.fn();
      const { result } = renderHook(() =>
        useSessionEvents("session-1", "phone-cred", {
          role: "phone",
          onSessionClosed: onClosed,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const ws = mockSockets[0]!;
      act(() => {
        ws.receiveMessage({ type: "auth_ok", role: "phone" });
        ws.receiveMessage({ type: "session_closed", reason: "user_closed" });
      });

      expect(result.current.sessionClosed).toBe(true);
      expect(result.current.closedReason).toBe("user_closed");
      expect(result.current.connected).toBe(false);
      expect(result.current.reconnecting).toBe(false);
      expect(onClosed).toHaveBeenCalledWith("user_closed");

      // Avança o tempo para garantir que não tenta reconectar
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(mockSockets.length).toBe(1);
    });

    it("reconecta após fechamento 4001 quando a sessão ainda existe no servidor", async () => {
      // Bug: fechar com 4001 bloqueava reconexão mesmo com token válido
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "session-1", state: "WAITING" }) });
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() =>
        useSessionEvents("session-1", "phone-cred", { role: "phone", reconnectInterval: 2000 })
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(mockSockets.length).toBe(1);
      const ws1 = mockSockets[0]!;

      // Servidor fecha com 4001 (auth timeout — rede lenta, não token inválido)
      act(() => {
        ws1.close(4001, "Auth timeout");
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.reconnecting).toBe(true);

      // Confirma via GET que a sessão existe, depois reconecta após 2s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/sessions/session-1"),
        expect.anything(),
      );
      expect(mockSockets.length).toBe(2);
      const ws2 = mockSockets[1]!;
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(JSON.parse(ws2.sentMessages[0]!).type).toBe("auth");
    });

    it("para de reconectar em 4001 quando GET /api/sessions retorna 401", async () => {
      // Sessão sumiu do backend (restart): retry infinito martelava o proxy
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
      vi.stubGlobal("fetch", fetchMock);
      const onClosed = vi.fn();

      const { result } = renderHook(() =>
        useSessionEvents("session-gone", "stale-token", {
          role: "computer",
          reconnectInterval: 2000,
          onSessionClosed: onClosed,
        })
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const ws1 = mockSockets[0]!;
      await act(async () => {
        ws1.close(4001, "Session not found");
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.reconnecting).toBe(false);
      expect(result.current.sessionClosed).toBe(true);
      expect(onClosed).toHaveBeenCalledWith("session_expired");

      // Nenhuma reconexão depois de vários ciclos
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(mockSockets.length).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("computador pode enviar mensagem close via sendClose", () => {
      const { result } = renderHook(() =>
        useSessionEvents("session-1", "comp-token", { role: "computer" })
      );

      act(() => {
        vi.advanceTimersByTime(1);
      });

      const ws = mockSockets[0]!;
      act(() => {
        ws.receiveMessage({ type: "auth_ok", role: "computer" });
      });

      act(() => {
        result.current.sendClose();
      });

      expect(ws.sentMessages).toContain(JSON.stringify({ type: "close" }));
    });
  });
});
