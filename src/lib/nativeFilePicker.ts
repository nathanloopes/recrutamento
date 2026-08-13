/**
 * Seleção de arquivos — sempre via <input type="file"> nativo do sistema.
 *
 * Tanto no navegador quanto dentro do app nativo (WebView Android/iOS), o
 * próprio seletor do sistema operacional já oferece câmera, galeria e arquivos,
 * com os rótulos no idioma do aparelho. Por isso NÃO exibimos nenhum menu/sheet
 * customizado antes dele — o usuário vê apenas o seletor nativo do celular.
 *
 * NÃO altera nada do fluxo de upload, validação ou storage.
 */

export interface PickFilesOptions {
  accept?: string;
  multiple?: boolean;
}

function pickViaInput(accept?: string, multiple?: boolean): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";

    let settled = false;
    const done = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      try { document.body.removeChild(input); } catch { /* ignore */ }
      window.removeEventListener("focus", onFocus);
      resolve(files);
    };

    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      done(files.length ? files : null);
    };
    const onFocus = () => {
      // Se voltar para a janela sem selecionar arquivo, encerra.
      setTimeout(() => {
        if (!settled && (!input.files || input.files.length === 0)) done(null);
      }, 800);
    };
    window.addEventListener("focus", onFocus);

    // Safety: se em 60s nada acontecer, libera o lock.
    setTimeout(() => done(null), 60000);

    document.body.appendChild(input);
    input.click();
  });
}

export async function pickFiles(opts: PickFilesOptions = {}): Promise<File[] | null> {
  return pickViaInput(opts.accept, opts.multiple);
}
