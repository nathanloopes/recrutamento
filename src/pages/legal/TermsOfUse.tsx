import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const TermsOfUse = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3 safe-top safe-left safe-right">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold text-foreground">Termos de Uso</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm text-foreground/80 leading-relaxed">
        <p className="text-xs text-muted-foreground">Última atualização: 15 de abril de 2026</p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">1. Aceitação dos Termos</h2>
          <p>Ao acessar e utilizar a plataforma de recrutamento ("Plataforma"), você concorda com estes Termos de Uso. Caso não concorde, não utilize a Plataforma.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">2. Cadastro e Conta</h2>
          <p>Para utilizar os serviços, você deve fornecer informações verdadeiras, completas e atualizadas. Você é responsável pela confidencialidade de suas credenciais de acesso.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">3. Uso da Plataforma</h2>
          <p>A Plataforma destina-se exclusivamente a fins de recrutamento e seleção. É proibido utilizar a Plataforma para qualquer finalidade ilegal ou não autorizada.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">4. Propriedade Intelectual</h2>
          <p>Todo o conteúdo da Plataforma, incluindo textos, gráficos, logotipos, ícones e software, é de propriedade exclusiva da empresa ou de seus licenciadores.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">5. Limitação de Responsabilidade</h2>
          <p>A Plataforma é fornecida "como está". Não garantimos que o serviço será ininterrupto ou livre de erros. Não nos responsabilizamos por danos indiretos decorrentes do uso.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">6. Alterações nos Termos</h2>
          <p>Reservamo-nos o direito de modificar estes Termos a qualquer momento. Alterações serão comunicadas pela Plataforma e entrarão em vigor na data de publicação.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">7. Contato</h2>
          <p>Para dúvidas sobre estes Termos, entre em contato através dos canais de suporte disponíveis na Plataforma.</p>
        </section>
      </main>
    </div>
  );
};

export default TermsOfUse;
