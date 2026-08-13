import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PostInterviewModalityCard } from "../PostInterviewModalityCard";
import type { PostInterviewTestState } from "@/hooks/useApplicationStatus";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock("../TestScheduleDialog", () => ({
  TestScheduleDialog: () => null,
}));

function renderCard(modality: PostInterviewTestState["modality"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PostInterviewModalityCard
        applicationId="app-1"
        state={{ stage: "choose", unitId: "unit-1", modality }}
      />
    </QueryClientProvider>,
  );
}

describe("PostInterviewModalityCard", () => {
  it("mostra somente presencial quando a configuração da unidade é presencial", () => {
    renderCard("presencial");

    expect(screen.getByRole("button", { name: /teste presencial/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /fazer teste online/i })).not.toBeInTheDocument();
  });

  it("mostra somente online quando a configuração da unidade é online", () => {
    renderCard("online");

    expect(screen.getByRole("button", { name: /fazer teste online/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /teste presencial/i })).not.toBeInTheDocument();
  });

  it("mostra as duas opções quando a configuração da unidade é ambos", () => {
    renderCard("ambos");

    expect(screen.getByRole("button", { name: /fazer teste online/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /teste presencial/i })).toBeInTheDocument();
  });
});