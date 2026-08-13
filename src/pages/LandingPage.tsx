import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Briefcase, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCPF, cleanCPF, isValidCPF } from "@/lib/cpf";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_MODE } from "@/lib/demo/config";
import { demoSignIn } from "@/lib/demo/mockClient";

export default function LandingPage() {
  const [cpf, setCpf] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCPF(e.target.value);
    setCpf(formatted);
    if (error) setError("");
  };

  const enterDemo = (role: "candidate" | "admin") => {
    demoSignIn(role);
    navigate(role === "admin" ? "/admin" : "/inicio", { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanCPF(cpf);

    if (!isValidCPF(cleaned)) {
      setError("CPF inválido. Verifique e tente novamente.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("check_cpf_status_rl", { _cpf: cleaned });

      if (rpcError) {
        setError("Erro ao consultar. Tente novamente.");
        setLoading(false);
        return;
      }

      // RPC agora devolve só { exists, is_active } — o e-mail nunca sai do banco
      // por essa rota pública. Login/reset resolvem o e-mail server-side.
      const result = data as unknown as { exists?: boolean; is_active?: boolean };

      if (result?.exists) {
        if (result.is_active === false) {
          navigate("/auth", { state: { cpf: cleaned, deactivated: true } });
          return;
        }
        navigate("/auth", { state: { cpf: cleaned } });
      } else {
        navigate("/auth/cadastro", { state: { cpf: cleaned } });
      }
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 safe-top safe-left safe-right">
        <div className="container flex h-14 items-center justify-center gap-2">
          <span className="font-display text-lg sm:text-xl font-extrabold tracking-tight bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 bg-clip-text text-transparent">Recrutamento Inteligente</span>
        </div>
      </header>

      {/* Hero — card central único.
          Buffer de scroll generoso no mobile (pb-[60vh]) + alinhamento ao topo
          garantem que o campo de CPF fique acessível acima do teclado em
          qualquer tela, mesmo se a WebView não reduzir a viewport. Desktop
          permanece centralizado (md:justify-center md:py-16). */}
      <section className="flex-1 flex flex-col items-center justify-start md:justify-center bg-gradient-to-br from-amber-50 via-amber-100/50 to-amber-50 px-4 pt-10 pb-[60vh] md:py-16">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 md:p-10">
          {/* Ícone */}
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-amber-500 text-white mb-6">
            <Briefcase className="h-7 w-7" />
          </div>

          {/* Eyebrow */}
          <p className="text-xs font-bold tracking-widest text-amber-600 uppercase mb-3">
            Portal de Vagas
          </p>

          {/* Título quebrado em 3 linhas */}
          <h1 className="font-display font-bold text-4xl md:text-5xl text-[#3D2B1F] leading-[1.05]">
            Olá,
            <br />
            <span className="text-amber-500">bem-vindo</span>
            <br />
            ao portal.
          </h1>

          {/* Subtítulo */}
          <p className="text-sm text-muted-foreground mt-5">
            {DEMO_MODE
              ? "Escolha um perfil para explorar a demonstração."
              : "Informe seu CPF para ver vagas e acompanhar seu processo."}
          </p>

          <div className="border-t my-6" />

          {DEMO_MODE ? (
            <div className="grid gap-3">
              <Button
                type="button"
                onClick={() => enterDemo("candidate")}
                className="w-full h-12 text-base font-semibold gap-2 bg-amber-500 hover:bg-amber-600 text-white"
              >
                <User className="h-4 w-4" />
                Entrar como Candidato
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => enterDemo("admin")}
                className="w-full h-12 text-base font-semibold gap-2 border-amber-500 text-amber-700 hover:bg-amber-50"
              >
                <Briefcase className="h-4 w-4" />
                Entrar como Recrutador
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label htmlFor="cpf" className="block text-xs font-semibold tracking-wider text-[#3D2B1F]/70 uppercase">
                CPF
              </label>
              <div className="relative">
                <Input
                  id="cpf"
                  type="text"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={handleChange}
                  className="h-12 pr-11 text-base tracking-wider"
                  autoFocus
                  maxLength={14}
                  disabled={loading}
                />
                <User className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
              </div>
              {error && <p className="text-sm text-destructive animate-fade-in">{error}</p>}
              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                disabled={cleanCPF(cpf).length !== 11 || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Consultando...
                  </>
                ) : (
                  <>
                    Entrar no portal
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t bg-background">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Recruta — Todos os direitos reservados.</span>
          <div className="flex gap-4">
            <a href="https://example.com/home/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Site Principal</a>
            <a href="https://www.instagram.com/example/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Instagram</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
