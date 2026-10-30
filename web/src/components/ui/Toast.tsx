import { useEffect } from "react";
import { X, AlertCircle, Info } from "lucide-react";

interface ToastProps {
  message: string;
  type?: "error" | "info";
  onDismiss: () => void;
}

export function Toast({ message, type = "info", onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const isError = type === "error";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={[
        "fixed bottom-4 right-4 z-[60] flex items-start gap-3 px-4 py-3 rounded-[var(--radius-btn)]",
        "shadow-lg border max-w-sm w-full",
        "animate-slide-in",
        isError
          ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/60 dark:border-red-800 dark:text-red-200"
          : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]",
      ].join(" ")}
    >
      <span className="flex-shrink-0 mt-0.5">
        {isError ? (
          <AlertCircle size={16} strokeWidth={1.75} />
        ) : (
          <Info size={16} strokeWidth={1.75} />
        )}
      </span>
      <p className="flex-1 text-sm">{message}</p>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Fechar notificação"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
