import ComputerPage from "./pages/computer/ComputerPage.tsx";
import PhonePage from "./pages/phone/PhonePage.tsx";

export default function App() {
  const path = window.location.pathname;

  if (path.startsWith("/enviar/")) {
    return <PhonePage />;
  }

  return <ComputerPage />;
}
