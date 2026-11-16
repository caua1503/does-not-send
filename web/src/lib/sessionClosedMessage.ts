/** User-facing explanation for a server-side session close. */
export function sessionClosedMessage(reason: string | null): string {
  switch (reason) {
    case "host_left":
      return "O anfitrião saiu e a sessão foi encerrada.";
    case "host_disconnected":
      return "O anfitrião perdeu a conexão e a sessão foi encerrada.";
    case "host_closed":
    case "user_closed":
      return "O anfitrião encerrou a sessão.";
    case "inactivity":
    case "expired":
      return "A sessão expirou por inatividade. Arquivos e textos foram apagados.";
    default:
      return "A sessão foi encerrada. Arquivos e textos foram apagados.";
  }
}
