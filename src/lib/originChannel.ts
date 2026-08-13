import { Instagram, Facebook, Linkedin, Mail, MessageCircle, QrCode, UserPlus, Music2, Link2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type OriginChannel =
  | "whatsapp" | "instagram" | "facebook" | "tiktok" | "linkedin"
  | "email" | "qrcode_loja" | "indicacao" | "outro";

export const ORIGIN_CHANNEL_META: Record<OriginChannel, { label: string; Icon: LucideIcon }> = {
  whatsapp: { label: "WhatsApp", Icon: MessageCircle },
  instagram: { label: "Instagram", Icon: Instagram },
  facebook: { label: "Facebook", Icon: Facebook },
  tiktok: { label: "TikTok", Icon: Music2 },
  linkedin: { label: "LinkedIn", Icon: Linkedin },
  email: { label: "E-mail", Icon: Mail },
  qrcode_loja: { label: "QR Code", Icon: QrCode },
  indicacao: { label: "Indicação", Icon: UserPlus },
  outro: { label: "Link", Icon: Link2 },
};
