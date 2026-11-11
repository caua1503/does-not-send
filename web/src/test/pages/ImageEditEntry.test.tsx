import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileRow } from "../../pages/computer/FileRow.tsx";
import PhonePage from "../../pages/phone/PhonePage.tsx";
import type { FileEntry } from "../../lib/api.ts";

vi.mock("browser-image-compression", () => ({ default: vi.fn() }));
vi.mock("heic2any", () => ({ default: vi.fn() }));

const previewTitle = () => screen.queryByRole("heading", { name: "foto.png", level: 2 });

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

function renderRow(file: FileEntry) {
  return render(<FileRow file={file} sessionId="sess" ownerToken="token" />);
}

describe("FileRow lápis de edição", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(4)], { type: "image/png" }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("mostra o lápis só para imagem editável concluída", () => {
    renderRow(makeFile());
    expect(screen.getByRole("button", { name: "Editar foto.png" })).toBeInTheDocument();
  });

  it("não mostra o lápis para HEIC", () => {
    renderRow(makeFile({ mimeType: "image/heic" }));
    expect(screen.queryByRole("button", { name: "Editar foto.png" })).toBeNull();
  });

  it("não mostra o lápis para arquivo não-imagem", () => {
    renderRow(makeFile({ mimeType: "application/pdf" }));
    expect(screen.queryByRole("button", { name: "Editar foto.png" })).toBeNull();
  });

  it("clicar no lápis não abre o preview da linha", async () => {
    renderRow(makeFile());
    const pencil = screen.getByRole("button", { name: "Editar foto.png" });
    expect(pencil.closest("[role='button']")).not.toBeNull();
    fireEvent.click(pencil);
    expect(previewTitle()).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Editar imagem" })).toBeInTheDocument());
    expect(previewTitle()).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain(`/api/sessions/sess/files/file-1/download?token=token`);
  });
});

describe("PhonePage lápis de edição", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "dns_phone_cred_session-test-id",
      JSON.stringify({ phoneCredential: "cred-phone", visualId: "AB12" })
    );
    Object.defineProperty(window, "location", {
      value: { origin: "http://localhost:3000", pathname: "/enviar/session-test-id", search: "" },
      writable: true,
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ state: "PAIRED" }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("mostra o lápis só para imagem editável enviada com remoteId", async () => {
    const xhrInstances: MockXHR[] = [];
    class MockXHR {
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      upload = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ files: [{ id: "remote-1" }] });
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        xhrInstances.push(this);
      }
    }
    vi.stubGlobal("XMLHttpRequest", MockXHR);

    render(<PhonePage />);
    const input = document.getElementById("phone-file-input") as HTMLInputElement;
    const file = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(xhrInstances).toHaveLength(1);
    xhrInstances[0]!.onload!();

    expect(await screen.findByRole("button", { name: "Editar foto.jpg" })).toBeInTheDocument();
  });

  it("não mostra o lápis para HEIC", async () => {
    class MockXHR {
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      upload = { onprogress: null };
      status = 201;
      responseText = JSON.stringify({ files: [{ id: "remote-2" }] });
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
    }
    const instances: MockXHR[] = [];
    const Ctor = function (this: MockXHR) {
      const inst = new MockXHR();
      instances.push(inst);
      return inst;
    } as unknown as typeof XMLHttpRequest;
    vi.stubGlobal("XMLHttpRequest", Ctor);

    render(<PhonePage />);
    const input = document.getElementById("phone-file-input") as HTMLInputElement;
    const file = new File(["x"], "foto.heic", { type: "image/heic" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText(/Não foi possível converter a imagem HEIC/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar foto.heic" })).toBeNull();
  });
});
