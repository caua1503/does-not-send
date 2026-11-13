import ComputerPage from "./pages/computer/ComputerPage.tsx";
import PhonePage from "./pages/phone/PhonePage.tsx";
import { WhatsNewModal } from "./components/WhatsNewModal.tsx";

export default function App() {
  const path = window.location.pathname;
  const page = path.startsWith("/enviar/") ? <PhonePage /> : <ComputerPage />;

  return (
    <>
      {page}
      <WhatsNewModal />
    </>
  );
}
