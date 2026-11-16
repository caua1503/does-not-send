import HostPage from "./pages/host/HostPage.tsx";
import InvitePage from "./pages/guest/InvitePage.tsx";
import JoinPage from "./pages/guest/JoinPage.tsx";
import { WhatsNewModal } from "./components/WhatsNewModal.tsx";

export function isJoinPath(path: string): boolean {
  // /enviar/ is the legacy route kept for QR codes already printed or shared.
  return path.startsWith("/enviar/") || path.startsWith("/entrar/");
}

export function isInvitePath(path: string): boolean {
  return path.startsWith("/i/");
}

export default function App() {
  const path = window.location.pathname;
  const page = isInvitePath(path) ? (
    <InvitePage />
  ) : isJoinPath(path) ? (
    <JoinPage />
  ) : (
    <HostPage />
  );

  return (
    <>
      {page}
      <WhatsNewModal />
    </>
  );
}
