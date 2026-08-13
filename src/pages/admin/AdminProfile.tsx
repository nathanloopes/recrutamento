import { useState, useRef } from "react";
import { Mail, Phone, MapPin, Edit2, LogOut, Building, Camera, Loader2, Settings, ClipboardList, Activity, Trash2, Lock, Image as ImageIcon, FolderOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { toast } from "sonner";
import { formatPhone, formatCEP, isValidPhone, isValidCEP, isValidFullName } from "@/lib/masks";
import { useGeocodeCep } from "@/hooks/useNearbyJobs";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024;

const STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA",
  "PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

export default function AdminProfile() {
  const { user, profile, isAdmin, isAuditor, hasRole, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { geocode } = useGeocodeCep();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const [photoSourceOpen, setPhotoSourceOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [cep, setCep] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  const name = profile?.full_name || "Usuário";
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const roleName = hasRole("admin")
    ? "Administrador"
    : hasRole("rh_franqueadora")
      ? "Admin Franquia"
      : hasRole("franqueado")
        ? "Franqueado"
        : hasRole("gestor_recrutamento")
          ? "Gestor de Recrutamento"
          : isAuditor
            ? "Auditor"
            : "Usuário";

  const roleVariant = isAdmin ? "default" : isAuditor ? "secondary" : "outline";

  // --- Avatar upload ---
  const handleAvatarClick = () => setPhotoSourceOpen(true);

  const pickFrom = (source: "camera" | "gallery" | "files") => {
    setPhotoSourceOpen(false);
    setTimeout(() => {
      if (source === "camera") cameraInputRef.current?.click();
      else if (source === "gallery") galleryInputRef.current?.click();
      else filesInputRef.current?.click();
    }, 50);
  };

  const compressImage = (file: File, maxDim = 1024, quality = 0.85): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { URL.revokeObjectURL(url); return reject(new Error("canvas 2d ctx null")); }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error("toBlob null"));
            resolve(blob);
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load error")); };
      img.src = url;
    });

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Formato inválido. Envie uma imagem.");
      return;
    }

    setUploading(true);
    try {
      // Sempre normaliza para JPEG ≤1024px e ~85% qualidade.
      // Reduz iterativamente caso ainda passe de 2MB (fotos HDR do iPhone).
      let blob: Blob = await compressImage(file, 1024, 0.85);
      if (blob.size > MAX_SIZE) blob = await compressImage(file, 900, 0.75);
      if (blob.size > MAX_SIZE) blob = await compressImage(file, 720, 0.7);
      if (blob.size > MAX_SIZE) {
        toast.error("Imagem muito grande mesmo após compressão. Tente outra foto.");
        return;
      }

      const path = `${user.id}/avatar.jpg`;
      console.log("[admin-avatar/upload] start", { path, size: blob.size, type: blob.type });
      const storage = await getStorageClient();
      const { data: uploadData, error: uploadError } = await storage.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      console.log("[admin-avatar/upload] result", { uploadData, uploadError });
      if (uploadError) throw uploadError;

      const { data: urlData } = storage.storage.from("avatars").getPublicUrl(path);
      const avatar_url = `${urlData.publicUrl}?t=${Date.now()}`;
      console.log("[admin-avatar/upload] publicUrl", avatar_url);

      const { error: updateError } = await supabase
        .from("candidate_profiles")
        .update({ photo_url: avatar_url } as any)
        .eq("candidate_id", user.id);
      console.log("[admin-avatar/upload] db update error", updateError);
      if (updateError) throw updateError;

      await supabase.from("audit_trail").insert({
        actor_id: user.id,
        action: "profile_avatar_updated",
        target_type: "profile",
        target_id: user.id,
        context: { source: "admin_profile" },
      });

      await refreshProfile();
      toast.success("Foto atualizada!");
    } catch (err: any) {
      console.error("[admin-avatar/upload] failed", err);
      toast.error(err.message || "Erro ao enviar foto.");
    } finally {
      setUploading(false);
      // Reset para permitir reenviar o mesmo arquivo
      [cameraInputRef, galleryInputRef, filesInputRef].forEach((r) => {
        if (r.current) r.current.value = "";
      });
    }
  };

  // --- CEP auto-lookup ---
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
      if (data.street) setStreet(data.street);
      if (data.neighborhood) setNeighborhood(data.neighborhood);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
    } catch {
      // silent
    } finally {
      setCepLoading(false);
    }
  };

  // --- Password change ---
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

  // --- Edit dialog ---
  const openEdit = () => {
    const addr = profile?.address_json || {};
    setFullName(profile?.full_name || "");
    setPhone(profile?.phone || "");
    setCep(profile?.cep || "");
    setStreet(addr.street || "");
    setNumber(addr.number || "");
    setComplement(addr.complement || "");
    setNeighborhood(addr.neighborhood || "");
    setCity(profile?.city || "");
    setState(profile?.state || "");
    setNewPassword("");
    setConfirmPassword("");
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!user) return;

    if (!isValidFullName(fullName)) {
      toast.error("Informe nome e sobrenome.");
      return;
    }
    if (phone && !isValidPhone(phone)) {
      toast.error("Telefone inválido.");
      return;
    }
    if (cep && !isValidCEP(cep)) {
      toast.error("CEP inválido.");
      return;
    }

    setSaving(true);
    try {
      const oldValues = {
        full_name: profile?.full_name ?? null,
        phone: profile?.phone ?? null,
        cep: profile?.cep ?? null,
        city: profile?.city ?? null,
        state: profile?.state ?? null,
      };

      // SAFE PATCH: só envia campos realmente alterados e não-vazios.
      // address_json é mesclado com o existente (nunca reconstruído do zero).
      const candidateFields: Record<string, string> = {
        full_name: fullName.trim(),
        phone: phone.trim(),
        cep: cep.trim(),
        city: city.trim(),
        state: state.trim(),
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

      const existingAddr = ((profile as any)?.address_json as Record<string, any>) || {};
      const addrCandidate: Record<string, string> = {
        street: street.trim(),
        number: number.trim(),
        complement: complement.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        cep: cep.trim(),
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

      if (Object.keys(updates).length === 0) {
        toast.info("Nenhuma alteração para salvar.");
        setSaving(false);
        setEditOpen(false);
        return;
      }

      const { error } = await supabase
        .from("candidate_profiles")
        .update(updates)
        .eq("candidate_id", user.id);
      if (error) throw error;

      await supabase.from("audit_trail").insert({
        actor_id: user.id,
        action: "profile_updated",
        target_type: "profile",
        target_id: user.id,
        context: { old: oldValues, new: updates, source: "admin_profile" },
      });

      const cepChanged = !!updates.cep;
      if (cepChanged) {
        geocode({ cep: cep.trim(), table: "profiles", record_id: user.id, city: city.trim(), state: state.trim() });
      }

      await refreshProfile();
      setEditOpen(false);
      toast.success("Perfil atualizado!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-display font-bold text-foreground">Meu Perfil</h1>
        <Button variant="ghost" size="icon" onClick={openEdit}>
          <Edit2 className="h-4 w-4" />
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center gap-4 p-4">
          <div className="relative">
            <Avatar className="h-16 w-16">
              {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
              <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={handleAvatarClick}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground rounded-full p-1.5 shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={handleAvatarChange}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleAvatarChange}
            />
            <input
              ref={filesInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              onChange={handleAvatarChange}
            />

            <Dialog open={photoSourceOpen} onOpenChange={setPhotoSourceOpen}>
              <DialogContent className="max-w-xs">
                <DialogHeader>
                  <DialogTitle>Alterar foto de perfil</DialogTitle>
                  <DialogDescription>Escolha de onde deseja enviar a imagem.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 pt-2">
                  <Button variant="outline" className="justify-start h-12" onClick={() => pickFrom("camera")}>
                    <Camera className="h-4 w-4 mr-3" /> Câmera
                  </Button>
                  <Button variant="outline" className="justify-start h-12" onClick={() => pickFrom("gallery")}>
                    <ImageIcon className="h-4 w-4 mr-3" /> Galeria
                  </Button>
                  <Button variant="outline" className="justify-start h-12" onClick={() => pickFrom("files")}>
                    <FolderOpen className="h-4 w-4 mr-3" /> Arquivos
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-semibold text-foreground">{name}</h2>
            <Badge variant={roleVariant}>{roleName}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          {profile?.email && <InfoRow icon={Mail} label={profile.email} />}
          {profile?.phone && <InfoRow icon={Phone} label={profile.phone} />}
          {(profile?.city || profile?.state) && (
            <InfoRow icon={Building} label={[profile.city, profile.state].filter(Boolean).join(" – ")} />
          )}
          {profile?.cep && <InfoRow icon={MapPin} label={`CEP: ${profile.cep}`} />}
        </CardContent>
      </Card>

      {hasRole("admin") && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-2">
            <button
              type="button"
              onClick={() => navigate("/admin/configuracoes")}
              className="flex items-center gap-3 w-full text-sm text-foreground hover:text-primary transition-colors py-1.5"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span>Configurações Globais</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/logs")}
              className="flex items-center gap-3 w-full text-sm text-foreground hover:text-primary transition-colors py-1.5"
            >
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <span>Auditoria</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/monitoramento")}
              className="flex items-center gap-3 w-full text-sm text-foreground hover:text-primary transition-colors py-1.5"
            >
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span>Dashboard de Monitoramento</span>
            </button>
          </CardContent>
        </Card>
      )}

      <Button
        variant="outline"
        className="w-full text-destructive hover:text-destructive"
        onClick={handleSignOut}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Sair da conta
      </Button>

      <footer className="text-center text-xs text-muted-foreground pt-4 pb-2">
        <a
          href="https://recrutamento.example.com/politica-de-privacidade"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-primary"
        >
          Política de Privacidade
        </a>
      </footer>


      <Button
        variant="ghost"
        className="w-full text-destructive/70 hover:text-destructive hover:bg-destructive/10"
        onClick={async () => {
          if (!window.confirm("Tem certeza que deseja excluir sua conta? Esta ação é irreversível e todos os seus dados serão removidos.")) return;
          setDeleting(true);
          try {
            const { error } = await supabase.functions.invoke("delete-account");
            if (error) throw error;
            await signOut();
            navigate("/auth", { replace: true });
          } catch (err: any) {
            toast.error(err.message || "Erro ao excluir conta.");
          } finally {
            setDeleting(false);
          }
        }}
        disabled={deleting}
      >
        {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
        Excluir minha conta
      </Button>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Perfil</DialogTitle>
            <DialogDescription>Atualize suas informações pessoais.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input value={profile?.email || ""} disabled className="opacity-60" />
            </div>

            <div className="space-y-1.5">
              <Label>Nome completo</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nome Sobrenome"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(00) 00000-0000"
                inputMode="tel"
              />
            </div>

            <div className="space-y-1.5">
              <Label>CEP</Label>
              <div className="relative">
                <Input
                  value={cep}
                  onChange={(e) => {
                    const val = formatCEP(e.target.value);
                    setCep(val);
                    if (val.replace(/\D/g, "").length === 8) lookupCEP(val);
                  }}
                  placeholder="00000-000"
                  inputMode="numeric"
                />
                {cepLoading && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Rua</Label>
              <Input
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder="Rua / Avenida"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Número</Label>
                <Input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Nº"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Complemento</Label>
                <Input
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Apto, Bloco..."
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Bairro</Label>
              <Input
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                placeholder="Bairro"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Cidade"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={state} onValueChange={(v) => setState(v)}>
                  <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>
                    {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
