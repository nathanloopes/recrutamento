import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ValidationResult {
  enabled: boolean;
  score?: number;
  issues?: string[];
  suggestions?: string[];
  verdict?: "aprovado" | "revisar";
  message?: string;
}

export function useValidateJobDescription() {
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const validate = async (title: string, description: string) => {
    setIsValidating(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("validate-job-description", {
        body: { title, description },
      });
      if (error) throw error;
      setResult(data as ValidationResult);
      return data as ValidationResult;
    } catch (e: any) {
      console.error("Validation error:", e);
      setResult({ enabled: false, message: e.message || "Erro ao validar" });
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  const clear = () => setResult(null);

  return { validate, isValidating, result, clear };
}
