import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageEditor } from "../../components/ImageEditor/ImageEditor.tsx";
const { decodeMock } = vi.hoisted(() => ({ decodeMock: vi.fn() }));
// jsdom has no canvas backend: only decoding and pixel export are stubbed,
// while history/ops stay the real ones.
vi.mock("../../lib/imageEditor/index.ts", async (importOriginal) => {
  const actual = { ...(await importOriginal<Record<string, unknown>>()) };
  return {
    ...actual,
    decodeImage: decodeMock,
    exportImage: vi.fn(async (_source: unknown, _state: unknown, options: { fileName: string; mimeType: string }) =>
      new File([new Uint8Array(4)], options.fileName, { type: options.mimeType }),
    ),
  };
});

function makeFile() {
  return new File([new Uint8Array(8)], "foto.jpg", { type: "image/jpeg" });
}

describe("ImageEditor componente", () => {
  it("renderiza o diálogo com as barras superior e de ferramentas", () => {
    decodeMock.mockReturnValue(new Promise(() => {}));
    render(<ImageEditor file={makeFile()} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Editar imagem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refazer" })).toBeDisabled();
    expect(screen.getByRole("navigation", { name: "Ferramentas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cortar" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Abrindo imagem…")).toBeInTheDocument();
  });

  it("chama onCancel no botão e no Esc", () => {
    decodeMock.mockReturnValue(new Promise(() => {}));
    const onCancel = vi.fn();
    render(<ImageEditor file={makeFile()} onSave={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("mostra erro quando a imagem não decodifica", async () => {
    decodeMock.mockRejectedValue(new Error("Could not decode image"));
    render(<ImageEditor file={makeFile()} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText("Could not decode image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });
});
