import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, Card, ProgressBar, Badge, StatusDot, EmptyState } from "../../components/ui";
import { Upload } from "lucide-react";

describe("Button", () => {
  it("renderiza children", () => {
    render(<Button variant="primary">Enviar</Button>);
    expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
  });

  it("ghost variant renderiza", () => {
    render(<Button variant="ghost">Cancelar</Button>);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("disabled funciona", () => {
    render(<Button disabled>Desabilitado</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("Card", () => {
  it("renderiza children", () => {
    render(<Card>conteúdo</Card>);
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("renderiza role progressbar", () => {
    render(<ProgressBar value={0.5} max={1} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("aria-valuenow reflete percentual", () => {
    render(<ProgressBar value={0.75} max={1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });
});

describe("Badge", () => {
  it("renderiza label", () => {
    render(<Badge label="Concluído" variant="success" />);
    expect(screen.getByText("Concluído")).toBeInTheDocument();
  });
});

describe("StatusDot", () => {
  it("renderiza com aria-label conectado", () => {
    render(<StatusDot connected={true} />);
    expect(screen.getByLabelText(/conectado/i)).toBeInTheDocument();
  });

  it("renderiza desconectado", () => {
    render(<StatusDot connected={false} />);
    expect(screen.getByLabelText(/desconectado/i)).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renderiza title e description", () => {
    render(
      <EmptyState icon={Upload} title="Nenhum arquivo" description="Aguardando envio" />,
    );
    expect(screen.getByText("Nenhum arquivo")).toBeInTheDocument();
    expect(screen.getByText("Aguardando envio")).toBeInTheDocument();
  });
});
