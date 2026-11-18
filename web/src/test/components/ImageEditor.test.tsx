import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageEditor } from "../../components/ImageEditor/ImageEditor.tsx";
const { decodeMock } = vi.hoisted(() => ({ decodeMock: vi.fn() }));
vi.mock("../../lib/imageEditor/index.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decodeImage: decodeMock,
}));

afterEach(() => {
  decodeMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function decodedImage() {
  return { source: { close: vi.fn() }, size: { width: 240, height: 180 } };
}

function mockCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
}

function mockStageLayout() {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(180);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const { width, height } = this.parentElement!.style;
    return new DOMRect(0, 0, parseFloat(width), parseFloat(height));
  });
}

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

  it("redimensiona pela lateral sem salto nem mudança no outro eixo", async () => {
    mockCanvas();
    mockStageLayout();
    decodeMock.mockResolvedValue(decodedImage());
    render(<ImageEditor file={makeFile()} onSave={vi.fn()} onCancel={vi.fn()} />);
    const handle = await screen.findByLabelText("Alça direita");
    const frame = screen.getByLabelText("Área de corte");
    const stage = frame.closest(".touch-none") as HTMLDivElement;
    stage.setPointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 220, clientY: 90 });
    fireEvent.pointerMove(stage, { clientX: 190, clientY: 110 });
    fireEvent.pointerUp(stage);

    expect(frame).toHaveStyle({ width: "210px", height: "180px" });
  });

  it("recria o quadro e aplica dois cortes seguidos", async () => {
    mockCanvas();
    mockStageLayout();
    decodeMock.mockResolvedValue(decodedImage());
    render(<ImageEditor file={makeFile()} onSave={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByLabelText("Alça direita");
    const canvas = screen.getByLabelText("Prévia da imagem") as HTMLCanvasElement;
    const apply = screen.getByRole("button", { name: "Aplicar corte" });

    for (const expectedWidth of [210, 180]) {
      const handle = screen.getByLabelText("Alça direita");
      const stage = handle.closest(".select-none") as HTMLDivElement;
      stage.setPointerCapture = vi.fn();
      fireEvent.pointerDown(handle, { clientX: expectedWidth + 10, clientY: 90 });
      fireEvent.pointerMove(stage, { clientX: expectedWidth - 20, clientY: 90 });
      fireEvent.pointerUp(stage);
      fireEvent.click(apply);

      expect(canvas.width).toBe(expectedWidth);
      expect(canvas.height).toBe(180);
      expect(screen.getByLabelText("Área de corte")).toBeInTheDocument();
      expect(apply).toBeEnabled();
    }
  });

  it("reabre após pagehide, redecodifica e mantém a edição", async () => {
    mockCanvas();
    const original = decodedImage();
    decodeMock.mockResolvedValueOnce(original).mockResolvedValueOnce(decodedImage());
    const file = makeFile();
    render(<ImageEditor file={file} onSave={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByLabelText("Área de corte");
    fireEvent.click(screen.getByRole("button", { name: "Girar e espelhar" }));
    fireEvent.click(screen.getByRole("button", { name: "Espelhar verticalmente" }));
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeEnabled();

    fireEvent(window, new Event("pagehide"));
    expect(original.source.close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));

    await screen.findByLabelText("Prévia da imagem");
    expect(decodeMock).toHaveBeenCalledTimes(2);
    expect(decodeMock).toHaveBeenLastCalledWith(file);
    expect(original.source.close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeEnabled();
  });
});
