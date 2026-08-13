/**
 * Drop-in replacement para <input type="file" className="hidden" ref={...} />.
 *
 * Mantém a mesma API de eventos (onChange recebe um objeto com
 * `target.files`) para minimizar mudanças nos componentes existentes.
 *
 * Quando o usuário chama `ref.current?.click()` (compat com código antigo)
 * ou `ref.current?.open()`, dispara o seletor nativo do sistema — tanto na
 * web quanto no app nativo (WebView), sem nenhum menu customizado à parte.
 */
import { forwardRef, useImperativeHandle, useRef } from "react";
import { pickFiles } from "@/lib/nativeFilePicker";

export interface NativeFileInputHandle {
  open: () => void;
  click: () => void; // alias para compat com inputRef.current?.click()
}

interface SyntheticChangeEvent {
  target: { files: FileList | null; value: string };
  currentTarget: { files: FileList | null; value: string };
}

interface NativeFileInputProps {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onChange: (e: SyntheticChangeEvent) => void;
}

function filesToFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  return dt.files;
}

export const NativeFileInput = forwardRef<NativeFileInputHandle, NativeFileInputProps>(
  ({ accept, multiple, disabled, onChange }, ref) => {
    const busyRef = useRef(false);

    const open = async () => {
      if (disabled || busyRef.current) return;
      busyRef.current = true;
      // Safety net: se pickFiles travar por qualquer motivo, libera o lock em 90s.
      const safety = setTimeout(() => { busyRef.current = false; }, 90000);
      try {
        const files = await pickFiles({ accept, multiple });
        if (!files || files.length === 0) return;
        const fileList = filesToFileList(files);
        const evt: SyntheticChangeEvent = {
          target: { files: fileList, value: "" },
          currentTarget: { files: fileList, value: "" },
        };
        onChange(evt);
      } catch (err) {
        console.error("[NativeFileInput] pickFiles error", err);
      } finally {
        clearTimeout(safety);
        busyRef.current = false;
      }
    };

    useImperativeHandle(ref, () => ({ open, click: open }), [disabled, accept, multiple]);

    // Nenhum DOM renderizado — o trigger é o botão do componente pai.
    return null;
  }
);

NativeFileInput.displayName = "NativeFileInput";
