import * as React from "react";
import { cn } from "@/lib/utils";

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TimeInput({ value, onChange, placeholder = "HH:MM", className, disabled }: TimeInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
    
    if (raw.length <= 2) {
      // Just hours or partial
      onChange(raw);
    } else {
      // Hours + minutes
      let hours = raw.slice(0, 2);
      let mins = raw.slice(2);
      
      // Clamp hours
      const h = parseInt(hours, 10);
      if (h > 23) hours = "23";
      
      // Clamp minutes if complete
      if (mins.length === 2) {
        const m = parseInt(mins, 10);
        if (m > 59) mins = "59";
      }
      
      onChange(`${hours}:${mins}`);
    }
  }, [onChange]);

  const handleBlur = React.useCallback(() => {
    if (!value) return;
    const digits = value.replace(/[^\d]/g, "");
    if (digits.length === 0) { onChange(""); return; }
    
    let h = parseInt(digits.slice(0, 2) || "0", 10);
    let m = parseInt(digits.slice(2, 4) || "0", 10);
    if (h > 23) h = 23;
    if (m > 59) m = 59;
    
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }, [value, onChange]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow: backspace, delete, tab, escape, arrows
    if (["Backspace", "Delete", "Tab", "Escape", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    // Block non-digits
    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
    }
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={5}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
        "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50 font-mono text-center",
        className,
      )}
    />
  );
}
