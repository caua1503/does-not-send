import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  fullscreenOnMobile?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CLOSE_MS = 150;

export function Modal({ open, onClose, title, children, footer, fullscreenOnMobile = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  // Keep the panel mounted for the exit animation before unmounting.
  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visible) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
    (focusables()[0] ?? panel)?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = focusables();
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      const inside = panel?.contains(active ?? null) ?? false;
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus?.();
    };
  }, [open]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open && !visible) return null;

  return createPortal(
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center",
        fullscreenOnMobile ? "p-0 sm:p-4" : "p-4",
      ].join(" ")}
      aria-modal="true"
      role="dialog"
      aria-labelledby={titleId}
    >
      {/* Backdrop: darker overlay when backdrop-filter is unsupported */}
      <div
        className={[
          "absolute inset-0 bg-black/60 supports-[backdrop-filter]:bg-black/40 supports-[backdrop-filter]:backdrop-blur-sm",
          closing ? "modal-overlay-out" : "modal-overlay-in",
        ].join(" ")}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Content */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={[
          "relative z-10 w-full max-w-2xl bg-[var(--color-surface)] rounded-[var(--radius-card)] shadow-xl border border-[var(--color-border)] flex flex-col max-h-[90dvh] focus:outline-none",
          fullscreenOnMobile
            ? "max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none max-sm:border-0"
            : "",
          closing ? "modal-panel-out" : "modal-panel-in",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <h2
            id={titleId}
            className="text-base font-semibold tracking-tight text-[var(--color-text)]"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
            aria-label="Fechar"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-3 border-t border-[var(--color-border)] flex justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
