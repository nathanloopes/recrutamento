import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type FormatType = "date" | "datetime" | "time";

interface MaskedDateInputProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  format?: "dd/MM/yyyy" | "dd/MM/yyyy HH:mm" | "HH:mm";
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  size?: "sm" | "md";
  disabled?: boolean;
}

interface Segment {
  start: number;
  length: number;
  max: number;
  min: number;
  digits: number;
}

function getFormatType(fmt: string): FormatType {
  if (fmt === "HH:mm") return "time";
  if (fmt.includes("HH:mm")) return "datetime";
  return "date";
}

function getMask(fmt: string): string {
  switch (fmt) {
    case "HH:mm": return "__:__";
    case "dd/MM/yyyy HH:mm": return "__/__/____ __:__";
    default: return "__/__ /____";
  }
}

function getSegments(fmt: string): Segment[] {
  switch (fmt) {
    case "HH:mm":
      return [
        { start: 0, length: 2, max: 23, min: 0, digits: 2 },
        { start: 3, length: 2, max: 59, min: 0, digits: 2 },
      ];
    case "dd/MM/yyyy HH:mm":
      return [
        { start: 0, length: 2, max: 31, min: 1, digits: 2 },
        { start: 3, length: 2, max: 12, min: 1, digits: 2 },
        { start: 6, length: 4, max: 2099, min: 1900, digits: 4 },
        { start: 11, length: 2, max: 23, min: 0, digits: 2 },
        { start: 14, length: 2, max: 59, min: 0, digits: 2 },
      ];
    default: // dd/MM/yyyy
      return [
        { start: 0, length: 2, max: 31, min: 1, digits: 2 },
        { start: 3, length: 2, max: 12, min: 1, digits: 2 },
        { start: 6, length: 4, max: 2099, min: 1900, digits: 4 },
      ];
  }
}

function getTemplate(fmt: string): string {
  switch (fmt) {
    case "HH:mm": return "  :  ";
    case "dd/MM/yyyy HH:mm": return "  /  /       :  ";
    default: return "  /  /    ";
  }
}

function dateToDisplay(d: Date | null, fmt: string): string {
  if (!d || !isValid(d)) return "";
  try {
    return format(d, fmt, { locale: ptBR });
  } catch {
    return "";
  }
}

function parseDisplay(text: string, fmt: string): Date | null {
  if (!text || text.includes("_")) return null;
  try {
    const d = parse(text, fmt, new Date(), { locale: ptBR });
    return isValid(d) ? d : null;
  } catch {
    return null;
  }
}

function findSegmentIndex(pos: number, segments: Segment[]): number {
  for (let i = 0; i < segments.length; i++) {
    if (pos >= segments[i].start && pos < segments[i].start + segments[i].length) {
      return i;
    }
  }
  // Find closest
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const mid = segments[i].start + segments[i].length / 2;
    const dist = Math.abs(pos - mid);
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }
  return closest;
}

export function MaskedDateInput({
  value,
  onChange,
  format: fmt = "dd/MM/yyyy",
  placeholder,
  className,
  style,
  size,
  disabled,
}: MaskedDateInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const segments = React.useMemo(() => getSegments(fmt), [fmt]);
  const formatType = React.useMemo(() => getFormatType(fmt), [fmt]);
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const [text, setText] = React.useState(() => dateToDisplay(value, fmt));
  const [activeSegment, setActiveSegment] = React.useState(0);

  // Sync external value changes
  React.useEffect(() => {
    const display = dateToDisplay(value, fmt);
    setText(display);
  }, [value, fmt]);

  const selectSegment = React.useCallback((idx: number) => {
    const seg = segments[idx];
    if (!seg || !inputRef.current) return;
    setActiveSegment(idx);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(seg.start, seg.start + seg.length);
    });
  }, [segments]);

  const handleClick = React.useCallback(() => {
    if (!inputRef.current) return;
    const pos = inputRef.current.selectionStart ?? 0;
    const idx = findSegmentIndex(pos, segments);
    selectSegment(idx);
  }, [segments, selectSegment]);

  const handleFocus = React.useCallback(() => {
    if (!text) {
      // Initialize with template
      const template = fmt === "HH:mm" ? "__:__" :
        fmt === "dd/MM/yyyy HH:mm" ? "__/__/____ __:__" : "__/__/____";
      setText(template);
      requestAnimationFrame(() => selectSegment(0));
    } else {
      requestAnimationFrame(() => {
        const pos = inputRef.current?.selectionStart ?? 0;
        const idx = findSegmentIndex(pos, segments);
        selectSegment(idx);
      });
    }
  }, [text, fmt, segments, selectSegment]);

  // Processamento de UM dígito — usado tanto por teclado físico (onKeyDown)
  // quanto por teclado virtual (onBeforeInput). Usa refs/state atuais do closure.
  const processDigit = React.useCallback((digit: string) => {
    const seg = segments[activeSegment];
    if (!seg) return;
    const currentText = text || getTemplate(fmt);
    const segText = currentText.slice(seg.start, seg.start + seg.length);
    const underscoreIdx = segText.indexOf("_");

    if (underscoreIdx === -1) {
      // Segmento cheio → reinicia com o novo dígito
      const newSegText = digit + "_".repeat(seg.length - 1);
      const newText = currentText.slice(0, seg.start) + newSegText + currentText.slice(seg.start + seg.length);
      setText(newText);
      selectSegment(activeSegment);
      return;
    }

    const newSegArr = segText.split("");
    newSegArr[underscoreIdx] = digit;
    const newSegText = newSegArr.join("");
    const newText = currentText.slice(0, seg.start) + newSegText + currentText.slice(seg.start + seg.length);
    const isComplete = !newSegText.includes("_");

    if (isComplete) {
      let num = parseInt(newSegText, 10);
      if (num > seg.max) num = seg.max;
      if (num < seg.min && newSegText.length === seg.length) num = seg.min;
      const validatedText = currentText.slice(0, seg.start) +
        String(num).padStart(seg.length, "0") +
        currentText.slice(seg.start + seg.length);
      setText(validatedText);

      if (activeSegment < segments.length - 1) {
        requestAnimationFrame(() => selectSegment(activeSegment + 1));
      } else {
        const parsed = parseDisplay(validatedText, fmt);
        if (parsed) onChange(parsed);
        requestAnimationFrame(() => selectSegment(activeSegment));
      }
      const parsed = parseDisplay(validatedText, fmt);
      if (parsed) onChange(parsed);
    } else {
      setText(newText);
      selectSegment(activeSegment);
    }
  }, [activeSegment, segments, text, fmt, onChange, selectSegment]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = inputRef.current;
    if (!input) return;

    if (e.key === "Tab") return; // Allow normal tab behavior
    if (e.key === "Escape") {
      input.blur();
      return;
    }

    e.preventDefault();

    const seg = segments[activeSegment];
    if (!seg) return;

    const currentText = text || "";

    if (e.key === "ArrowLeft") {
      if (activeSegment > 0) selectSegment(activeSegment - 1);
      return;
    }
    if (e.key === "ArrowRight") {
      if (activeSegment < segments.length - 1) selectSegment(activeSegment + 1);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const segText = currentText.slice(seg.start, seg.start + seg.length);
      let num = parseInt(segText, 10);
      if (isNaN(num)) num = seg.min;
      num += e.key === "ArrowUp" ? 1 : -1;
      if (num > seg.max) num = seg.min;
      if (num < seg.min) num = seg.max;
      const padded = String(num).padStart(seg.length, "0");
      const newText = currentText.slice(0, seg.start) + padded + currentText.slice(seg.start + seg.length);
      setText(newText);
      const parsed = parseDisplay(newText, fmt);
      if (parsed) onChange(parsed);
      requestAnimationFrame(() => selectSegment(activeSegment));
      return;
    }
    if (e.key === "Backspace") {
      // Clear current segment
      const blank = "_".repeat(seg.length);
      const newText = currentText.slice(0, seg.start) + blank + currentText.slice(seg.start + seg.length);
      setText(newText);
      if (activeSegment > 0) {
        selectSegment(activeSegment - 1);
      } else {
        selectSegment(0);
      }
      // Check if all empty
      if (newText.replace(/[^_]/g, "").length === segments.reduce((a, s) => a + s.length, 0)) {
        onChange(null);
      }
      return;
    }
    if (e.key === "Delete") {
      const blank = "_".repeat(seg.length);
      const newText = currentText.slice(0, seg.start) + blank + currentText.slice(seg.start + seg.length);
      setText(newText);
      selectSegment(activeSegment);
      if (newText.replace(/[^_]/g, "").length === segments.reduce((a, s) => a + s.length, 0)) {
        onChange(null);
      }
      return;
    }

    // Digit input
    if (/^\d$/.test(e.key)) {
      processDigit(e.key);
    }
  }, [activeSegment, segments, text, fmt, onChange, selectSegment, processDigit]);

  // Handler para teclados virtuais (mobile): onKeyDown não dispara e.key em
  // muitos IMEs/teclados Android/iOS. onBeforeInput é universal.
  const handleBeforeInput = React.useCallback((e: React.FormEvent<HTMLInputElement> & { data?: string; nativeEvent?: InputEvent }) => {
    const data = e.nativeEvent?.data ?? "";
    // Deixa keyDown lidar se for teclado físico (e.data é "" ou undefined nesse caso às vezes).
    if (!data) return;
    e.preventDefault();
    // Processa cada dígito sequencialmente
    for (const ch of data) {
      if (/^\d$/.test(ch)) processDigit(ch);
    }
  }, [processDigit]);

  const handleCalendarSelect = React.useCallback((d: Date | undefined) => {
    if (d) {
      // Preserve time from current value if datetime format
      if (formatType === "datetime" && value) {
        d.setHours(value.getHours(), value.getMinutes());
      }
      onChange(d);
      setPopoverOpen(false);
    }
  }, [onChange, formatType, value]);

  const showCalendar = formatType !== "time";
  const heightClass = size === "sm" ? "h-8 text-xs" : "h-10 text-sm";

  return (
    <div className={cn("flex gap-1", className)} style={style}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={text}
        onChange={() => { /* controlled via key/beforeinput handlers */ }}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput as unknown as React.FormEventHandler<HTMLInputElement>}
        placeholder={placeholder || fmt.toLowerCase()}
        disabled={disabled}
        className={cn(
          "flex w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50 font-mono",
          heightClass,
          showCalendar ? "rounded-r-none" : "rounded-md"
        )}
      />
      {showCalendar && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              disabled={disabled}
              className={cn("rounded-l-none border-l-0 shrink-0", size === "sm" ? "h-8 w-8" : "h-10 w-10")}
              type="button"
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value ?? undefined}
              onSelect={handleCalendarSelect}
              initialFocus
              className="p-3 pointer-events-auto"
              locale={ptBR}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
