import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Check, FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NativeFileInput, type NativeFileInputHandle } from "@/components/ui/NativeFileInput";
import heroTeam from "@/assets/hero-team.jpg";
import { formatCPF } from "@/lib/cpf";
import { formatCEP, formatPhone } from "@/lib/masks";
import { ymdToLocalDate, dateToLocalYMD } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { uploadResume } from "@/lib/resumeUpload";
import { TurnstileWidget, isCaptchaEnabled, type TurnstileHandle } from "@/components/auth/TurnstileWidget";
import { useToast } from "@/hooks/use-toast";
import { resolvePostAuthRedirect } from "@/lib/postAuthRedirect";



const MAX_RESUME_SIZE = 10 * 1024 * 1024;
const ALLOWED_RESUME_EXT = /\.(pdf|doc|docx)$/i;

// IMPORTANTE: values em slug (lowercase) — DEVEM bater com os values usados
// em src/pages/candidate/Profile.tsx para que o Select encontre o valor salvo
// ao abrir o modo de edição. Se mudar aqui, mude lá também.
const GENDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "masculino", label: "Masculino" },
  { value: "feminino", label: "Feminino" },
  { value: "nao_binario", label: "Não-binário" },
  { value: "outro", label: "Outro" },
  { value: "nao_declarar", label: "Prefiro não declarar" },
];

const STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

interface FormData {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  birthDate: string;
  gender: string;
  genderOther: string;
  termsAccepted: boolean;
  bancoCurriculosAccepted: boolean;
}

const STEP_LABELS = ["Identificação", "Endereço", "Perfil"];

const SIGNUP_FORM_KEY = "signup_form_v1";

interface SignupSnapshot {
  form: FormData;
  step: number;
  cpf: string;
  cpfStatus: "idle" | "loading" | "found" | "not_found" | "error";
  cpfLookedUp: boolean;
}

function readSignupSnapshot(): SignupSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SIGNUP_FORM_KEY);
    return raw ? (JSON.parse(raw) as SignupSnapshot) : null;
  } catch {
    return null;
  }
}

const EMPTY_FORM: FormData = {
  name: "", email: "", phone: "", password: "", confirmPassword: "",
  cep: "", street: "", number: "", complement: "", neighborhood: "",
  city: "", state: "", birthDate: "",
  gender: "", genderOther: "", termsAccepted: false, bancoCurriculosAccepted: false,
};

export default function Register() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Restaura snapshot uma única vez (lazy). Se location.state.cpf não vier
  // (caso de voltar de /termos-de-uso aberto na mesma webview do PWA),
  // recupera o CPF do snapshot persistido.
  const initialSnapshotRef = useRef<SignupSnapshot | null>(readSignupSnapshot());
  const stateCpf = (location.state as { cpf?: string })?.cpf || "";
  const cpf = stateCpf || initialSnapshotRef.current?.cpf || "";

  useEffect(() => {
    if (!cpf) {
      toast({ title: "CPF obrigatório", description: "Informe seu CPF para continuar.", variant: "destructive" });
      navigate("/", { replace: true });
    }
  }, [cpf, navigate, toast]);

  const [step, setStep] = useState<number>(() => initialSnapshotRef.current?.step ?? 1);
  const [form, setForm] = useState<FormData>(() => initialSnapshotRef.current?.form ?? EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [cpfLoading, setCpfLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cpfLookedUp, setCpfLookedUp] = useState<boolean>(() => initialSnapshotRef.current?.cpfLookedUp ?? false);
  const [cpfStatus, setCpfStatus] = useState<"idle" | "loading" | "found" | "not_found" | "error">(
    () => initialSnapshotRef.current?.cpfStatus ?? "idle"
  );
  const cepTimeoutRef = useRef<NodeJS.Timeout>();
  const cepRequestRef = useRef(0);
  const cpfLookupRef = useRef<string>("");
  const resumeInputRef = useRef<NativeFileInputHandle>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);


  // Persistência leve: salva snapshot a cada mudança relevante para sobreviver
  // a navegações externas (Termos/Privacidade) que reaproveitam a webview do PWA.
  useEffect(() => {
    if (!cpf) return;
    try {
      const snapshot: SignupSnapshot = { form, step, cpf, cpfStatus, cpfLookedUp };
      sessionStorage.setItem(SIGNUP_FORM_KEY, JSON.stringify(snapshot));
    } catch {
      /* modo privado / quota — ignora */
    }
  }, [form, step, cpf, cpfStatus, cpfLookedUp]);

  const clearSignupSnapshot = useCallback(() => {
    try { sessionStorage.removeItem(SIGNUP_FORM_KEY); } catch { /* noop */ }
  }, []);

  const handleChange = useCallback((field: keyof FormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }, [errors]);

  // ── Auto CPF lookup on mount (only needs CPF) ──
  useEffect(() => {
    if (!cpf || cpfLookedUp) return;
    if (cpfLookupRef.current === cpf) return;

    const doLookup = async () => {
      cpfLookupRef.current = cpf;
      setCpfLoading(true);
      setCpfStatus("loading");
      try {
        const cleanedCpf = cpf.replace(/\D/g, "");
        const { data, error } = await supabase.functions.invoke("lookup-cpf", {
          body: {
            cpf: cleanedCpf,
            ...(isCaptchaEnabled() && captchaToken ? { captchaToken } : {}),
          },
        });
        if (error) {
          setCpfStatus("error");
          return;
        }
        if (data?.found) {
          setCpfLookedUp(true);
          setCpfStatus("found");
          setForm((prev) => {
            const updates: Partial<FormData> = {};
            if (data.name && !prev.name) {
              updates.name = data.name;
            }
            // Normalize birth_date from API (DD/MM/YYYY -> YYYY-MM-DD)
            if (data.birth_date && !prev.birthDate) {
              const parts = data.birth_date.split("/");
              if (parts.length === 3) {
                updates.birthDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
              }
            }
            return { ...prev, ...updates };
          });
        } else {
          setCpfStatus("not_found");
        }
      } catch {
        setCpfStatus("error");
      } finally {
        setCpfLoading(false);
      }
    };

    doLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf]);

  // ── CEP Lookup ──
  const lookupCEP = async (cep: string) => {
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return;
    const requestId = ++cepRequestRef.current;
    setCepLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", {
        body: { cep: cleaned },
      });
      if (requestId !== cepRequestRef.current) return;
      if (error) {
        toast({ title: "Erro ao buscar CEP", description: "Preencha o endereço manualmente.", variant: "destructive" });
        return;
      }
      if (data?.found) {
        setForm((prev) => ({
          ...prev,
          street: data.street || prev.street,
          neighborhood: data.neighborhood || prev.neighborhood,
          city: data.city || prev.city,
          state: data.state || prev.state,
        }));
        setErrors((prev) => ({ ...prev, street: undefined, city: undefined, state: undefined, neighborhood: undefined }));
        toast({ title: "CEP encontrado!", description: "Endereço preenchido automaticamente." });
      } else if (data?.error_type === "invalid_cep") {
        toast({ title: "CEP não encontrado", description: "Verifique o CEP informado.", variant: "destructive" });
      } else {
        toast({ title: "Não foi possível buscar o CEP", description: "Preencha o endereço manualmente." });
      }
    } catch {
      if (requestId !== cepRequestRef.current) return;
      toast({ title: "Erro ao buscar CEP", description: "Preencha o endereço manualmente." });
    } finally {
      if (requestId === cepRequestRef.current) setCepLoading(false);
    }
  };

  // ── Validation per step ──
  const validateStep = (s: number): boolean => {
    const newErrors: Record<string, string> = {};

    if (s === 1) {
      if (!form.name.trim()) newErrors.name = "Nome é obrigatório";
      if (!form.birthDate) newErrors.birthDate = "Data de nascimento é obrigatória";
      if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(form.email)) newErrors.email = "E-mail inválido";
      if (form.phone.replace(/\D/g, "").length < 10) newErrors.phone = "Telefone inválido";
    }

    if (s === 2) {
      if (form.cep.replace(/\D/g, "").length !== 8) newErrors.cep = "CEP inválido";
      if (!form.street.trim()) newErrors.street = "Rua é obrigatória";
      if (!form.number.trim()) newErrors.number = "Número é obrigatório";
      if (!form.neighborhood.trim()) newErrors.neighborhood = "Bairro é obrigatório";
      if (!form.city.trim()) newErrors.city = "Cidade é obrigatória";
      if (!form.state) newErrors.state = "Estado é obrigatório";
    }

    if (s === 3) {
      if (!form.gender) newErrors.gender = "Selecione uma opção";
      if (form.gender === "outro" && !form.genderOther.trim()) newErrors.genderOther = "Informe o gênero";
      if (form.password.length < 8) newErrors.password = "Mínimo 8 caracteres";
      if (!/[A-Z]/.test(form.password)) newErrors.password = "Deve conter pelo menos 1 letra maiúscula";
      if (!/\d/.test(form.password)) newErrors.password = "Deve conter pelo menos 1 número";
      if (form.password !== form.confirmPassword) newErrors.confirmPassword = "Senhas não conferem";
      if (!form.termsAccepted) newErrors.termsAccepted = "Aceite os termos para continuar";
      if (!form.bancoCurriculosAccepted) (newErrors as any).bancoCurriculosAccepted = "Aceite os termos do Banco de Currículos para continuar";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, 3));
  };

  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep(3)) return;

    setLoading(true);
    // Se usuário escolheu "outro", persiste o texto livre que ele digitou.
    // Caso contrário, persiste o slug (compatível com options do Profile).
    const finalGender = form.gender === "outro" ? form.genderOther.trim() : form.gender;

    try {
      const cepDigitsPre = form.cep.replace(/\D/g, "");
      const phoneDigitsPre = form.phone.replace(/\D/g, "");
      const addressJsonPre = {
        cep: cepDigitsPre,
        street: form.street.trim(),
        number: form.number.trim(),
        complement: form.complement.trim(),
        neighborhood: form.neighborhood.trim(),
        city: form.city.trim(),
        state: form.state,
      };

      // ── Reativação por CPF ─────────────────────────────────────────────
      // Se já existe um candidate com este CPF marcado como desativado
      // (self_deactivated), reativa em vez de criar novo cadastro.
      try {
        const { data: reactivation } = await supabase.functions.invoke("check-cpf-reactivation", {
          body: {
            cpf,
            email: form.email.trim().toLowerCase(),
            password: form.password,
            profile: {
              full_name: form.name.trim(),
              phone: phoneDigitsPre,
              cep: cepDigitsPre,
              city: form.city.trim(),
              state: form.state,
              birth_date: form.birthDate,
              gender: finalGender,
              address_json: addressJsonPre,
            },
          },
        });

        if (reactivation?.reactivated) {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: form.email.trim().toLowerCase(),
            password: form.password,
          });
          if (signInErr) {
            toast({ title: "Conta reativada", description: "Faça login para continuar.", variant: "destructive" });
            navigate("/auth", { replace: true });
            setLoading(false);
            return;
          }
          toast({ title: "Bem-vindo de volta!", description: "Sua conta foi reativada com sucesso." });
          clearSignupSnapshot();
          const target = resolvePostAuthRedirect(location.search) ?? "/inicio";
          navigate(target, { replace: true });
          setLoading(false);
          return;
        }
      } catch (e) {
        console.warn("[Register] check-cpf-reactivation falhou, seguindo signUp normal:", e);
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo: window.location.origin,
          ...(isCaptchaEnabled() ? { captchaToken } : {}),
          data: {
            full_name: form.name,
            cpf,
            phone: form.phone,
            cep: cepDigitsPre,
            city: form.city.trim(),
            state: form.state,
            birth_date: form.birthDate,
            gender: finalGender,
            status: "registered",
          },
        },
      });
      if (isCaptchaEnabled()) { turnstileRef.current?.reset(); setCaptchaToken(""); }

      if (signUpError) {
        if (signUpError.message.includes("already registered")) {
          setErrors({ email: "Este e-mail já está cadastrado" });
          setStep(1);
        } else {
          toast({ title: "Erro no cadastro", description: signUpError.message, variant: "destructive" });
        }
        setLoading(false);
        return;
      }

      const userId = signUpData.user?.id;
      if (userId) {
        const cepDigits = form.cep.replace(/\D/g, "");
        const phoneDigits = form.phone.replace(/\D/g, "");

        const addressJson = {
          cep: cepDigits,
          street: form.street.trim(),
          number: form.number.trim(),
          complement: form.complement.trim(),
          neighborhood: form.neighborhood.trim(),
          city: form.city.trim(),
          state: form.state,
        };

        // CRÍTICO: o trigger handle_new_user só grava full_name + email em
        // candidate_profiles. Todos os outros campos PRECISAM ser persistidos
        // aqui explicitamente, senão somem após o cadastro.
        const profilePayload: Record<string, any> = {
          candidate_id: userId,
          full_name: form.name.trim(),
          phone: phoneDigits || null,
          cep: cepDigits || null,
          city: form.city.trim() || null,
          state: form.state || null,
          birth_date: form.birthDate || null,
          gender: finalGender || null,
          address_json: addressJson,
        };

        const { error: profileUpdateErr } = await supabase
          .from("candidate_profiles")
          .upsert(profilePayload as any, { onConflict: "candidate_id" });

        if (profileUpdateErr) {
          console.error("[Register] Falha ao persistir perfil completo:", profileUpdateErr);
          toast({
            title: "Cadastro parcialmente salvo",
            description: "Alguns dados podem não ter sido salvos. Complete seu perfil após o login.",
            variant: "destructive",
          });
        }

        // Espelha phone em candidates (usado pelo WhatsApp PWA e demais envios Z-API)
        if (phoneDigits) {
          const { error: candPhoneErr } = await supabase
            .from("candidates")
            .update({ phone: phoneDigits } as any)
            .eq("id", userId);
          if (candPhoneErr) {
            console.warn("[Register] Falha ao espelhar phone em candidates:", candPhoneErr);
          }
        }

        // Upload opcional do currículo (PDF/DOC/DOCX)
        if (resumeFile) {
          try {
            await uploadResume(userId, resumeFile);
          } catch (err) {
            console.warn("[Register] Falha ao enviar currículo:", err);
            toast({
              title: "Currículo não enviado",
              description: "Você poderá anexar o currículo depois pelo seu perfil.",
            });
          }
        }
      }

      if (userId && form.cep) {
        supabase.functions.invoke("geocode-cep", {
          body: {
            cep: form.cep.replace(/\D/g, ""),
            table: "candidates",
            record_id: userId,
            city: form.city.trim(),
            state: form.state,
          },
        }).catch((err) => console.error("Post-signup geocoding error:", err));
      }



      toast({ title: "Conta criada com sucesso!", description: "Você já está logado." });
      clearSignupSnapshot();
      const target = resolvePostAuthRedirect(location.search) ?? "/inicio";
      navigate(target, { replace: true });
    } catch {
      toast({ title: "Erro", description: "Erro de conexão. Tente novamente.", variant: "destructive" });
    } finally {
      setLoading(false);
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
            Comece sua jornada<br />na Recruta
          </h2>
          <p className="mt-4 text-white/80 text-lg">
            Cadastre-se e descubra oportunidades incríveis.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex flex-col items-center px-4 pt-4 pb-[60vh] md:pb-4 bg-gradient-to-b from-amber-50 via-amber-100/30 to-amber-50 overflow-y-auto">
        <div className="w-full max-w-sm animate-slide-up">
          <button
            onClick={() => { clearSignupSnapshot(); navigate("/"); }}
            className="flex items-center gap-1 text-sm text-[#3D2B1F]/60 mb-4 hover:text-[#3D2B1F] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>

          <div className="text-center mb-3">
            <span className="block text-2xl font-bold text-[#3D2B1F] mb-2">Recruta</span>
          </div>

          {/* Stepper */}
          <div className="flex items-center justify-center gap-0 mb-4">
            {STEP_LABELS.map((label, i) => {
              const stepNum = i + 1;
              const isActive = step === stepNum;
              const isDone = step > stepNum;
              return (
                <React.Fragment key={stepNum}>
                  {i > 0 && (
                    <div className={`h-0.5 w-8 sm:w-12 transition-colors ${isDone ? "bg-amber-500" : "bg-muted"}`} />
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                        isDone
                          ? "bg-amber-500 text-white"
                          : isActive
                          ? "bg-amber-500 text-white ring-2 ring-amber-300 ring-offset-2"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isDone ? <Check className="h-4 w-4" /> : stepNum}
                    </div>
                    <span className={`text-[10px] leading-tight ${isActive || isDone ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>
                      {label}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          <Card className="border-0 shadow-2xl">
            <CardHeader className="pb-2 pt-4">
              <div className="text-center">
                <CardTitle className="text-lg font-bold text-[#3D2B1F]">
                  {step === 1 && "Identificação"}
                  {step === 2 && "Endereço"}
                  {step === 3 && "Perfil e Segurança"}
                </CardTitle>
                <p className="text-xs text-[#3D2B1F]/60 mt-0.5">CPF: {formatCPF(cpf)}</p>
              </div>
            </CardHeader>

            <CardContent className="pb-4">
              <form onSubmit={handleSubmit} className="space-y-3">
                {/* ── STEP 1: Identification ── */}
                {step === 1 && (
                  <>
                    <Field label="Nome completo" value={form.name} onChange={(v) => handleChange("name", v)} error={errors.name} disabled={loading || cpfLoading} />

                    <div className="space-y-1.5">
                      <Label className="text-sm text-[#3D2B1F]">Data de nascimento</Label>
                      <MaskedDateInput
                        value={ymdToLocalDate(form.birthDate)}
                        onChange={(d) => {
                          const val = dateToLocalYMD(d);
                          handleChange("birthDate", val);
                          if (!val) {
                            cpfLookupRef.current = "";
                            setCpfLookedUp(false);
                            setCpfStatus("idle");
                          }
                        }}
                        format="dd/MM/yyyy"
                        placeholder="Data de nascimento"
                        disabled={loading || cpfLoading}
                      />
                      {errors.birthDate && <p className="text-xs text-destructive animate-fade-in">{errors.birthDate}</p>}
                    </div>

                    {cpfStatus === "loading" && (
                      <div className="flex items-center gap-2 text-xs text-amber-700">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Consultando CPF...
                      </div>
                    )}
                    {cpfStatus === "found" && (
                      <p className="text-xs text-emerald-600">✓ Dados preenchidos via consulta CPF</p>
                    )}
                    {cpfStatus === "not_found" && (
                      <p className="text-xs text-muted-foreground">CPF não encontrado — preencha manualmente</p>
                    )}
                    {cpfStatus === "error" && (
                      <p className="text-xs text-muted-foreground">Erro na consulta — preencha manualmente</p>
                    )}
                    <Field label="E-mail" type="email" value={form.email} onChange={(v) => handleChange("email", v)} error={errors.email} disabled={loading} />
                    <Field label="Telefone" type="tel" inputMode="numeric" value={form.phone} onChange={(v) => handleChange("phone", formatPhone(v))} error={errors.phone} placeholder="(00) 00000-0000" disabled={loading} />
                  </>
                )}

                {/* ── STEP 2: Address ── */}
                {step === 2 && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-sm text-[#3D2B1F]">CEP</Label>
                      <div className="relative">
                        <Input
                          inputMode="numeric"
                          value={form.cep}
                          onChange={(e) => {
                            const formatted = formatCEP(e.target.value);
                            handleChange("cep", formatted);
                            clearTimeout(cepTimeoutRef.current);
                            if (formatted.replace(/\D/g, "").length === 8) {
                              cepTimeoutRef.current = setTimeout(() => lookupCEP(formatted), 800);
                            }
                          }}
                          placeholder="00000-000"
                          maxLength={9}
                          disabled={loading}
                          className="h-11 focus-visible:ring-amber-500 pr-8"
                        />
                        {cepLoading && (
                          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                      {errors.cep && <p className="text-xs text-destructive animate-fade-in">{errors.cep}</p>}
                    </div>

                    <Field label="Rua" value={form.street} onChange={(v) => handleChange("street", v)} error={errors.street} disabled={loading || cepLoading} placeholder={cepLoading ? "Buscando..." : "Nome da rua"} />

                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Número" value={form.number} onChange={(v) => handleChange("number", v)} error={errors.number} disabled={loading} />
                      <div className="col-span-2">
                        <Field label="Complemento" value={form.complement} onChange={(v) => handleChange("complement", v)} disabled={loading} placeholder="Opcional" />
                      </div>
                    </div>

                    <Field label="Bairro" value={form.neighborhood} onChange={(v) => handleChange("neighborhood", v)} error={errors.neighborhood} disabled={loading || cepLoading} placeholder={cepLoading ? "Buscando..." : "Bairro"} />

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-sm text-[#3D2B1F]">Cidade</Label>
                        <Input
                          value={form.city}
                          onChange={(e) => handleChange("city", e.target.value)}
                          placeholder={cepLoading ? "Buscando..." : "Cidade"}
                          disabled={loading || cepLoading}
                          className="h-11 focus-visible:ring-amber-500"
                        />
                        {errors.city && <p className="text-xs text-destructive animate-fade-in">{errors.city}</p>}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-sm text-[#3D2B1F]">Estado</Label>
                        <Select value={form.state} onValueChange={(v) => handleChange("state", v)} disabled={loading || cepLoading}>
                          <SelectTrigger className="h-11 focus:ring-amber-500">
                            <SelectValue placeholder="UF" />
                          </SelectTrigger>
                          <SelectContent>
                            {STATES.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.state && <p className="text-xs text-destructive animate-fade-in">{errors.state}</p>}
                      </div>
                    </div>
                  </>
                )}

                {/* ── STEP 3: Profile + Security ── */}
                {step === 3 && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-sm text-[#3D2B1F]">Gênero</Label>
                      <Select value={form.gender} onValueChange={(v) => handleChange("gender", v)} disabled={loading}>
                        <SelectTrigger className="h-11 focus:ring-amber-500">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {GENDER_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.gender && <p className="text-xs text-destructive animate-fade-in">{errors.gender}</p>}
                    </div>

                    {form.gender === "outro" && (
                      <Field label="Qual?" value={form.genderOther} onChange={(v) => handleChange("genderOther", v)} error={errors.genderOther} disabled={loading} />
                    )}

                    <Field label="Senha" type="password" value={form.password} onChange={(v) => handleChange("password", v)} error={errors.password} disabled={loading} />
                    <p className="text-[10px] text-muted-foreground -mt-1">Mínimo 8 caracteres, 1 maiúscula e 1 número</p>
                    <Field label="Confirmar senha" type="password" value={form.confirmPassword} onChange={(v) => handleChange("confirmPassword", v)} error={errors.confirmPassword} disabled={loading} />

                    {/* Currículo (opcional) */}
                    <div className="space-y-1.5 pt-1">
                      <Label className="text-sm text-[#3D2B1F]">
                        Currículo <span className="text-muted-foreground font-normal">(opcional)</span>
                      </Label>
                      <NativeFileInput
                        ref={resumeInputRef}
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        disabled={loading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (!ALLOWED_RESUME_EXT.test(f.name)) {
                            toast({ title: "Formato inválido", description: "Envie PDF, DOC ou DOCX.", variant: "destructive" });
                            return;
                          }
                          if (f.size > MAX_RESUME_SIZE) {
                            toast({ title: "Arquivo muito grande", description: "Máximo 10MB.", variant: "destructive" });
                            return;
                          }
                          setResumeFile(f);
                        }}
                      />
                      {resumeFile ? (
                        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                          <FileText className="h-4 w-4 text-amber-700 shrink-0" />
                          <span className="flex-1 text-xs text-[#3D2B1F] truncate">{resumeFile.name}</span>
                          <button
                            type="button"
                            onClick={() => setResumeFile(null)}
                            disabled={loading}
                            className="text-[#3D2B1F]/60 hover:text-destructive"
                            aria-label="Remover currículo"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full h-11 justify-start text-sm font-normal text-[#3D2B1F]/70"
                          disabled={loading}
                          onClick={() => resumeInputRef.current?.open()}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Anexar currículo (PDF, DOC, DOCX)
                        </Button>
                      )}
                    </div>





                    <div className="flex items-start gap-2 pt-2">
                      <Checkbox
                        id="terms"
                        checked={form.termsAccepted}
                        onCheckedChange={(checked) => handleChange("termsAccepted", !!checked)}
                        disabled={loading}
                        className="mt-0.5"
                      />
                      <label htmlFor="terms" className="text-xs text-[#3D2B1F]/80 leading-snug cursor-pointer">
                        Li e aceito os{" "}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/termos-de-uso"); }}
                          className="underline font-medium text-primary hover:text-primary/80 bg-transparent p-0 border-0 cursor-pointer"
                        >
                          Termos de Uso
                        </button>{" "}
                        e a{" "}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/politica-de-privacidade"); }}
                          className="underline font-medium text-primary hover:text-primary/80 bg-transparent p-0 border-0 cursor-pointer"
                        >
                          Política de Privacidade
                        </button>.
                      </label>
                    </div>
                    {errors.termsAccepted && <p className="text-xs text-destructive animate-fade-in">{errors.termsAccepted}</p>}

                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="banco-curriculos"
                        checked={form.bancoCurriculosAccepted}
                        onCheckedChange={(checked) => handleChange("bancoCurriculosAccepted", !!checked)}
                        disabled={loading}
                        className="mt-0.5"
                      />
                      <label htmlFor="banco-curriculos" className="text-xs text-[#3D2B1F]/80 leading-snug cursor-pointer">
                        Li e aceito os{" "}
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/termos-banco-curriculos"); }}
                          className="underline font-medium text-primary hover:text-primary/80 bg-transparent p-0 border-0 cursor-pointer"
                        >
                          Termos do Banco de Currículos (LGPD)
                        </button>
                        , autorizando o tratamento dos meus dados para futuras oportunidades.
                      </label>
                    </div>
                    {(errors as any).bancoCurriculosAccepted && <p className="text-xs text-destructive animate-fade-in">{(errors as any).bancoCurriculosAccepted}</p>}



                  </>
                )}

                {step === 3 && isCaptchaEnabled() && (
                  <div className="pt-1 flex justify-center">
                    <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />
                  </div>
                )}

                {/* ── Navigation Buttons ── */}
                <div className="flex gap-2 pt-1">
                  {step > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={prevStep}
                      disabled={loading}
                      className="flex-1 h-12"
                    >
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      Voltar
                    </Button>
                  )}

                  {step < 3 ? (
                    <Button
                      type="button"
                      onClick={nextStep}
                      disabled={loading}
                      className="flex-1 h-12 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-white"
                    >
                      Próximo
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      className="flex-1 h-12 text-base font-semibold bg-amber-500 hover:bg-amber-600 text-white"
                      disabled={loading || !form.termsAccepted || !form.bancoCurriculosAccepted}
                    >
                      {loading ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" />Criando conta...</>
                      ) : (
                        "Criar conta"
                      )}
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Reusable Field ──
interface FieldProps extends Omit<React.ComponentProps<typeof Input>, "onChange"> {
  label: string;
  error?: string;
  onChange: (v: string) => void;
}

const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, onChange, ...props }, ref) => (
    <div className="space-y-1.5">
      <Label className="text-sm text-[#3D2B1F]">{label}</Label>
      <Input
        ref={ref}
        className="h-11 focus-visible:ring-amber-500"
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      {error && <p className="text-xs text-destructive animate-fade-in">{error}</p>}
    </div>
  )
);
Field.displayName = "Field";
