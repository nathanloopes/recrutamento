import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3 safe-top safe-left safe-right">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold text-foreground">Política de Privacidade</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm text-foreground/80 leading-relaxed">
        <p className="text-xs text-muted-foreground">Última atualização: 15 de abril de 2026</p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">1. Dados Coletados</h2>
          <p>Coletamos dados pessoais fornecidos por você durante o cadastro e uso da Plataforma, incluindo: nome completo, CPF, e-mail, telefone, endereço, data de nascimento, gênero, dados profissionais, gravações de voz (áudios das entrevistas) e respostas a testes e questionários do processo seletivo.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">2. Finalidade do Tratamento</h2>
          <p>Seus dados são utilizados exclusivamente para fins de recrutamento e seleção, incluindo: avaliação de perfil, agendamento de entrevistas, comunicação sobre processos seletivos e análise de compatibilidade com vagas disponíveis.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">3. Base Legal</h2>
          <p>O tratamento de dados é realizado com base no consentimento do titular (Art. 7º, I da LGPD) e na execução de procedimentos preliminares relacionados a contrato de trabalho (Art. 7º, V da LGPD).</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">4. Compartilhamento de Dados</h2>
          <p>Seus dados poderão ser compartilhados com as unidades franqueadas participantes do processo seletivo, sempre respeitando a finalidade original da coleta.</p>
          <p>
            Compartilhamento com serviço de inteligência artificial (OpenAI): para transcrição e avaliação automatizada das candidaturas, compartilhamos suas respostas em texto e gravações de voz com a OpenAI, L.L.C., provedor de inteligência artificial localizado nos Estados Unidos. Esses dados são usados exclusivamente para avaliar seu processo seletivo e não são utilizados para treinar modelos de IA. A OpenAI oferece proteção de dados equivalente à descrita nesta Política. O compartilhamento ocorre somente após seu consentimento explícito, solicitado no aplicativo antes das etapas avaliadas por IA. Consulte a Política de Privacidade da OpenAI em{" "}
            <a href="https://openai.com/policies/privacy-policy" className="underline text-primary" target="_blank" rel="noopener">
              https://openai.com/policies/privacy-policy
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">5. Armazenamento e Segurança</h2>
          <p>Os dados são armazenados em servidores seguros com criptografia e controle de acesso. Implementamos medidas técnicas e organizacionais para proteger seus dados contra acesso não autorizado.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">6. Os seus direitos e a revogação do consentimento</h2>
          <p>Nos termos da LGPD, você pode solicitar acesso, correção, portabilidade, anonimização ou exclusão dos seus dados.</p>
          <p>O processamento por inteligência artificial (OpenAI) é essencial ao funcionamento do serviço de recrutamento e seleção: sem ele não é possível realizar a triagem e a avaliação automatizada das candidaturas. Por isso, o consentimento é solicitado antes do uso dessas funcionalidades.</p>
          <p>Você pode revogar o consentimento a qualquer momento excluindo a sua conta diretamente no aplicativo (em Perfil), o que encerra o uso do serviço e remove os seus dados, ou solicitando a exclusão pelo e-mail de contato. Após a revogação, nenhum dado adicional será enviado à OpenAI.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">7. Retenção de Dados</h2>
          <p>Os dados pessoais são mantidos pelo período necessário ao cumprimento das finalidades de recrutamento, podendo ser anonimizados ou excluídos após o término do processo, conforme política de retenção vigente.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">8. Direitos do Titular</h2>
          <p>Você pode, a qualquer momento, solicitar: acesso, correção, anonimização, bloqueio, eliminação ou portabilidade de seus dados pessoais, conforme previsto na LGPD (Lei nº 13.709/2018).</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">9. Contato do Encarregado (DPO)</h2>
          <p>Para exercer seus direitos ou esclarecer dúvidas sobre o tratamento de dados, entre em contato através dos canais de suporte disponíveis na Plataforma.</p>
        </section>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
