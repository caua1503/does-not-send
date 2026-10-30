import { it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionEvents } from "../../hooks/useSessionEvents.ts";

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
