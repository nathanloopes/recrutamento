import { describe, it, expect } from "vitest";
import { classifyJobToArea, hasKeyword } from "../useCargoTest";

describe("hasKeyword (word-boundary matcher)", () => {
  it("não casa 'ux' dentro de 'auxilia'", () => {
    expect(hasKeyword("Também auxilia em atividades operacionais", "ux")).toBe(false);
  });
  it("não casa 'ux' dentro de 'auxiliar' / 'fluxo' / 'luxo'", () => {
    expect(hasKeyword("Auxiliar administrativo", "ux")).toBe(false);
    expect(hasKeyword("Analisa o fluxo do processo", "ux")).toBe(false);
    expect(hasKeyword("Ambiente de luxo", "ux")).toBe(false);
  });
  it("casa 'ux' isolado", () => {
    expect(hasKeyword("UX Designer", "ux")).toBe(true);
    expect(hasKeyword("Designer UX", "ux")).toBe(true);
    expect(hasKeyword("Especialista em UX", "ux")).toBe(true);
  });
  it("casa keywords compostas com pontuação nas bordas", () => {
    expect(hasKeyword("Operador de caixa!", "operador de caixa")).toBe(true);
  });
});

describe("classifyJobToArea", () => {
  describe("deve classificar como tecnologia", () => {
    const casos: Array<[string, string?]> = [
      ["Desenvolvedor"],
      ["Desenvolvedora"],
      ["UX Designer"],
      ["Product Designer UX"],
      ["Designer UX"],
      ["Tech Lead"],
      ["Engenheiro de Software"],
      ["Designer de Produto"],
      ["Analista de TI"],
      ["Área de TI"],
    ];
    for (const [title, desc] of casos) {
      it(`title "${title}"`, () => {
        expect(classifyJobToArea(title, desc ?? null, null)?.key).toBe("tecnologia");
      });
    }
  });

  describe("NÃO deve classificar como tecnologia (regressão do bug 'auxilia' → 'ux')", () => {
    it("EMBALADOR(A) com 'auxilia' na descrição", () => {
      const area = classifyJobToArea(
        "EMBALADOR(A)",
        "O(a) Embalador(a) é responsável pela separação. Também auxilia em atividades operacionais da loja quando necessário.",
        null,
      );
      expect(area?.key).not.toBe("tecnologia");
    });

    it("AUXILIAR DE MANUTENÇÃO PREDIAL", () => {
      const area = classifyJobToArea(
        "AUXILIAR DE MANUTENÇÃO PREDIAL",
        "Auxilia em manutenção preventiva e corretiva.",
        null,
      );
      expect(area?.key).not.toBe("tecnologia");
    });

    it("AUXILIAR ADMINISTRATIVO cai em administrativo", () => {
      const area = classifyJobToArea(
        "AUXILIAR ADMINISTRATIVO",
        "Auxilia nas rotinas administrativas.",
        null,
      );
      expect(area?.key).toBe("administrativo");
    });

    it("Auxiliar de Produção com 'estoque' na descrição cai em estoque", () => {
      const area = classifyJobToArea(
        "Auxiliar de Produção",
        "Auxilia na organização do estoque.",
        null,
      );
      expect(area?.key).toBe("estoque");
    });
  });

  describe("sanidade de outras áreas", () => {
    it("OPERADOR(A) DE CAIXA → caixa", () => {
      expect(classifyJobToArea("OPERADOR(A) DE CAIXA", null, null)?.key).toBe("caixa");
    });
    it("AVALIADOR(A) → avaliadora", () => {
      expect(classifyJobToArea("AVALIADOR(A)", null, null)?.key).toBe("avaliadora");
    });
    it("SOCIAL MEDIA → social_media", () => {
      expect(classifyJobToArea("SOCIAL MEDIA", null, null)?.key).toBe("social_media");
    });
  });
});
