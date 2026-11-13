import HostPage from "./pages/host/HostPage.tsx";
import JoinPage from "./pages/guest/JoinPage.tsx";
import { WhatsNewModal } from "./components/WhatsNewModal.tsx";

export function isJoinPath(path: string): boolean {
  // /enviar/ is the legacy route kept for QR codes already printed or shared.
  return path.startsWith("/enviar/") || path.startsWith("/entrar/");
}

export default function App() {
  const page = isJoinPath(window.location.pathname) ? <JoinPage /> : <HostPage />;

  return (
    <>
      {page}
      <WhatsNewModal />
    </>
  );
}
