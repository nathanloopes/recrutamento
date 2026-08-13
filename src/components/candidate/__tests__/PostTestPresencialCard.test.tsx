import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { PostTestPresencialCard } from "../PostTestPresencialCard";

// Testa apenas a lógica de render (branches). O queryFn (Supabase) é
// substituído por dados controlados via mock do useQuery.
vi.mock("@tanstack/react-query", async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    useQuery: vi.fn(),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

vi.mock("../TestScheduleDialog", () => ({
  TestScheduleDialog: () => null,
}));

vi.mock("../PostInterviewModalityCard", () => ({
  PostInterviewModalityCard: () => <div data-testid="scheduled-card" />,
}));

function setData(data: any[]) {
  (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data });
}

describe("PostTestPresencialCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mostra mensagem + botão de agendar quando o online foi concluído e ainda não há booking", () => {
    setData([
      { applicationId: "app-1", unitId: "unit-1", jobTitle: "Atendente", booking: null, presencialDone: false },
    ]);
    render(<PostTestPresencialCard />);

    expect(screen.getByText(/Teste online concluído/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agendar teste presencial/i })).toBeInTheDocument();
    expect(screen.queryByTestId("scheduled-card")).not.toBeInTheDocument();
  });

  it("mostra o card de agendado (PostInterviewModalityCard) quando já existe booking", () => {
    setData([
      {
        applicationId: "app-1",
        unitId: "unit-1",
        jobTitle: "Atendente",
        booking: { id: "b1", scheduled_date: "2026-08-01", scheduled_time: "10:00:00" },
        presencialDone: false,
      },
    ]);
    render(<PostTestPresencialCard />);

    expect(screen.getByTestId("scheduled-card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agendar teste presencial/i })).not.toBeInTheDocument();
  });

  it("não renderiza nada quando não há candidaturas elegíveis", () => {
    setData([]);
    const { container } = render(<PostTestPresencialCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("oculta a etapa quando o teste presencial já foi realizado", () => {
    setData([
      { applicationId: "app-1", unitId: "unit-1", jobTitle: "Atendente", booking: null, presencialDone: true },
    ]);
    const { container } = render(<PostTestPresencialCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
