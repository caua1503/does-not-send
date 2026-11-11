import { describe, it, expect } from "vitest";
import { sessionReducer, type SessionState } from "../../lib/sessionReducer.ts";

const empty: SessionState = { files: [] };

describe("sessionReducer", () => {
  it("adiciona arquivo via file:state-changed", () => {
    const s = sessionReducer(empty, {
      type: "file:state-changed",
      fileId: "f1",
      state: "receiving",
      originalName: "a.jpg",
      size: 100,
      bytesReceived: 0,
    });
    expect(s.files).toHaveLength(1);
    expect(s.files[0]!.id).toBe("f1");
    expect(s.files[0]!.originalName).toBe("a.jpg");
  });

  it("atualiza progresso via file:progress", () => {
    const s0 = sessionReducer(empty, {
      type: "file:state-changed",
      fileId: "f1",
      state: "receiving",
      originalName: "a.jpg",
      size: 100,
      bytesReceived: 0,
    });
    const s1 = sessionReducer(s0, {
      type: "file:progress",
      fileId: "f1",
      bytesReceived: 50,
      size: 100,
    });
    expect(s1.files[0]!.bytesReceived).toBe(50);
  });

  it("atualiza estado para completed", () => {
    const s0 = sessionReducer(empty, {
      type: "file:state-changed",
      fileId: "f1",
      state: "receiving",
      originalName: "a.jpg",
      size: 100,
      bytesReceived: 0,
    });
    const s1 = sessionReducer(s0, {
      type: "file:state-changed",
      fileId: "f1",
      state: "completed",
      originalName: "a.jpg",
      size: 100,
      bytesReceived: 100,
    });
    expect(s1.files[0]!.state).toBe("completed");
    expect(s1.files).toHaveLength(1);
  });

  it("atualiza item existente com metadados e version na substituição", () => {
    const s0 = sessionReducer(empty, {
      type: "file:state-changed",
      fileId: "f1",
      state: "completed",
      originalName: "notes.txt",
      size: 10,
      bytesReceived: 10,
      mimeType: "text/plain",
      version: 1,
    });
    expect(s0.files[0]!.version).toBe(1);

    const s1 = sessionReducer(s0, {
      type: "file:state-changed",
      fileId: "f1",
      state: "completed",
      originalName: "notes.jpg",
      size: 42,
      bytesReceived: 42,
      mimeType: "image/jpeg",
      version: 2,
    });
    expect(s1.files).toHaveLength(1);
    expect(s1.files[0]).toMatchObject({
      id: "f1",
      originalName: "notes.jpg",
      mimeType: "image/jpeg",
      size: 42,
      bytesReceived: 42,
      version: 2,
    });
  });

  it("não duplica arquivo existente", () => {
    const ev = {
      type: "file:state-changed" as const,
      fileId: "f1",
      state: "receiving" as const,
      originalName: "a.jpg",
      size: 100,
      bytesReceived: 0,
    };
    const s = sessionReducer(sessionReducer(empty, ev), ev);
    expect(s.files).toHaveLength(1);
  });

  it("ignora file:progress de arquivo inexistente", () => {
    const s = sessionReducer(empty, {
      type: "file:progress",
      fileId: "nonexistent",
      bytesReceived: 50,
      size: 100,
    });
    expect(s.files).toHaveLength(0);
    expect(s).toBe(empty); // same reference — no mutation
  });
});
