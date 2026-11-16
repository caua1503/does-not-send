import type { ChangeEvent, RefObject } from "react";
import { Upload } from "lucide-react";
import { ProgressBar } from "./ui/ProgressBar.tsx";
import { TextWidget } from "./TextWidget.tsx";
import { UploadItem, type GuestUploadItem } from "../pages/guest/UploadItem.tsx";

interface UploadAreaProps {
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  items: GuestUploadItem[];
  textError?: string | null;
  totalFiles: number;
  completedFiles: number;
  onFilesChosen: (event: ChangeEvent<HTMLInputElement>) => void;
  onSendText: (text: string) => boolean;
  onRetry: (id: string) => void;
  onEdit?: (id: string) => void;
  chooseLabel?: string;
  chooseHint?: string;
}

/** File/text entry and local upload queue, shared by oneway and twoway. */
export function UploadArea({
  inputId,
  inputRef,
  disabled,
  items,
  textError,
  totalFiles,
  completedFiles,
  onFilesChosen,
  onSendText,
  onRetry,
  onEdit,
  chooseLabel = "Escolher arquivos",
  chooseHint = "Fotos, vídeos e documentos",
}: UploadAreaProps) {
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={disabled}
        className="hidden"
        id={inputId}
        onChange={onFilesChosen}
      />

      <label
        htmlFor={disabled ? undefined : inputId}
        className={[
          "border-2 border-dashed border-[var(--color-border)]",
          disabled
            ? "opacity-50 cursor-not-allowed bg-[var(--color-surface)]"
            : "hover:border-[var(--color-accent)] cursor-pointer bg-[var(--color-surface)] active:scale-[0.99]",
          "rounded-2xl p-8 flex flex-col items-center justify-center gap-3 transition-all min-h-[160px] md:min-h-[120px] md:p-6",
        ].join(" ")}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <div className="w-12 h-12 rounded-full bg-[var(--color-accent-light)] flex items-center justify-center text-[var(--color-accent)]">
          <Upload size={24} strokeWidth={1.75} />
        </div>
        <div className="text-center">
          <span className="font-semibold text-base text-[var(--color-text)]">
            {disabled ? "Sessão encerrada" : chooseLabel}
          </span>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {disabled ? "Envio bloqueado" : chooseHint}
          </p>
        </div>
      </label>

      <TextWidget onSend={onSendText} disabled={disabled} error={textError} />

      {totalFiles > 0 && (
        <div className="bg-[var(--color-surface)] p-3 rounded-xl border border-[var(--color-border)] space-y-1.5">
          <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
            <span>Progresso geral</span>
            <span className="tabular">
              {Math.round((completedFiles / totalFiles) * 100)}%
            </span>
          </div>
          <ProgressBar value={completedFiles} max={totalFiles} />
        </div>
      )}

      <div className="flex-1 space-y-2">
        {items.map((item) => (
          <UploadItem
            key={item.id}
            item={item}
            onRetry={onRetry}
            onEdit={disabled ? undefined : onEdit}
          />
        ))}
      </div>
    </>
  );
}
