import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClosedCountdown } from "../../hooks/useClosedCountdown.ts";

describe("useClosedCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("começa em 10 e diminui a cada segundo", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useClosedCountdown(true, onElapsed));

    expect(result.current.seconds).toBe(10);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.seconds).toBe(9);

    act(() => vi.advanceTimersByTime(8000));
    expect(result.current.seconds).toBe(1);
    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("ao chegar a 0 chama o fluxo de saída exatamente uma vez", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useClosedCountdown(true, onElapsed));

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.seconds).toBe(0);
    expect(onElapsed).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20_000));
    expect(onElapsed).toHaveBeenCalledTimes(1);
  });

  it("cancelar impede o disparo posterior", () => {
    const onElapsed = vi.fn();
    const { result } = renderHook(() => useClosedCountdown(true, onElapsed));

    act(() => vi.advanceTimersByTime(4000));
    act(() => result.current.cancel());
    act(() => vi.advanceTimersByTime(20_000));

    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("desmontar cancela o timer", () => {
    const onElapsed = vi.fn();
    const { unmount } = renderHook(() => useClosedCountdown(true, onElapsed));

    act(() => vi.advanceTimersByTime(5000));
    unmount();
    act(() => vi.advanceTimersByTime(20_000));

    expect(onElapsed).not.toHaveBeenCalled();
  });

  it("não reinicia com sessão fechada repetida nem com callback novo", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(
      ({ onDone }: { onDone: () => void }) => useClosedCountdown(true, onDone),
      { initialProps: { onDone: first } },
    );

    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.seconds).toBe(6);

    rerender({ onDone: latest });
    expect(result.current.seconds).toBe(6);

    act(() => vi.advanceTimersByTime(6000));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("anuncia no início e perto do fim, sem mudar a cada segundo", () => {
    const { result } = renderHook(() => useClosedCountdown(true, vi.fn()));

    expect(result.current.announcement).toMatch(/10 segundos/);

    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.announcement).toMatch(/10 segundos/);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.announcement).toMatch(/3 segundos/);
  });
});
