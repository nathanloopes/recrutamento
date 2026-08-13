import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const BancoCurriculosTerms = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3 safe-top safe-left safe-right">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold text-foreground">Termo de Uso — Banco de Currículos</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-sm text-foreground/80 leading-relaxed">
        <p className="text-xs text-muted-foreground">Vigente desde: 06 de maio de 2026</p>

        <p>
          Seja bem-vindo ao nosso site. Leia com atenção todos os termos abaixo. O presente documento e todo o conteúdo do site é
          oferecido por <strong>RECRUTA FRANCHISING LTDA.</strong>, neste termo representada apenas por "EMPRESA", que
          regulamenta todos os direitos e obrigações com todos que acessam o site, denominados, neste termo, como "USUÁRIO" ou
          "VISITANTE", resguardando todos os direitos previstos na legislação pertinente.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">1. Da Função do Site e do Cadastro no Banco de Currículos</h2>
          <p>
            Este site foi criado e desenvolvido com a função de trazer conteúdo informativo de alta qualidade, e o link do banco de
            currículos, com manutenção dos dados que podem ser atualizados pelo VISITANTE. A EMPRESA busca, através da criação de
            conteúdo de alta qualidade, desenvolvido por profissionais da área, trazer conhecimento e promover oportunidades, assim
            como a divulgação dos próprios produtos e serviços.
          </p>
          <p>
            É de responsabilidade do VISITANTE/USUÁRIO apresentar informações corretas, verdadeiras e legítimas no preenchimento do
            cadastro no banco de currículos, para oportunizar melhor enquadramento do perfil profissional.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">2. Do Aceite dos Termos</h2>
          <p>
            O presente Termo determina que todo VISITANTE/USUÁRIO, ao acessar o site da EMPRESA, leia, compreenda e concorde com
            todas as informações do mesmo, visto que estabelece direitos e obrigações entre as partes e que devem ser aceitos
            expressamente pelo VISITANTE para permanecer navegando no site da EMPRESA.
          </p>
          <p>
            Ao continuar a navegação pelo site, com o preenchimento do cadastro dos currículos, o VISITANTE concorda integralmente
            com o Termo, sendo este aceite imprescindível para a permanência na navegação. Caso o VISITANTE discorde de alguma
            disposição do presente Termo, deve imediatamente interromper o acesso, saindo da navegação do site.
          </p>
          <p>
            O presente Termo poderá ser atualizado periodicamente pela EMPRESA, que se resguarda no direito de alteração, sem
            qualquer tipo de aviso prévio e comunicação, mantendo a sigilosidade, confidencialidade e proteção dos dados, conforme
            a legislação vigente.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">3. Do Acesso ao Site e do Tratamento das Informações e Dados</h2>
          <p>
            O Site e plataforma funcionam normalmente 24 (vinte e quatro) horas por dia, porém podem ocorrer pequenas interrupções
            de forma temporária para ajustes, manutenção, mudança de servidores, falhas técnicas ou por ordem de força maior, que
            podem deixar o site indisponível por tempo limitado.
          </p>
          <p>
            A EMPRESA não se responsabiliza por nenhuma perda de oportunidade ou prejuízos que esta indisponibilidade temporária
            possa gerar aos usuários.
          </p>
          <p>O acesso ao site só é permitido a maiores de 18 anos de idade ou que possuírem capacidade civil plena.</p>
          <p>
            Para o cadastro no banco de currículos, o VISITANTE deverá preencher formulário e responder perguntas, relatando
            informações que devem ser fidedignas, sob pena de responsabilização do VISITANTE, e as quais visam melhor enquadramento
            em perfil profissional, sem qualquer expectativa de direito. O VISITANTE poderá deixar uma apresentação sua, também,
            com vídeo e/ou currículo.
          </p>
          <p>
            Todos os dados e informações repassadas estão protegidos conforme a Lei Geral de Proteção de Dados (Lei nº
            13.709/2018), e ao realizar o cadastro junto ao site, o VISITANTE concorda integralmente com a coleta de dados
            conforme a Lei e com a Política de Privacidade da EMPRESA.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">4. Dos Direitos Autorais</h2>
          <p>
            Todos os direitos são preservados, conforme a legislação brasileira, principalmente conforme a Lei de Direitos Autorais
            (regulamentação na Lei nº 9.610/1998), pelo Código Civil brasileiro (regulamentação na Lei nº 10.406/2002), ou
            quaisquer outras leis aplicáveis.
          </p>
          <p>
            Todo o conteúdo do site é protegido por direitos autorais, e seu uso, cópia, transmissão, venda, cessão ou revenda
            deve seguir as leis brasileiras, tendo a EMPRESA todos os seus direitos reservados, e não permitindo cópia ou
            utilização de nenhuma forma e meio, sem autorização expressa e por escrito da mesma.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">5. Das Obrigações do Visitante</h2>
          <p>O VISITANTE, ao utilizar o website da EMPRESA, concorda integralmente em:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              De nenhuma forma ou meio realizar qualquer tipo de ação que tente invadir, hackear, destruir ou prejudicar a
              estrutura do site, plataforma da EMPRESA ou de seus parceiros comerciais. Incluindo-se, mas não se limitando, ao
              envio de vírus de computador, ataques de DDOS, acesso indevido por falhas da mesma ou quaisquer outras formas e meios.
            </li>
            <li>
              De não realizar divulgação indevida a empresas concorrentes, ou conteúdo que não possua direitos autorais ou
              quaisquer outros que não sejam pertinentes e que se destinem aos fins do presente site.
            </li>
            <li>
              De não reproduzir qualquer conteúdo do site ou plataforma sem autorização expressa, podendo responder civil e
              criminalmente pelo mesmo.
            </li>
            <li>
              Com a Política de Privacidade do site, assim como o tratamento de dados, os quais se fazem na forma da LGPD
              (regulamentação na Lei nº 13.709/2018), especialmente referente ao cadastro no banco de currículos, podendo a
              qualquer momento requerer a exclusão dos mesmos, através do formulário de contato, devidamente registrado e
              encaminhado à EMPRESA.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">6. Dos Termos Gerais</h2>
          <p>
            O preenchimento do cadastro para banco de currículos não estabelece qualquer vínculo entre a EMPRESA e o VISITANTE,
            limitando-se ao preenchimento de formulário e envio de dados, estes que serão guardados e preservados, por livre
            iniciativa do VISITANTE/USUÁRIO, não havendo nenhuma expectativa de direito quanto a esta.
          </p>
          <p>
            Em caso que ocorram eventuais conflitos judiciais entre o VISITANTE e a EMPRESA, o foro eleito para a devida ação será
            o da comarca da EMPRESA, mesmo que haja outro mais privilegiado.
          </p>
          <p className="text-xs text-muted-foreground">Este Termo está vigente desde 06.05.2026.</p>
        </section>

        <section className="pt-4 border-t text-center text-xs text-muted-foreground">
          <p><strong>RECRUTA FRANCHISING LTDA.</strong></p>
          <p>Todos os direitos reservados</p>
        </section>
      </main>
    </div>
  );
};

export default BancoCurriculosTerms;
