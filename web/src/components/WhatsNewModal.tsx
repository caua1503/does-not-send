import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal.tsx";
import { Button } from "./ui/Button.tsx";
import {
  APP_VERSION,
  WHATS_NEW,
  consumeWhatsNewView,
  type WhatsNewItem,
} from "../lib/whatsNew.ts";

export function WhatsNewModal() {
  const [open, setOpen] = useState(false);
  const counted = useRef(false);

  // One view per app load; guards StrictMode's double effect invocation.
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    if (consumeWhatsNewView(WHATS_NEW)) setOpen(true);
  }, []);

  const close = () => setOpen(false);
  const categories = [...new Set(WHATS_NEW.items.map((item) => item.category))];

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Novidades da v${APP_VERSION}`}
      footer={
        <Button size="sm" onClick={close}>
          Entendi
        </Button>
      }
    >
      <div className="px-5 py-4 space-y-4">
        {categories.map((category) => (
          <section key={category}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {category}
            </h3>
            <div className="space-y-2">
              {WHATS_NEW.items
                .filter((item) => item.category === category)
                .map((item) => (
                  <WhatsNewRow key={item.id} item={item} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function WhatsNewRow({ item }: { item: WhatsNewItem }) {
  const Icon = item.icon;
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
      {Icon && (
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <Icon size={14} strokeWidth={1.75} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{item.title}</p>
        <p className="text-xs leading-snug text-[var(--color-text-muted)]">
          {item.description}
        </p>
      </div>
    </div>
  );
}
