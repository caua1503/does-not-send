import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PhonePage from "../../pages/phone/PhonePage.tsx";

describe("PhonePage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: {
        pathname: "/enviar/session-test-id",
        search: "?token=upload-token-test",
      },
      writable: true,
    });
  });

  it("renderiza área de escolher arquivos quando URL válida", () => {
    render(<PhonePage />);
    expect(screen.getByText(/escolher arquivos/i)).toBeInTheDocument();
  });

  it("renderiza erro de sessão se token não for passado", () => {
    Object.defineProperty(window, "location", {
      value: {
        pathname: "/enviar/session-test-id",
        search: "",
      },
      writable: true,
    });

    render(<PhonePage />);
    expect(screen.getByText(/sessão indisponível/i)).toBeInTheDocument();
  });
});
