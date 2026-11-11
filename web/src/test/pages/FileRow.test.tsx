import { it, expect, describe } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileRow } from "../../pages/computer/FileRow.tsx";
import type { FileEntry } from "../../lib/api.ts";

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
