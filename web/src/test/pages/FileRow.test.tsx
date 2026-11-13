import { it, expect, describe, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { FileRow } from "../../pages/computer/FileRow.tsx";
import type { FileEntry } from "../../lib/api.ts";

const { copyText } = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock("../../lib/clipboard.ts", () => ({ copyText }));

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: "file-1",
    originalName: "foto.png",
    mimeType: "image/png",
    size: 1024,
    bytesReceived: 1024,
    state: "completed",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const previewTitle = () => screen.queryByRole("heading", { name: "foto.png", level: 2 });

function renderRow(file: FileEntry) {
  return render(
    <FileRow file={file} sessionId="sess" ownerToken="token" />
  );
}

describe("FileRow clique na linha", () => {
  it("abre o preview ao clicar na linha de uma imagem concluída", () => {
    renderRow(makeFile());
    expect(previewTitle()).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("foto.png"));
    expect(previewTitle()).toBeInTheDocument();
  });

  it("abre o preview com Enter e com Espaço", () => {
    renderRow(makeFile());
    const row = screen.getByText("foto.png").closest("[role='button']")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(previewTitle()).toBeInTheDocument();
    fireEvent.keyDown(row, { key: " " });
    expect(previewTitle()).toBeInTheDocument();
  });

  it("não abre o preview ao clicar no botão de download", () => {
    const { container } = renderRow(makeFile());
    const link = container.querySelector<HTMLAnchorElement>("a[download]")!;
    link.click();
    expect(previewTitle()).not.toBeInTheDocument();
  });

  it("arquivo não-imagem concluído não torna a linha clicável", () => {
    renderRow(makeFile({ originalName: "doc.pdf", mimeType: "application/pdf" }));
    const name = screen.getByText("doc.pdf");
    expect(name.closest("[role='button']")).toBeNull();
    fireEvent.click(name);
    expect(previewTitle()).not.toBeInTheDocument();
  });

  it("arquivo em recebimento não torna a linha clicável", () => {
    renderRow(makeFile({ state: "receiving", bytesReceived: 10 }));
    const name = screen.getByText("foto.png");
    expect(name.closest("[role='button']")).toBeNull();
  });
});

describe("FileRow texto", () => {
  const text = "linha 1\nlinha 2";

  beforeEach(() => {
    copyText.mockReset();
    copyText.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => text })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderTextRow() {
    return renderRow(
      makeFile({
        originalName: "Texto 14-32-05.txt",
        mimeType: "text/plain; charset=utf-8",
        kind: "text",
        size: 15,
      })
    );
  }

  it("mostra as primeiras linhas no item e o texto completo no preview", async () => {
    renderTextRow();

    expect(
      await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === text)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Texto 14-32-05.txt"));

    expect(
      screen.getByRole("heading", { name: "Texto 14-32-05.txt", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === text)
    ).toBeInTheDocument();
  });

  it("copia o texto e mostra feedback por 1,5s", async () => {
    renderTextRow();

    fireEvent.click(
      await screen.findByRole("button", { name: /copiar texto 14-32-05\.txt/i })
    );

    expect(await screen.findByRole("button", { name: "Copiado!" })).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledWith(text);

    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /copiar texto 14-32-05\.txt/i })
        ).toBeInTheDocument(),
      { timeout: 2500 }
    );
  });

  it("mostra prévia de 3 linhas no card e não interpreta HTML", async () => {
    const html = '<script>alert("x")</script>\n😀 linha 2';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => html }));
    const { container } = renderTextRow();

    const snippet = await screen.findByText(
      (_, el) => el?.tagName === "P" && el.textContent === html
    );
    expect(snippet.className).toContain("line-clamp-3");
    expect(snippet.textContent).toContain("<script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("preserva quebras de linha e emojis na pré-visualização", async () => {
    const content = "linha 1\nlinha 2 😀\nlinha 3";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => content }));
    renderTextRow();

    await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === content);
    fireEvent.click(screen.getByText("Texto 14-32-05.txt"));

    const pre = screen.getByLabelText("Conteúdo de Texto 14-32-05.txt");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe(content);
    expect(pre.className).toContain("whitespace-pre-wrap");
    expect(pre.className).toContain("font-mono");
  });

  it("copia pelo botão da pré-visualização com feedback", async () => {
    renderTextRow();

    await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === text);
    fireEvent.click(screen.getByText("Texto 14-32-05.txt"));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Copiar texto" }));

    expect(
      await within(dialog).findByRole("button", { name: "Copiado!" })
    ).toBeInTheDocument();
    expect(copyText).toHaveBeenCalledWith(text);
  });

  it("ao falhar a cópia, avisa e seleciona o texto", async () => {
    copyText.mockResolvedValue(false);
    renderTextRow();

    await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === text);
    fireEvent.click(screen.getByText("Texto 14-32-05.txt"));

    const dialog = screen.getByRole("dialog");
    const pre = within(dialog).getByLabelText("Conteúdo de Texto 14-32-05.txt");
    fireEvent.click(within(dialog).getByRole("button", { name: "Copiar texto" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Não foi possível copiar"
    );
    expect(window.getSelection()?.toString()).toContain("linha 1");

    window.getSelection()?.removeAllRanges();
    fireEvent.doubleClick(pre);
    expect(window.getSelection()?.toString()).toBe(text);
  });

  it("mostra erro quando o texto não carrega", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    renderTextRow();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar o texto"
    );

    fireEvent.click(screen.getByText("Texto 14-32-05.txt"));
    expect(
      screen.getByLabelText("Conteúdo de Texto 14-32-05.txt")
    ).toHaveTextContent("Não foi possível carregar o texto");
  });

  it("falha na cópia do card abre a prévia com o texto selecionado", async () => {
    copyText.mockResolvedValue(false);
    renderTextRow();

    fireEvent.click(
      await screen.findByRole("button", { name: /copiar texto 14-32-05\.txt/i })
    );

    expect(await screen.findByText("Não foi possível copiar")).toBeInTheDocument();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(window.getSelection()?.toString()).toContain("linha 1"));
  });
});
