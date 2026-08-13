import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, KeyRound, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCPF, cleanCPF } from "@/lib/cpf";
import { supabase } from "@/integrations/supabase/client";
import { TurnstileWidget, isCaptchaEnabled, type TurnstileHandle } from "@/components/auth/TurnstileWidget";
import heroTeam from "@/assets/hero-team.jpg";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { cpf?: string; email?: string } | null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");

  const handleSubmit = async (email: string, cpfValue: string, captchaToken?: string) => {
    setLoading(true);
    setError("");

    // Toda a validação (CPF ↔ e-mail) e o envio do link acontecem server-side
    // via edge function. A resposta é sempre genérica para não virar oráculo
    // de correspondência CPF↔e-mail para chamadas anônimas.
    const cleanedCpf = cpfValue.replace(/\D/g, "");
    const redirectTo = `${window.location.origin}/reset-password`;

    try {
      await supabase.functions.invoke("request-password-reset-by-cpf", {
        body: {
          cpf: cleanedCpf,
          email: email.trim().toLowerCase(),
          captchaToken,
          redirectTo,
        },
      });
    } catch (err) {
      console.warn("[ForgotPassword] invoke error:", err);
    }

    setMaskedEmail(email.replace(/(.{2})(.*)(@.*)/, "$1***$3"));
    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="grid min-h-screen md:grid-cols-2 app-safe-area">
        <div className="relative hidden md:block">
          <img src={heroTeam} alt="Equipe Recruta" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[#3D2B1F]/70" />
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-12 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50">
          <div className="w-full max-w-sm animate-slide-up text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 mb-4">
              <CheckCircle className="h-8 w-8 text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-[#3D2B1F] mb-2">
              E-mail enviado!
            </h2>
            <p className="text-sm text-[#3D2B1F]/60 mb-6">
              Enviamos um link de recuperação para <strong>{maskedEmail}</strong>.
              Verifique sua caixa de entrada.
            </p>
            <Button onClick={() => navigate("/auth")} className="w-full bg-amber-500 hover:bg-amber-600 text-white">
              Voltar ao início
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ForgotPasswordForm
      error={error}
      loading={loading}
      onSubmit={handleSubmit}
      onBack={() => navigate("/auth")}
      initialCpf={locationState?.cpf || ""}
      initialEmail={locationState?.email || ""}
    />
  );
}

function ForgotPasswordForm({
  error, loading, onSubmit, onBack, initialCpf = "", initialEmail = "",
}: {
  error: string;
  loading: boolean;
  onSubmit: (email: string, cpf: string, captchaToken?: string) => void;
  onBack: () => void;
  initialCpf?: string;
  initialEmail?: string;
}) {
  const [cpf, setCpf] = useState(initialCpf ? formatCPF(initialCpf) : "");
  const [email, setEmail] = useState(initialEmail);
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const cleaned = cleanCPF(cpf);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cleaned.length === 11 && email.includes("@")) {
      onSubmit(email, cpf, captchaToken);
      if (isCaptchaEnabled()) { turnstileRef.current?.reset(); setCaptchaToken(""); }
    }
  };

  return (
    <div className="grid min-h-dvh md:grid-cols-2 app-safe-area">
      {/* Left - Image */}
      <div className="relative hidden md:block">
        <img src={heroTeam} alt="Equipe Recruta" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[#3D2B1F]/70" />
        <div className="relative z-10 flex h-full flex-col justify-end p-12">
          <h2 className="text-3xl font-bold text-white leading-tight">
            Recupere seu acesso
          </h2>
          <p className="mt-4 text-white/80 text-lg">
            Enviaremos um link seguro para redefinir sua senha.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex flex-col items-center justify-start md:justify-center px-6 pt-12 pb-[60vh] md:pb-12 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50">
        <div className="w-full max-w-sm animate-slide-up">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-[#3D2B1F]/60 mb-6 hover:text-[#3D2B1F] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>

          <div className="text-center mb-6">
            <span className="block text-2xl font-bold text-[#3D2B1F] mb-4">Recruta</span>
          </div>

          <Card className="border-0 shadow-2xl">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100">
                  <KeyRound className="h-5 w-5 text-amber-600" />
                </div>
                <CardTitle className="text-lg font-bold text-[#3D2B1F]">
                  Recuperar senha
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-[#3D2B1F]">CPF</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={(e) => setCpf(formatCPF(e.target.value))}
                    className="h-11 focus-visible:ring-amber-500"
                    maxLength={14}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[#3D2B1F]">E-mail cadastrado</Label>
                  <Input
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 focus-visible:ring-amber-500"
                  />
                </div>
                {error && (
                  <p className="text-xs text-destructive animate-fade-in">{error}</p>
                )}
                {isCaptchaEnabled() && (
                  <div className="flex justify-center">
                    <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-white"
                  disabled={loading || cleaned.length !== 11 || !email.includes("@") || (isCaptchaEnabled() && !captchaToken)}
                >
                  {loading ? "Enviando..." : "Enviar link de recuperação"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
