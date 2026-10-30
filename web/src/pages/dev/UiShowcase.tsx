import { useState } from "react";
import {
  Button,
  Card,
  ProgressBar,
  Badge,
  StatusDot,
  EmptyState,
  Modal,
  Toast,
} from "../../components/ui/index.ts";
import { Upload, Bell } from "lucide-react";

export function UiShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [progress, setProgress] = useState(0.4);

  return (
    <div className="min-h-dvh p-8 max-w-4xl mx-auto space-y-8 bg-[var(--color-bg)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">
          Design System & UI Components (/dev/ui)
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Visualização de todos os componentes base em diferentes variações e estados.
        </p>
      </div>

      {/* Buttons */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Buttons</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <Button variant="primary">Primary MD</Button>
          <Button variant="primary" size="sm">Primary SM</Button>
          <Button variant="primary" size="lg">Primary LG</Button>
          <Button variant="ghost">Ghost MD</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
      </section>

      {/* Badges & StatusDot */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Badges & Status</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <Badge label="Neutro" variant="neutral" />
          <Badge label="Concluído" variant="success" />
          <Badge label="Atenção" variant="warn" />
          <Badge label="Erro" variant="error" />
          <div className="flex items-center gap-2 pl-4 border-l border-[var(--color-border)]">
            <StatusDot connected={true} />
            <span className="text-xs text-[var(--color-text-muted)]">Conectado (pulsando)</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot connected={false} />
            <span className="text-xs text-[var(--color-text-muted)]">Offline</span>
          </div>
        </div>
      </section>

      {/* Progress Bars */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Progress Bars</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setProgress((p) => Math.max(0, p - 0.2))}>-20%</Button>
            <Button size="sm" variant="ghost" onClick={() => setProgress((p) => Math.min(1, p + 0.2))}>+20%</Button>
          </div>
        </div>
        <Card className="p-4 space-y-4">
          <div>
            <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
              <span>Progresso de arquivo</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <ProgressBar value={progress} max={1} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
              <span>Progresso completo</span>
              <span>100%</span>
            </div>
            <ProgressBar value={1} max={1} />
          </div>
        </Card>
      </section>

      {/* Modal & Toast triggers */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Overlays & Feedback</h2>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => setModalOpen(true)}>
            Abrir Modal de Exemplo
          </Button>
          <Button variant="ghost" onClick={() => setShowToast(true)}>
            <Bell size={16} /> Disparar Toast
          </Button>
        </div>
      </section>

      {/* Empty State */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Empty State</h2>
        <Card>
          <EmptyState
            icon={Upload}
            title="Pronto para receber arquivos"
            description="Escaneie o QR Code no telefone para começar o envio para esta máquina."
            action={<Button variant="primary">Criar Nova Sessão</Button>}
          />
        </Card>
      </section>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Pré-visualização do Modal">
        <div className="p-6 space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            Este modal adapta-se perfeitamente aos temas claro e escuro, respeitando overflow e acessibilidade.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Fechar</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>Confirmar</Button>
          </div>
        </div>
      </Modal>

      {showToast && (
        <Toast
          message="Esta é uma notificação discreta de demonstração."
          type="info"
          onDismiss={() => setShowToast(false)}
        />
      )}
    </div>
  );
}
