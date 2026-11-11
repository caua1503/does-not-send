import { useEffect, useRef, useState } from "react";
import {
  Crop,
  Eraser,
  FlipHorizontal2,
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "../ui/Button.tsx";
import { canRedo, canUndo, createImageEditor, decodeImage } from "../../lib/imageEditor/index.ts";
import type { ImageEditorController } from "../../lib/imageEditor/index.ts";
import { EditorStage, type EditorTool } from "./EditorStage.tsx";

interface ImageEditorProps {
  file: File;
  onSave: (file: File) => void;
  onCancel: () => void;
}

const TOOLS: Array<{ tool: EditorTool; label: string; icon: typeof Crop }> = [
  { tool: "crop", label: "Cortar", icon: Crop },
  { tool: "rotate", label: "Girar e espelhar", icon: RotateCw },
  { tool: "draw", label: "Desenhar", icon: Pencil },
  { tool: "text", label: "Texto", icon: Type },
];

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; editor: ImageEditorController };

const actionButton =
  "min-h-[44px] px-3 rounded-[var(--radius-btn)] flex items-center gap-1.5 text-sm font-medium " +
  "transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";

export function ImageEditor({ file, onSave, onCancel }: ImageEditorProps) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [tool, setTool] = useState<EditorTool>("crop");
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<ImageEditorController | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const editor = load.phase === "ready" ? load.editor : null;
  editorRef.current = editor;

  useEffect(() => {
    let cancelled = false;
    let opened: ImageEditorController | null = null;
    decodeImage(file)
      .then((decoded) => {
        if (cancelled) {
          decoded.source.close?.();
          return;
        }
        opened = createImageEditor(file, decoded);
        setLoad({ phase: "ready", editor: opened });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({ phase: "error", message: err instanceof Error ? err.message : "Falha ao abrir imagem" });
      });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [file]);

  // Never leave the decoded bitmap behind (phone memory).
  useEffect(() => {
    const release = () => {
      if (editorRef.current && !editorRef.current.closed) editorRef.current.close();
    };
    // The session may survive pagehide (iOS app switch): free only the bitmap.
    const releaseBitmap = () => {
      const current = editorRef.current;
      if (!current || current.closed) return;
      current.dispose();
      setLoad({ phase: "error", message: "Imagem liberada. Abra novamente para continuar editando." });
    };
    const onPageHide = () => releaseBitmap();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      release();
    };
  }, []);

  useEffect(() => {
    if (load.phase === "ready") layerRef.current?.focus({ preventScroll: true });
  }, [load.phase]);

  async function handleSave() {
    if (!editor || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const edited = await editor.export();
      editor.close();
      onSave(edited);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const change = () => setVersion((v) => v + 1);
  const history = editor?.getHistory();
  const undoable = history ? canUndo(history) : false;
  const redoable = history ? canRedo(history) : false;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Editar imagem"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (tool === "draw" || tool === "text") setTool("crop");
          else onCancel();
          return;
        }
        if (!(e.ctrlKey || e.metaKey) || !editor) return;
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          editor.undo();
          change();
        } else if (key === "y" || (key === "z" && e.shiftKey)) {
          e.preventDefault();
          editor.redo();
          change();
        }
      }}
    >
      <header className="flex items-center justify-between gap-2 px-2 pt-[env(safe-area-inset-top)] sm:px-4">
        <div className="flex items-center">
          <button type="button" className={actionButton} onClick={onCancel} aria-label="Cancelar">
            <X size={20} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Cancelar</span>
          </button>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            className={actionButton}
            onClick={() => {
              editor?.undo();
              change();
            }}
            disabled={!undoable}
            aria-label="Desfazer"
          >
            <Undo2 size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={actionButton}
            onClick={() => {
              editor?.redo();
              change();
            }}
            disabled={!redoable}
            aria-label="Refazer"
          >
            <Redo2 size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <Button
            size="sm"
            className="ml-2"
            onClick={handleSave}
            disabled={!editor || saving}
            aria-label="Salvar"
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </header>

      <div ref={layerRef} tabIndex={-1} className="min-h-0 flex-1 outline-none">
        {load.phase === "loading" && (
          <div className="h-full flex items-center justify-center text-sm text-white/70">Abrindo imagem…</div>
        )}
        {load.phase === "error" && (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/80">
            <p>{load.message}</p>
            <Button
              variant="ghost"
              size="sm"
              className="text-white"
              onClick={() => setLoad({ phase: "loading" })}
            >
              Reabrir
            </Button>
            <Button variant="ghost" size="sm" className="text-white" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        )}
        {load.phase === "ready" && editor && (
          <EditorStage
            editor={editor}
            version={version}
            tool={tool}
            onToolChange={setTool}
            onCommit={change}
          />
        )}
      </div>

      <footer className="flex flex-col pb-[env(safe-area-inset-bottom)]">
        {saveError && (
          <p role="alert" className="px-4 pb-1 text-center text-xs text-[var(--color-error)]">
            {saveError}
          </p>
        )}
        {editor && tool === "rotate" && (
          <div className="flex justify-center gap-1 px-2 pb-2">
            <button type="button" className={actionButton} aria-label="Girar para a esquerda"
              onClick={() => { editor.apply({ type: "rotate-ccw" }); change(); }}>
              <RotateCcw size={20} aria-hidden="true" />
            </button>
            <button type="button" className={actionButton} aria-label="Girar para a direita"
              onClick={() => { editor.apply({ type: "rotate" }); change(); }}>
              <RotateCw size={20} aria-hidden="true" />
            </button>
            <button type="button" className={actionButton} aria-label="Espelhar horizontalmente"
              onClick={() => { editor.apply({ type: "flip-horizontal" }); change(); }}>
              <FlipHorizontal2 size={20} aria-hidden="true" />
            </button>
          </div>
        )}
        {editor && (tool === "draw" || tool === "text") && (
          <div className="flex justify-center px-2 pb-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-white/60">
              {tool === "draw" ? <Eraser size={14} aria-hidden="true" /> : <Type size={14} aria-hidden="true" />}
              {tool === "draw" ? "Toque para desenhar · use a borracha para apagar" : "Toque na imagem para escrever"}
            </span>
          </div>
        )}
        <nav
          className="flex items-center justify-around border-t border-white/10"
          aria-label="Ferramentas"
        >
          {TOOLS.map(({ tool: id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              disabled={!editor}
              aria-pressed={tool === id}
              className={`min-h-[56px] flex-1 flex flex-col items-center justify-center gap-1 text-xs transition-colors disabled:opacity-40 ${
                tool === id ? "text-white" : "text-white/60 hover:text-white"
              }`}
            >
              <Icon size={22} strokeWidth={tool === id ? 2.25 : 1.75} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </footer>
    </div>
  );
}
