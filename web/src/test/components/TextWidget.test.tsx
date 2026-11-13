import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextWidget } from "../../components/TextWidget.tsx";

describe("TextWidget", () => {
  it("desabilita o envio sem texto", () => {
    render(<TextWidget onSend={() => true} />);

    expect(screen.getByText("Enviar texto")).toBeInTheDocument();
    expect(screen.getByText("0/10000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar/i })).toBeDisabled();
  });

  it("envia texto sem espaços nas pontas e limpa o campo", () => {
    const onSend = vi.fn().mockReturnValue(true);
    render(<TextWidget onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Digite ou cole um texto...");
    fireEvent.change(textarea, { target: { value: "  olá mundo  " } });
    expect(screen.getByText("13/10000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

    expect(onSend).toHaveBeenCalledWith("olá mundo");
    expect(textarea).toHaveValue("");
    expect(screen.getByText("0/10000")).toBeInTheDocument();
  });

  it("envia com Ctrl+Enter e com Cmd+Enter", () => {
    const onSend = vi.fn().mockReturnValue(true);
    render(<TextWidget onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("Digite ou cole um texto...");
    fireEvent.change(textarea, { target: { value: "atalho" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    fireEvent.change(textarea, { target: { value: "atalho mac" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(onSend).toHaveBeenNthCalledWith(1, "atalho");
    expect(onSend).toHaveBeenNthCalledWith(2, "atalho mac");
  });

  it("mantém o texto quando o envio é recusado", () => {
    render(<TextWidget onSend={() => false} />);

    const textarea = screen.getByPlaceholderText("Digite ou cole um texto...");
    fireEvent.change(textarea, { target: { value: "não perde" } });
    fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

    expect(textarea).toHaveValue("não perde");
  });

  it("mostra erro e bloqueia envio quando desabilitado", () => {
    render(<TextWidget onSend={() => true} disabled error="Muitos textos enviados. Aguarde alguns segundos." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Muitos textos enviados");
    expect(screen.getByRole("button", { name: /enviar/i })).toBeDisabled();
    expect(screen.getByPlaceholderText("Digite ou cole um texto...")).toBeDisabled();
  });
});
