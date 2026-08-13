// Copia os binários WASM do MediaPipe (tasks-vision) de node_modules para
// public/mediapipe/wasm EM TEMPO DE BUILD. Objetivos:
//  - Self-host do WASM/worker do desfoque de fundo (LiveKit BackgroundBlur),
//    eliminando as origens de CDN (cdn.jsdelivr.net / storage.googleapis.com)
//    do Content-Security-Policy.
//  - Não versionar ~18MB de binários no git (public/mediapipe/wasm é gitignored).
// Chamado pelo script "build" do package.json (roda antes do vite build).
import { cp, mkdir, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dest = resolve(root, "public/mediapipe/wasm");

try {
  await access(src);
} catch {
  console.error(
    `[copy-mediapipe-wasm] Origem nao encontrada: ${src}\n` +
      `Rode "npm ci" para instalar @mediapipe/tasks-vision (dependencia de @livekit/track-processors).`,
  );
  process.exit(1);
}

await mkdir(dest, { recursive: true });
const files = await readdir(src);
let n = 0;
for (const f of files) {
  await cp(resolve(src, f), resolve(dest, f));
  n++;
}
console.log(`[copy-mediapipe-wasm] Copiados ${n} arquivo(s) para public/mediapipe/wasm`);
