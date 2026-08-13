/**
 * Tabela de casos do stepper. Toda regressão visual deve aparecer aqui ANTES
 * de chegar ao usuário. Adicione um novo caso sempre que ajustar a lógica.
 */
import { describe, it, expect } from "vitest";
import { computeStepperState, type StepperInput } from "../stepperState";

const baseInput = (over: Partial<StepperInput> = {}): StepperInput => ({
  appStatus: "em_andamento",
  pipelinePhases: [],
  docs: { total: 0, sent: 0, pending: 0, hasOpenRequest: false },
  interviews: { has: false, allDone: false, decisionRejected: false },
  tests: { has: false, allDone: false },
  ...over,
});

function statuses(out: ReturnType<typeof computeStepperState>) {
  return out.stages.map((s) => s.status);
}

describe("computeStepperState", () => {
  it("recém-inscrito: só Inscrição/Avaliação ativas", () => {
    const out = computeStepperState(baseInput());
    expect(statuses(out)).toEqual([
      "completed",
      "current",
      "future",
      "future",
      "future",
    ]);
    expect(out.lineColors).toEqual(["green", "gray", "gray", "gray"]);
  });

  it("em avaliação com testes pendentes", () => {
    const out = computeStepperState(
      baseInput({ appStatus: "em_avaliacao", tests: { has: true, allDone: false } }),
    );
    expect(statuses(out)).toEqual([
      "completed",
      "current",
      "future",
      "future",
      "future",
    ]);
  });

  it("aprovado, sem entrevista nem docs (caso Lohan): só Inscrição/Avaliação verdes", () => {
    const out = computeStepperState(baseInput({ appStatus: "aprovado" }));
    expect(statuses(out)).toEqual([
      "completed",
      "completed",
      "future",
      "future",
      "future",
    ]);
  });

  it("APROVADO + DOCS PENDENTES: Doc=current, Entrevista permanece future (sem inferência)", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "aprovado",
        docs: { total: 3, sent: 0, pending: 3, hasOpenRequest: true },
      }),
    );
    expect(statuses(out)).toEqual([
      "completed",
      "completed",
      "future",
      "current",
      "future",
    ]);
  });

  it("aprovado, todos docs enviados aguardando aprovação: docs=current, sem cascata", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "aprovado",
        docs: { total: 3, sent: 3, pending: 3, hasOpenRequest: true },
      }),
    );
    expect(statuses(out)[3]).toBe("current");
    expect(statuses(out)[2]).toBe("future");
    expect(statuses(out)[4]).toBe("future");
  });

  it("aprovado + entrevista realizada + docs aprovados: Entrevista/Doc completed, Resultado current", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "aprovado",
        interviews: { has: true, allDone: true, decisionRejected: false },
        docs: { total: 3, sent: 3, pending: 0, hasOpenRequest: false },
      }),
    );
    expect(statuses(out)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "current",
    ]);
  });

  it("vaga sem teste, em_andamento: Avaliação=current (presencial), demais future", () => {
    const out = computeStepperState(baseInput({ appStatus: "em_andamento" }));
    expect(statuses(out)).toEqual([
      "completed",
      "current",
      "future",
      "future",
      "future",
    ]);
  });

  it("contratado: tudo completed", () => {
    const out = computeStepperState(baseInput({ appStatus: "contratado" }));
    expect(statuses(out)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
  });

  it("reprovado em entrevista: Entrevista=rejected, Resultado=rejected", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "reprovado",
        interviews: { has: true, allDone: true, decisionRejected: true },
      }),
    );
    expect(statuses(out)[2]).toBe("rejected");
    expect(statuses(out)[4]).toBe("rejected");
  });

  it("reprovado em avaliação: Avaliação=rejected, Resultado=rejected", () => {
    const out = computeStepperState(baseInput({ appStatus: "reprovado" }));
    expect(statuses(out)[1]).toBe("rejected");
    expect(statuses(out)[4]).toBe("rejected");
  });

  it("Entrevista IA REJECTED com appStatus 'aprovado' herdado: Entrevista/Documentação/Resultado rejected (não verde)", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "aprovado",
        interviews: { has: true, allDone: true, decisionRejected: true },
      }),
    );
    const s = statuses(out);
    expect(s[2]).toBe("rejected");
    expect(s[3]).not.toBe("completed");
    expect(s[3]).not.toBe("current");
    expect(s[4]).toBe("rejected");
  });

  it("desligado com histórico (entrevista feita + docs enviados): fases finais NÃO podem ficar verdes", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "desligado",
        interviews: { has: true, allDone: true, decisionRejected: false },
        docs: { total: 3, sent: 3, pending: 0, hasOpenRequest: false },
      }),
    );
    const s = statuses(out);
    expect(s[0]).toBe("completed"); // Inscrição
    expect(s[2]).toBe("rejected"); // Entrevista não pode aparecer concluída
    expect(s[3]).toBe("rejected"); // Documentação não pode aparecer concluída
    expect(s[4]).toBe("rejected"); // Resultado
  });

  it("desligado cedo (sem entrevista, sem docs): Avaliação=rejected, demais=future", () => {
    const out = computeStepperState(baseInput({ appStatus: "desligado" }));
    const s = statuses(out);
    expect(s[0]).toBe("completed");
    expect(s[1]).toBe("rejected");
    expect(s[2]).toBe("future");
    expect(s[3]).toBe("future");
    expect(s[4]).toBe("rejected");
  });

  it("desistente com docs do histórico: comporta-se como desligado", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "desistente",
        interviews: { has: true, allDone: true, decisionRejected: false },
        docs: { total: 2, sent: 2, pending: 0, hasOpenRequest: false },
      }),
    );
    const s = statuses(out);
    expect(s[2]).toBe("rejected");
    expect(s[3]).toBe("rejected");
    expect(s[4]).toBe("rejected");
  });

  it("entrevista cancelada (única): Entrevista volta a current, não completed", () => {
    const out = computeStepperState(
      baseInput({
        interviews: { has: false, allDone: false, decisionRejected: false, hadCancelled: true },
      }),
    );
    const s = statuses(out);
    expect(s[2]).toBe("current");
    expect(s[3]).toBe("future");
    expect(s[4]).toBe("future");
  });

  it("entrevista cancelada + nova confirmada: Entrevista current", () => {
    const out = computeStepperState(
      baseInput({
        interviews: { has: true, allDone: false, decisionRejected: false, hadCancelled: true },
      }),
    );
    expect(statuses(out)[2]).toBe("current");
  });

  it("entrevista cancelada + reprovado: Entrevista rejected (saída terminal prevalece)", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "reprovado",
        interviews: { has: false, allDone: false, decisionRejected: false, hadCancelled: true },
      }),
    );
    expect(statuses(out)[2]).toBe("rejected");
  });

  // ===== Reativação por restart_mode =====
  it("restart_mode=triagem: Inscrição completed, Avaliação current, demais future", () => {
    const out = computeStepperState(baseInput({ restartMode: "triagem" }));
    expect(statuses(out)).toEqual(["completed", "current", "future", "future", "future"]);
  });

  it("restart_mode=teste: igual a triagem (avaliação current)", () => {
    const out = computeStepperState(baseInput({ restartMode: "teste" }));
    expect(statuses(out)).toEqual(["completed", "current", "future", "future", "future"]);
  });

  it("restart_mode=entrevista: Inscrição+Avaliação completed, Entrevista current", () => {
    const out = computeStepperState(baseInput({ restartMode: "entrevista" }));
    expect(statuses(out)).toEqual(["completed", "completed", "current", "future", "future"]);
  });

  it("restart_mode=documentacao: Inscrição+Avaliação+Entrevista completed, Documentação current", () => {
    const out = computeStepperState(baseInput({ restartMode: "documentacao" }));
    expect(statuses(out)).toEqual(["completed", "completed", "completed", "current", "future"]);
  });

  it("restart_mode=last_valid: respeita derivação natural (não força override)", () => {
    const out = computeStepperState(
      baseInput({
        restartMode: "last_valid",
        tests: { has: true, allDone: true },
        interviews: { has: true, allDone: true, decisionRejected: false, hasApprovedDecision: true },
      }),
    );
    // Avaliação completed (tests done) + Entrevista completed (interviews done + aprovado)
    expect(statuses(out)[1]).toBe("completed");
    expect(statuses(out)[2]).toBe("completed");
  });

  // ===== Comparecimento sem decisão NÃO conclui a fase Entrevista =====
  it("entrevista realizada (comparecimento) sem decisão do recrutador: Entrevista=current, NÃO completed", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "em_andamento",
        interviews: { has: true, allDone: true, decisionRejected: false, hasApprovedDecision: false },
      }),
    );
    // Bug fix: admin clicando "Registrar Comparecimento" não pode pintar a
    // fase Entrevista como concluída no app do candidato.
    expect(statuses(out)[2]).toBe("current");
  });

  it("entrevista realizada + decisão aprovado: Entrevista=completed", () => {
    const out = computeStepperState(
      baseInput({
        appStatus: "em_andamento",
        interviews: { has: true, allDone: true, decisionRejected: false, hasApprovedDecision: true },
      }),
    );
    expect(statuses(out)[2]).toBe("completed");
  });

  it("restart_mode=entrevista + status reprovado: override NÃO aplica (terminal vence)", () => {
    const out = computeStepperState(
      baseInput({ appStatus: "reprovado", restartMode: "entrevista" }),
    );
    // Entrevista NÃO deve estar como current
    expect(statuses(out)[2]).not.toBe("current");
  });
});

