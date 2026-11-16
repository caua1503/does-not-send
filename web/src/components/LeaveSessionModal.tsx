import { Button } from "./ui/Button.tsx";
import { Modal } from "./ui/Modal.tsx";

interface LeaveSessionModalProps {
  open: boolean;
  role: "host" | "guest";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LeaveSessionModal({
  open,
  role,
  busy = false,
  onCancel,
  onConfirm,
}: LeaveSessionModalProps) {
  const isHost = role === "host";
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title="Sair da sessão?"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={isHost ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Saindo..." : isHost ? "Encerrar e sair" : "Sair"}
          </Button>
        </div>
      }
    >
      <div className="p-4 text-sm text-[var(--color-text-muted)]">
        {isHost ? (
          <p className="text-[var(--color-text)] font-medium">
            Você é o anfitrião: ao sair, a sessão será encerrada para todos e os
            arquivos serão apagados do servidor.
          </p>
        ) : (
          <p className="text-[var(--color-text)] font-medium">
            Você sairá da sessão. Os arquivos continuam na sala e você pode voltar
            com o código enquanto ela estiver aberta.
          </p>
        )}
      </div>
    </Modal>
  );
}
