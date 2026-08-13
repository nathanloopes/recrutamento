import { useState, useRef } from "react";
import { NativeFileInput, type NativeFileInputHandle } from "@/components/ui/NativeFileInput";
import { User, Mail, Phone, MapPin, Edit2, LogOut, TrendingUp, Camera, Lock, Info, Loader2, Trash2, Bell, Upload, UserPlus, MailOpen, CheckCircle, XCircle, RotateCcw, AlertTriangle, Briefcase } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, Link } from "react-router-dom";
import { PageHelp } from "@/components/ui/page-help";
import { useTalentPoolEntry } from "@/hooks/useTalentPool";
import { useApplicationScores, labelForApplicationStatus } from "@/hooks/useApplicationScores";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { uploadResume } from "@/lib/resumeUpload";
import { toast } from "sonner";
import { useGeocodeCep } from "@/hooks/useNearbyJobs";
import { getAdminRecipientIds } from "@/lib/notificationRoutes";
import { formatPhone, formatCEP, isValidPhone, isValidCEP, isValidFullName, isMinAge } from "@/lib/masks";
import { formatCPF } from "@/lib/cpf";
import { formatDateBR, ymdToLocalDate, dateToLocalYMD } from "@/lib/dateUtils";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useNotificationPreferences";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];


const GENDER_OPTIONS = [
  { value: "masculino", label: "Masculino" },
  { value: "feminino", label: "Feminino" },
  { value: "nao_binario", label: "Não-binário" },
  { value: "outro", label: "Outro" },
  { value: "nao_declarar", label: "Prefiro não declarar" },
];

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export default function Profile() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { data: talentEntry } = useTalentPoolEntry();
  const { data: applicationScores } = useApplicationScores();
  const { geocode } = useGeocodeCep();
  const { data: notifPref } = useNotificationPreferences();
  const updateNotifPref = useUpdateNotificationPreferences();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    birth_date: "",
    gender: "",
  });
  const [cepLoading, setCepLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<NativeFileInputHandle>(null);
  const resumeInputRef = useRef<NativeFileInputHandle>(null);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [deletingResume, setDeletingResume] = useState(false);
  const [confirmDeleteResume, setConfirmDeleteResume] = useState(false);
  
  const [showCamera, setShowCamera] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const videoRef = useState<HTMLVideoElement | null>(null);
  const streamRef = useState<MediaStream | null>(null);


  const openCamera = async () => {
    setShowCamera(true);
    setCapturedPhoto(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 480, height: 480 },
      });
      streamRef[1](stream);
      // Assign stream after dialog renders
      setTimeout(() => {
        if (videoRef[0]) {
          videoRef[0].srcObject = stream;
          videoRef[0].play();
        }
      }, 200);
    } catch {
      toast.error("Não foi possível acessar a câmera.");
      setShowCamera(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef[0]) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef[0].videoWidth;
    canvas.height = videoRef[0].videoHeight;
    canvas.getContext("2d")!.drawImage(videoRef[0], 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedPhoto(dataUrl);
    // Stop stream
    streamRef[0]?.getTracks().forEach((t) => t.stop());
  };

  const confirmCameraPhoto = async () => {
    if (!capturedPhoto || !user) return;
    setUploading(true);
    try {
      const res = await fetch(capturedPhoto);
      const blob = await res.blob();
      const path = `${user.id}/avatar.jpg`;
      console.log("[avatar/camera] upload start", { path, size: blob.size, type: blob.type });
      const storage = await getStorageClient();
      const { data: upData, error } = await storage.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      console.log("[avatar/camera] upload result", { upData, error });
      if (error) throw error;
      const { data: urlData } = storage.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      console.log("[avatar/camera] publicUrl", publicUrl);
      const { error: updErr } = await supabase.from("candidate_profiles").update({ photo_url: publicUrl } as any).eq("candidate_id", user.id);
      console.log("[avatar/camera] db update error", updErr);
      if (updErr) throw updErr;
      await refreshProfile();
      toast.success("Avatar atualizado!");
      setShowCamera(false);
      setCapturedPhoto(null);
    } catch (err: any) {
      console.error("[avatar/camera] failed", err);
      toast.error(err?.message || "Erro ao salvar foto");
    } finally {
      setUploading(false);
    }
  };

  const closeCamera = () => {
    streamRef[0]?.getTracks().forEach((t) => t.stop());
    setShowCamera(false);
    setCapturedPhoto(null);
  };

  const normalizeGender = (raw: string | null | undefined): string => {
    if (!raw) return "";
    const known = GENDER_OPTIONS.find(o => o.value === raw);
    if (known) return raw;
    const map: Record<string, string> = {
      "Homem cis": "masculino",
      "Mulher cis": "feminino",
      "Homem trans": "masculino",
      "Mulher trans": "feminino",
      "Outros": "outro",
    };
    return map[raw] || "";
  };

  const openEdit = () => {
    const addr = profile?.address_json || {};
    setForm({
      full_name: profile?.full_name || "",
      phone: profile?.phone || "",
      cep: profile?.cep || "",
      street: addr.street || "",
      number: addr.number || "",
      complement: addr.complement || "",
      neighborhood: addr.neighborhood || "",
      city: profile?.city || "",
      state: profile?.state || "",
      birth_date: profile?.birth_date || "",
      gender: normalizeGender(profile?.gender),
    });
    setErrors({});
    setNewPassword("");
    setConfirmPassword("");
    setEditing(true);
  };

  const lookupCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", {
        body: { cep: digits },
      });
      if (error || !data?.found) {
        if (data?.error_type === "invalid_cep") toast.error("CEP não encontrado.");
        setCepLoading(false);
        return;
      }
      setForm(f => ({
        ...f,
        street: data.street || f.street,
        neighborhood: data.neighborhood || f.neighborhood,
        city: data.city || f.city,
        state: data.state || f.state,
      }));
    } catch {
      // silent
    } finally {
      setCepLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Senha alterada com sucesso!");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar senha.");
    } finally {
      setChangingPassword(false);
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (form.full_name && !isValidFullName(form.full_name)) {
      errs.full_name = "Informe nome e sobrenome (mínimo 3 caracteres)";
    }
    if (form.phone && !isValidPhone(form.phone)) {
      errs.phone = "Telefone inválido (10-11 dígitos)";
    }
    if (!form.cep) {
      errs.cep = "CEP é obrigatório";
    } else if (!isValidCEP(form.cep)) {
      errs.cep = "CEP inválido (8 dígitos)";
    }
    if (!form.city.trim()) {
      errs.city = "Cidade é obrigatória";
    }
    if (!form.state) {
      errs.state = "Estado é obrigatório";
    }
    if (!form.birth_date) {
      errs.birth_date = "Data de nascimento é obrigatória";
    } else if (!isMinAge(form.birth_date, 14)) {
      errs.birth_date = "Idade mínima: 14 anos";
    }
    if (!form.gender) {
      errs.gender = "Gênero é obrigatório";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!user || !profile) return;
    if (!validate()) return;

    setSaving(true);

    // ==========================================================================
    // SAFE PATCH UPDATE — nunca sobrescreve dados existentes com vazio.
    // ==========================================================================
    // Regra: só envia campos que foram REALMENTE alterados pelo usuário e
    // que não são strings vazias. Campos vazios = "não modificado" (usuário
    // limpou no form mas não quis deletar — UX não tem "botão limpar").
    // address_json é MESCLADO com o existente (preserva chaves que o form
    // não conhece, ex. lat/lng, geocoding, etc.).

    const oldValues = {
      full_name: profile.full_name ?? null,
      phone: profile.phone ?? null,
      cep: profile.cep ?? null,
      city: profile.city ?? null,
      state: profile.state ?? null,
      birth_date: profile.birth_date ?? null,
      gender: profile.gender ?? null,
    };

    // Campos top-level: só inclui se trimmed não vazio E diferente do atual.
    const candidateFields: Record<string, string> = {
      full_name: form.full_name.trim(),
      phone: form.phone.trim(),
      cep: form.cep.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      birth_date: form.birth_date.trim(),
      gender: form.gender.trim(),
    };

    const updates: Record<string, any> = {};
    (Object.keys(candidateFields) as Array<keyof typeof candidateFields>).forEach((key) => {
      const nextVal = candidateFields[key];
      if (nextVal === "") return; // nunca sobrescreve com vazio
      const currentVal = (oldValues as Record<string, any>)[key] ?? "";
      if (nextVal !== currentVal) {
        updates[key] = nextVal;
      }
    });

    // address_json: merge com existente, só inclui chaves não-vazias alteradas.
    const existingAddr = (profile.address_json as Record<string, any>) || {};
    const addrCandidate: Record<string, string> = {
      street: form.street.trim(),
      number: form.number.trim(),
      complement: form.complement.trim(),
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      cep: form.cep.trim(),
    };
    const mergedAddr: Record<string, any> = { ...existingAddr };
    let addressChangedInJson = false;
    Object.keys(addrCandidate).forEach((key) => {
      const nextVal = addrCandidate[key];
      if (nextVal === "") return;
      if (nextVal !== (existingAddr[key] ?? "")) {
        mergedAddr[key] = nextVal;
        addressChangedInJson = true;
      }
    });
    if (addressChangedInJson) {
      updates.address_json = mergedAddr;
    }

    // Se nada mudou, encerra sem hit no banco.
    if (Object.keys(updates).length === 0) {
      toast.info("Nenhuma alteração para salvar.");
      setSaving(false);
      setEditing(false);
      return;
    }

    const { error } = await supabase
      .from("candidate_profiles")
      .update(updates)
      .eq("candidate_id", user.id);

    if (error) {
      toast.error("Erro ao salvar perfil");
      setSaving(false);
      return;
    }

    // Espelha phone em candidates (Z-API / WhatsApp PWA usa candidates.phone)
    if (typeof updates.phone === "string" && updates.phone.length > 0) {
      const phoneDigits = updates.phone.replace(/\D/g, "");
      if (phoneDigits) {
        const { error: candPhoneErr } = await supabase
          .from("candidates")
          .update({ phone: phoneDigits } as any)
          .eq("id", user.id);
        if (candPhoneErr) {
          console.warn("[Profile] Falha ao espelhar phone em candidates:", candPhoneErr);
        }
      }
    }

    // Determine changed fields
    const changedFields = Object.keys(updates).filter(
      (k) => (updates[k] ?? "") !== ((oldValues as any)[k] ?? "")
    );

    // Audit trail
    if (changedFields.length > 0) {
      const oldContext: Record<string, any> = {};
      const newContext: Record<string, any> = {};
      changedFields.forEach((f) => {
        oldContext[f] = (oldValues as any)[f];
        newContext[f] = updates[f];
      });

      await supabase.from("audit_trail").insert({
        actor_id: user.id,
        action: "profile_update",
        target_type: "profile",
        target_id: user.id,
        context: { old: oldContext, new: newContext, changed_fields: changedFields },
      });
    }

    // Notify admins if address changed and candidate has active applications
    const addressChanged = changedFields.some((f) => ["cep", "city", "state"].includes(f));
    if (addressChanged) {
      try {
        const { data: activeApps } = await supabase
          .from("applications")
          .select("id, unit_job_id")
          .eq("candidate_id", user.id)
          .eq("status", "em_andamento");

        if (activeApps && activeApps.length > 0) {
          // Get unit admins for each application's unit
          const unitJobIds = activeApps.map((a) => a.unit_job_id);
          const { data: unitJobs } = await supabase
            .from("unit_jobs")
            .select("unit_id")
            .in("id", unitJobIds);

          if (unitJobs) {
            const unitIds = [...new Set(unitJobs.map((uj) => uj.unit_id))];
            const admins = (await getAdminRecipientIds()).map(uid => ({ user_id: uid }));

            if (admins.length > 0) {
              const notifications = admins.map((admin) => ({
                recipient_id: admin.user_id,
                event_type: "address_change",
                channel: "in_app",
                action_type: "info",
                title: "Candidato alterou endereço",
                body: `O candidato ${form.full_name || profile.full_name} alterou o endereço durante processo ativo.`,
                payload: {
                  candidate_id: user.id,
                  changed_fields: changedFields.filter((f) => ["cep", "city", "state"].includes(f)),
                  old: { cep: oldValues.cep, city: oldValues.city, state: oldValues.state },
                  new: { cep: form.cep, city: form.city, state: form.state },
                },
              }));
              await supabase.from("notifications").insert(notifications);
            }
          }
        }
      } catch {
        // Non-critical, don't block the save
      }
    }

    toast.success("Perfil atualizado!");
    await refreshProfile();
    setSaving(false);
    setEditing(false);

    // Geocode CEP in background
    if (form.cep && user) {
      geocode({ cep: form.cep, table: "profiles", record_id: user.id, city: form.city, state: form.state });
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      toast.error("Formato não aceito. Use JPEG, PNG ou WEBP.");
      return;
    }

    // Validate file size
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error("Imagem muito grande. Máximo: 2MB.");
      return;
    }

    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/avatar.${ext}`;
      console.log("[avatar/upload] start", { path, size: file.size, type: file.type });
      const storage = await getStorageClient();
      const { data: upData, error } = await storage.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      console.log("[avatar/upload] result", { upData, error });
      if (error) {
        toast.error(`Erro no upload do avatar: ${error.message}`);
        return;
      }
      const { data: urlData } = storage.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      console.log("[avatar/upload] publicUrl", publicUrl);
      const { error: updErr } = await supabase
        .from("candidate_profiles")
        .update({ photo_url: publicUrl } as any)
        .eq("candidate_id", user.id);
      console.log("[avatar/upload] db update error", updErr);
      if (updErr) {
        toast.error(`Erro ao salvar avatar: ${updErr.message}`);
        return;
      }
      await refreshProfile();
      toast.success("Avatar atualizado!");
    } catch (err: any) {
      console.error("[avatar/upload] failed", err);
      toast.error(err?.message || "Erro no upload do avatar");
    } finally {
      setUploading(false);
    }
  };

  const [deleting, setDeleting] = useState(false);
  

  // ===== Currículo =====
  const MAX_RESUME_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_RESUME_TYPES = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  const { data: resumeVersions, refetch: refetchResumes } = useQuery({
    queryKey: ["resume_versions", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resume_versions")
        .select("id, file_name, file_url, uploaded_at, version")
        .eq("candidate_id", user!.id)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: profileResumeFallback } = useQuery({
    queryKey: ["candidate_profile_resume", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidate_profiles")
        .select("resume_url")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.resume_url || null;
    },
  });

  const currentResumePath =
    (profile as any)?.resume_url ||
    resumeVersions?.[0]?.file_url ||
    profileResumeFallback ||
    null;
  const currentResumeName = resumeVersions?.[0]?.file_name || (currentResumePath ? currentResumePath.split("/").pop() : null);

  const handleResumeUpload = async (e: { target: { files: FileList | null; value: string } }) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingResume(true);
    try {
      await uploadResume(user.id, file);
      await Promise.all([refreshProfile(), refetchResumes()]);
      toast.success("Currículo enviado!");
    } catch (err: any) {
      console.error("[Profile] resume upload error", err);
      toast.error(err?.message || "Erro ao enviar currículo.");
    } finally {
      setUploadingResume(false);
    }
  };

  const handleDeleteResume = async () => {
    if (!user || !currentResumePath) return;
    setDeletingResume(true);
    try {
      // Remove todos os arquivos armazenados + registros de versão
      const paths = Array.from(
        new Set(
          [
            currentResumePath,
            ...((resumeVersions || []).map((v: any) => v.file_url).filter(Boolean) as string[]),
          ].filter(Boolean),
        ),
      );
      if (paths.length > 0) {
        const storage = await getStorageClient();
        const { error: rmErr } = await storage.storage.from("documents").remove(paths);
        if (rmErr) console.warn("[Profile] resume remove storage error", rmErr);
      }
      const { error: delErr } = await supabase
        .from("resume_versions")
        .delete()
        .eq("candidate_id", user.id);
      if (delErr) throw delErr;
      const { error: profErr } = await supabase
        .from("candidate_profiles")
        .update({ resume_url: null } as any)
        .eq("candidate_id", user.id);
      if (profErr) throw profErr;

      await Promise.all([refreshProfile(), refetchResumes()]);
      toast.success("Currículo removido.");
      setConfirmDeleteResume(false);
    } catch (err: any) {
      console.error("[Profile] resume delete error", err);
      toast.error(err?.message || "Erro ao remover currículo.");
    } finally {
      setDeletingResume(false);
    }
  };

  const handleDownloadResume = async () => {
    if (!currentResumePath) return;
    try {
      const storage = await getStorageClient();
      const { data, error } = await storage.storage.from("documents").download(currentResumePath);
      if (error || !data) throw error || new Error("download_failed");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = currentResumeName || "curriculo";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao baixar currículo.");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };


  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Tem certeza que deseja excluir sua conta? Todos os seus dados serão removidos permanentemente. Esta ação NÃO pode ser desfeita."
    );
    if (!confirmed) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) { toast.error("Você precisa estar logado."); return; }

    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-account", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Handle transport/HTTP errors
      if (error) {
        let stage = "";
        let detail = "";
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            stage = body?.stage || "";
            detail = body?.error || "";
          }
        } catch { /* ignore */ }
        console.error("[DeleteAccount] Error:", error, "stage:", stage, "detail:", detail);
        toast.error(`Falha ao excluir conta${stage ? ` (etapa: ${stage})` : ""}. Tente novamente.`);
        setDeleting(false);
        return;
      }

      // Handle backend-level errors
      if (!data?.success) {
        console.error("[DeleteAccount] Backend error:", data?.error, "stage:", data?.stage);
        toast.error(`Falha ao excluir conta${data?.stage ? ` (etapa: ${data.stage})` : ""}. Tente novamente.`);
        setDeleting(false);
        return;
      }

      // SUCCESS: data.success === true && data.deleted_id exists
      console.log("[DeleteAccount] Account deleted successfully:", data.deleted_id);
      toast.success("Conta excluída com sucesso. Sentiremos sua falta!");
      await signOut();
      navigate("/auth", { replace: true });
    } catch (err) {
      console.error("[DeleteAccount] Unexpected error:", err);
      toast.error("Erro inesperado ao excluir conta. Tente novamente.");
      setDeleting(false);
    }
  };

  const name = profile?.full_name || "Candidato";
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <TooltipProvider>
      <div className="px-4 pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-display font-bold text-foreground">Perfil</h1>
          <div className="flex items-center gap-1">
            <PageHelp />
            <Button variant="ghost" size="icon" onClick={openEdit}>
              <Edit2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Avatar + Name */}
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative">
              <Avatar className="h-16 w-16">
                {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
                <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <NativeFileInput accept="image/jpeg,image/png,image/webp" ref={fileInputRef} onChange={handleAvatarUpload} disabled={uploading} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer shadow-md"
                    disabled={uploading}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="right">
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    Enviar imagem
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-foreground">{name}</h2>
              {profile?.city && profile?.state && (
                <p className="text-xs text-muted-foreground">{profile.city} / {profile.state}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Camera Dialog */}
        <Dialog open={showCamera} onOpenChange={(open) => { if (!open) closeCamera(); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Tirar Foto</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4">
              {!capturedPhoto ? (
                <>
                  <video
                    ref={(el) => videoRef[1](el)}
                    autoPlay
                    playsInline
                    muted
                    className="w-full rounded-lg aspect-square object-cover bg-muted"
                  />
                  <Button onClick={capturePhoto} className="w-full">
                    <Camera className="h-4 w-4 mr-2" /> Capturar
                  </Button>
                </>
              ) : (
                <>
                  <img src={capturedPhoto} alt="Preview" className="w-full rounded-lg aspect-square object-cover" />
                  <div className="flex gap-2 w-full">
                    <Button variant="outline" className="flex-1" onClick={() => { setCapturedPhoto(null); openCamera(); }}>
                      Refazer
                    </Button>
                    <Button className="flex-1" onClick={confirmCameraPhoto} disabled={uploading}>
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Usar Foto
                    </Button>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Info */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            {profile?.email && <InfoRow icon={Mail} label={profile.email} />}
            {profile?.phone && <InfoRow icon={Phone} label={profile.phone} />}
            {profile?.cpf && <InfoRow icon={Lock} label={`CPF: ${formatCPF(profile.cpf)}`} />}
            {profile?.cep && <InfoRow icon={MapPin} label={`CEP: ${profile.cep}`} />}
            {profile?.birth_date && <InfoRow icon={User} label={`Nascimento: ${formatDateBR(profile.birth_date)}`} />}
          </CardContent>
        </Card>

        {/* Currículo */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Meu currículo</h3>
            </div>

            {currentResumePath ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {currentResumeName || "Currículo enviado"}
                    </p>
                    {resumeVersions?.[0]?.uploaded_at && (
                      <p className="text-[10px] text-muted-foreground">
                        Enviado em {new Date(resumeVersions[0].uploaded_at).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={handleDownloadResume} className="text-xs">
                    Baixar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteResume(true)}
                    className="text-xs text-destructive hover:text-destructive"
                    disabled={deletingResume}
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Anexe seu currículo (PDF, DOC ou DOCX, até 10MB) para que os recrutadores conheçam sua trajetória.
              </p>
            )}

            <NativeFileInput
              ref={resumeInputRef}
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={uploadingResume}
              onChange={handleResumeUpload}
            />
            <Button
              type="button"
              variant={currentResumePath ? "outline" : "default"}
              className="w-full"
              disabled={uploadingResume}
              onClick={() => resumeInputRef.current?.open()}
            >
              {uploadingResume ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> {currentResumePath ? "Substituir currículo" : "Anexar currículo"}</>
              )}
            </Button>

            <AlertDialog open={confirmDeleteResume} onOpenChange={setConfirmDeleteResume}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir currículo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação remove o arquivo e o histórico de versões vinculados ao seu perfil. Você poderá anexar um novo currículo depois.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletingResume}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); handleDeleteResume(); }}
                    disabled={deletingResume}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deletingResume ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Excluindo...</>) : "Excluir"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>



        {/* Resultados dos seus testes */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary">
                <TrendingUp className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">Resultados dos seus testes</p>
            </div>

            {applicationScores && applicationScores.length > 0 ? (
              <div className="space-y-3">
                {applicationScores.map((app) => (
                  <div key={app.applicationId} className="space-y-1 pb-3 border-b border-border/40 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{app.jobTitle}</p>
                        {app.unitName && (
                          <p className="text-[11px] text-muted-foreground truncate">{app.unitName}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-sm font-bold text-primary">{Math.round(app.totalScore)}</span>
                        <Badge variant="outline" className="text-[10px] mt-0.5">
                          {labelForApplicationStatus(app.status)}
                        </Badge>
                      </div>
                    </div>
                    <Progress value={Math.min(100, Math.round(app.totalScore))} className="h-1.5" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">Nenhum teste concluído até o momento.</p>
            )}
          </CardContent>
        </Card>


        {/* Notification Preferences */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" /> Canal de Notificação Preferido
            </h3>
            <Select
              value={notifPref?.preferred_channel || "push"}
              onValueChange={(v) => {
                updateNotifPref.mutate({ preferred_channel: v, event_overrides: notifPref?.event_overrides || {} }, {
                  onSuccess: () => toast.success("Preferência de notificação atualizada!"),
                  onError: (e: any) => toast.error("Erro ao salvar: " + e.message),
                });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="push">Push (Notificação no app)</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Escolha como prefere receber comunicações sobre suas candidaturas.</p>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="w-full text-destructive hover:text-destructive"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sair da conta
        </Button>

        {/* Encerrar conta */}
        <div className="mt-6 pt-6 border-t border-red-200">
          <h3 className="text-sm font-bold text-red-600 mb-1">Encerrar minha conta</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Ao excluir sua conta, suas candidaturas e dados pessoais serão removidos permanentemente. Essa ação não pode ser desfeita.
          </p>
          <Button
            variant="destructive"
            className="w-full"
            onClick={handleDeleteAccount}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {deleting ? "Excluindo..." : "Excluir Minha Conta"}
          </Button>
          <p className="text-center text-xs text-muted-foreground mt-3">
            <a
              href="https://recrutamento.example.com/politica-de-privacidade"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary"
            >
              Política de Privacidade
            </a>
          </p>
        </div>




        {/* Edit Dialog */}
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar Perfil</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {/* Email - read-only */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label className="text-muted-foreground">E-mail</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-[200px]">Para alterar o e-mail, entre em contato com o suporte.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input value={profile?.email || ""} disabled className="bg-muted" />
              </div>

              {/* CPF - read-only */}
              {profile?.cpf && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-muted-foreground">CPF</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Lock className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs max-w-[200px]">O CPF não pode ser alterado.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input value={formatCPF(profile.cpf)} disabled className="bg-muted" />
                </div>
              )}

              {/* Name */}
              <div className="space-y-1.5">
                <Label>Nome completo</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
                {errors.full_name && <p className="text-xs text-destructive">{errors.full_name}</p>}
              </div>

              {/* Phone with mask */}
              <div className="space-y-1.5">
                <Label>Telefone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                  placeholder="(00) 00000-0000"
                />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
              </div>

              {/* CEP with mask + auto-lookup */}
              <div className="space-y-1.5">
                <Label>CEP <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    value={form.cep}
                    onChange={(e) => {
                      const val = formatCEP(e.target.value);
                      setForm(f => ({ ...f, cep: val }));
                      if (val.replace(/\D/g, "").length === 8) lookupCEP(val);
                    }}
                    placeholder="00000-000"
                  />
                  {cepLoading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {errors.cep && <p className="text-xs text-destructive">{errors.cep}</p>}
              </div>

              {/* Street */}
              <div className="space-y-1.5">
                <Label>Rua</Label>
                <Input
                  value={form.street}
                  onChange={(e) => setForm(f => ({ ...f, street: e.target.value }))}
                  placeholder="Rua / Avenida"
                />
              </div>

              {/* Number + Complement */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Número</Label>
                  <Input
                    value={form.number}
                    onChange={(e) => setForm(f => ({ ...f, number: e.target.value }))}
                    placeholder="Nº"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Complemento</Label>
                  <Input
                    value={form.complement}
                    onChange={(e) => setForm(f => ({ ...f, complement: e.target.value }))}
                    placeholder="Apto, Bloco..."
                  />
                </div>
              </div>

              {/* Neighborhood */}
              <div className="space-y-1.5">
                <Label>Bairro</Label>
                <Input
                  value={form.neighborhood}
                  onChange={(e) => setForm(f => ({ ...f, neighborhood: e.target.value }))}
                  placeholder="Bairro"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Cidade <span className="text-destructive">*</span></Label>
                  <Input value={form.city} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))} />
                  {errors.city && <p className="text-xs text-destructive">{errors.city}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>Estado <span className="text-destructive">*</span></Label>
                  <Select value={form.state} onValueChange={(v) => setForm(f => ({ ...f, state: v }))}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.state && <p className="text-xs text-destructive">{errors.state}</p>}
                </div>
              </div>

              {/* Birth date */}
              <div className="space-y-1.5">
                <Label>Data de nascimento <span className="text-destructive">*</span></Label>
                <MaskedDateInput value={ymdToLocalDate(form.birth_date)} onChange={(d) => setForm(f => ({ ...f, birth_date: dateToLocalYMD(d) }))} format="dd/MM/yyyy" placeholder="Data de nascimento" />
                {errors.birth_date && <p className="text-xs text-destructive">{errors.birth_date}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Gênero <span className="text-destructive">*</span></Label>
                <Select value={form.gender} onValueChange={(v) => setForm(f => ({ ...f, gender: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.gender && <p className="text-xs text-destructive">{errors.gender}</p>}
              </div>

              {/* Password change section */}
              <div className="border-t pt-4 mt-2 space-y-3">
                <Label className="text-sm font-semibold flex items-center gap-2">
                  <Lock className="h-4 w-4" /> Alterar Senha
                </Label>
                <div className="space-y-1.5">
                  <Label>Nova senha</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Confirmar nova senha</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleChangePassword}
                  disabled={changingPassword || !newPassword}
                  className="w-full"
                >
                  {changingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Alterar Senha
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function InfoRow({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-foreground">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}
