import { describe, it, expect } from "vitest";
import {
  digitsOnly,
  formatCodeGroups,
  normalizeSessionId,
  remainingSeconds,
} from "../../lib/loginCode.ts";

describe("formatCodeGroups", () => {
  it("separa em grupos de 3", () => {
    expect(formatCodeGroups("482913")).toBe("482 913");
    expect(formatCodeGroups("123456789")).toBe("123 456 789");
  });

  it("tolera entrada parcial ou já formatada", () => {
    expect(formatCodeGroups("")).toBe("");
    expect(formatCodeGroups("48")).toBe("48");
    expect(formatCodeGroups("482 913")).toBe("482 913");
  });
});

describe("normalizeSessionId", () => {
  it("aceita maiúsculas, espaços e hífens", () => {
    expect(normalizeSessionId(" p79-xfj ")).toBe("P79XFJ");
    expect(normalizeSessionId("P79 XFJ")).toBe("P79XFJ");
    expect(normalizeSessionId("p79xfj")).toBe("P79XFJ");
  });
});

describe("digitsOnly", () => {
  it("mantém só dígitos e limita o tamanho", () => {
    expect(digitsOnly("48a2 91")).toBe("48291");
    expect(digitsOnly("1234567890")).toBe("123456");
  });
});

describe("remainingSeconds", () => {
  it("arredonda para cima e nunca fica negativo", () => {
    expect(remainingSeconds(10_000, 4_500)).toBe(6);
    expect(remainingSeconds(10_000, 10_000)).toBe(0);
    expect(remainingSeconds(10_000, 12_000)).toBe(0);
  });
});
