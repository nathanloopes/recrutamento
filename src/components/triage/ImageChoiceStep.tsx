import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";

interface ImageOption {
  image_url?: string;
  url?: string;
  correct?: boolean;
}

interface ImageChoiceStepProps {
  title: string;
  prompt?: string;
  options: ImageOption[];
  onSubmit: (response: { selected_index: number; selected_url: string }, score: number) => void;
  isSubmitting?: boolean;
}

export function ImageChoiceStep({ title, prompt, options, onSubmit, isSubmitting }: ImageChoiceStepProps) {
  const [selected, setSelected] = useState<string>("");

  const handleSubmit = () => {
    const idx = parseInt(selected, 10);
    if (isNaN(idx)) return;
    const opt = options[idx];
    const score = opt?.correct === true ? 100 : 0;
    onSubmit({ selected_index: idx, selected_url: opt?.image_url || opt?.url || "" }, score);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-foreground">{prompt || "Escolha a imagem correta:"}</p>
        <RadioGroup
          value={selected}
          onValueChange={setSelected}
          className="grid grid-cols-2 gap-4"
        >
          {options.map((opt, oi) => {
            const url = opt?.image_url || opt?.url;
            if (!url) return null;
            const isSel = selected === String(oi);
            return (
              <label
                key={oi}
                htmlFor={`img-opt-${oi}`}
                className={`relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                  isSel ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
                }`}
              >
                <RadioGroupItem value={String(oi)} id={`img-opt-${oi}`} className="sr-only" />
                <img src={url} alt={`Opção ${oi + 1}`} className="w-full aspect-square object-cover" loading="lazy" />
                <div className="absolute top-1 left-1 bg-background/90 text-foreground text-xs font-semibold rounded px-1.5 py-0.5">
                  {String.fromCharCode(65 + oi)}
                </div>
                {isSel && (
                  <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center text-[10px] font-bold">
                    ✓
                  </div>
                )}
              </label>
            );
          })}
        </RadioGroup>
        <Button onClick={handleSubmit} disabled={!selected || isSubmitting} className="w-full">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Enviar Resposta
        </Button>
      </CardContent>
    </Card>
  );
}
