import HostPage from "./pages/computer/HostPage.tsx";
import JoinPage from "./pages/phone/JoinPage.tsx";
import { WhatsNewModal } from "./components/WhatsNewModal.tsx";

export default function App() {
  const path = window.location.pathname;
  const page = path.startsWith("/enviar/") ? <JoinPage /> : <HostPage />;

  return (
    <>
      {page}
      <WhatsNewModal />
    </>
  );
}
