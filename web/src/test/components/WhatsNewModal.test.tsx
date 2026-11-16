import { StrictMode } from "react";
import { beforeEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsNewModal } from "../../components/WhatsNewModal.tsx";
import { APP_VERSION, WHATS_NEW_STORAGE_KEY } from "../../lib/whatsNew.ts";

beforeEach(() => localStorage.clear());

it("abre uma vez e conta apenas uma exibição no StrictMode", () => {
  render(
    <StrictMode>
      <WhatsNewModal />
    </StrictMode>,
  );

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText(`Novidades da v${APP_VERSION}`)).toBeInTheDocument();
  expect(screen.getByText("Sessão de troca")).toBeInTheDocument();
  expect(screen.getByText("Saída e encerramento mais claros")).toBeInTheDocument();
  expect(screen.getByText("Conexão e sessões")).toBeInTheDocument();
  expect(screen.getByText("Interface")).toBeInTheDocument();

  const state = JSON.parse(localStorage.getItem(WHATS_NEW_STORAGE_KEY)!);
  expect(state.viewCount).toBe(1);
});
