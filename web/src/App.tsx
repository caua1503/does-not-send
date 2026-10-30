import ComputerPage from "./pages/computer/ComputerPage.tsx";
import PhonePage from "./pages/phone/PhonePage.tsx";
import { UiShowcase } from "./pages/dev/UiShowcase.tsx";

export default function App() {
  const path = window.location.pathname;

  if (import.meta.env.DEV && path === "/dev/ui") {
    return <UiShowcase />;
  }

  if (path.startsWith("/enviar/")) {
    return <PhonePage />;
  }

  return <ComputerPage />;
}
