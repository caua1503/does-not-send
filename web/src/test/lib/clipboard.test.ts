import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "../../lib/clipboard.ts";

afterEach(() => vi.restoreAllMocks());

function setSecure(secure: boolean) {
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
}

it("copia pelo Clipboard API em contexto seguro", async () => {
  setSecure(true);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });

  await expect(copyText("A7K92F")).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith("A7K92F");
});

it("usa execCommand quando o Clipboard API não existe", async () => {
  setSecure(true);
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  const execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

  await expect(copyText("482913")).resolves.toBe(true);
  expect(execCommand).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
});

it("usa execCommand quando a página não é contexto seguro", async () => {
  setSecure(false);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

  await expect(copyText("texto")).resolves.toBe(true);
  expect(writeText).not.toHaveBeenCalled();
  expect(execCommand).toHaveBeenCalledWith("copy");
});

it("retorna false quando o fallback falha", async () => {
  setSecure(false);
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  Object.defineProperty(document, "execCommand", {
    value: vi.fn().mockReturnValue(false),
    configurable: true,
  });

  await expect(copyText("texto")).resolves.toBe(false);
});
