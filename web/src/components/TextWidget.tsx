import { useRef, useState } from "react";
import { MessageSquareText, Send } from "lucide-react";
import { Button } from "./ui/Button.tsx";
import { TEXT_MAX_LENGTH } from "../lib/textFile.ts";

const MAX_TEXTAREA_HEIGHT = 200;

interface TextWidgetProps {
  onSend: (text: string) => boolean;
  disabled?: boolean;
  error?: string | null;
}

export function TextWidget({ onSend, disabled = false, error }: TextWidgetProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  };

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    if (!onSend(text)) return;
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  return (
    <div className="border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center text-[var(--color-accent)]">
          <MessageSquareText size={16} strokeWidth={1.75} />
        </div>
        <h2 className="font-semibold text-sm text-[var(--color-text)]">Enviar texto</h2>
      </div>

      <textarea
        ref={textareaRef}
        rows={3}
        maxLength={TEXT_MAX_LENGTH}
        value={value}
        disabled={disabled}
        placeholder="Digite ou cole um texto..."
        aria-label="Texto para enviar"
        onChange={(e) => {
          setValue(e.target.value);
          resize();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full resize-none rounded-[var(--radius-input)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
      />

      {error && (
        <p role="alert" className="text-xs text-[var(--color-error)]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--color-text-muted)] tabular">
          {value.length}/{TEXT_MAX_LENGTH}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={disabled || !value.trim()}
        >
          <Send size={14} strokeWidth={1.75} />
          Enviar
        </Button>
      </div>
    </div>
  );
}
