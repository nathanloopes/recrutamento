import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const PrivacyPolicyAI = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3 safe-top safe-left safe-right">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold text-foreground">Política de Privacidade</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm text-foreground/80 leading-relaxed">
        <p className="text-xs text-muted-foreground">
          Última atualização: 02 de julho de 2026
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">1. Quem somos</h2>
          <p>
            A plataforma de Recrutamento e Seleção da Recruta é operada pela
            franqueadora e por suas unidades franqueadas, atuando conjuntamente no
            tratamento de dados dos candidatos.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">2. Dados coletados</h2>
          <p>
            Coletamos dados de identificação (nome, CPF, e-mail, telefone, endereço,
            data de nascimento), dados profissionais (histórico, formação, currículo),
            respostas a testes e entrevistas em texto e voz, além de metadados de uso do
            aplicativo.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">3. Finalidade</h2>
          <p>
            Utilizamos seus dados exclusivamente para conduzir processos seletivos,
            avaliar compatibilidade com vagas, agendar entrevistas e comunicar
            resultados.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">4. Base legal</h2>
          <p>
            Tratamos seus dados com base no consentimento (Art. 7º, I da LGPD) e na
            execução de procedimentos preliminares a contrato (Art. 7º, V da LGPD).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            5. Compartilhamento com a OpenAI (Inteligência Artificial)
          </h2>
          <p>
            Para transcrição de gravações de voz, análise semântica de respostas em
            texto e sugestões automáticas ao recrutador, compartilhamos parte dos seus
            dados com a <strong>OpenAI, L.L.C.</strong>, empresa sediada nos Estados
            Unidos da América.
          </p>
          <p><strong>Quais dados são enviados:</strong></p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Respostas em texto submetidas em etapas de triagem.</li>
            <li>Gravações de áudio das perguntas de voz, para transcrição.</li>
            <li>
              Prompts contendo o conteúdo da vaga e o contexto da resposta, sem incluir
              seu CPF ou documentos pessoais.
            </li>
          </ul>
          <p><strong>Quem recebe:</strong> OpenAI, L.L.C. (Estados Unidos).</p>
          <p><strong>Consentimento explícito:</strong></p>
          <p>
            O envio de dados à OpenAI só ocorre após o seu consentimento explícito, que
            é solicitado antes do início da etapa que utiliza IA. Você pode recusar e
            continuar o processo por outros meios, mediante alinhamento com o
            recrutador.
          </p>
          <p><strong>Uso pela OpenAI:</strong></p>
          <p>
            Conforme a política da OpenAI para clientes de API, os dados enviados
            <strong> não são usados para treinar modelos de IA</strong> e são retidos
            somente pelo tempo necessário para prestação do serviço e cumprimento de
            obrigações legais.
          </p>
          <p>
            Consulte a política da OpenAI em{" "}
            <a
              href="https://openai.com/policies/privacy-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary"
            >
              openai.com/policies/privacy-policy
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            6. Transferência internacional
          </h2>
          <p>
            O compartilhamento com a OpenAI implica transferência internacional de
            dados para os Estados Unidos, realizada com garantias contratuais adequadas,
            conforme Art. 33 da LGPD.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            7. Armazenamento e segurança
          </h2>
          <p>
            Seus dados são armazenados em infraestrutura Supabase com criptografia em
            trânsito (TLS) e em repouso, controle de acesso baseado em papéis (RBAC) e
            políticas de segurança em nível de linha (RLS).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            8. Retenção
          </h2>
          <p>
            Os dados são retidos pelo tempo necessário à condução do processo seletivo,
            podendo ser mantidos em banco de talentos, anonimizados ou eliminados
            conforme sua solicitação e nossa política de retenção.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            9. Direitos do titular
          </h2>
          <p>
            Você pode a qualquer momento solicitar acesso, correção, anonimização,
            eliminação, portabilidade ou revogação de consentimento sobre seus dados
            pessoais, nos termos da LGPD.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            10. Contato do Encarregado (DPO)
          </h2>
          <p>
            Para exercer seus direitos ou tirar dúvidas sobre este documento, escreva
            para{" "}
            <a
              href="mailto:privacidade@example.com"
              className="underline text-primary"
            >
              privacidade@example.com
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
};

export default PrivacyPolicyAI;
