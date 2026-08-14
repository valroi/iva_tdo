// Кладём ассеты pdf.js в public/pdfjs, чтобы просмотрщик мог их загрузить.
//
// Зачем: сканы часто приходят в JPEG 2000 (фильтр JPXDecode). pdf.js декодирует
// такие изображения через WASM-модуль openjpeg — без него страница молча
// отрисовывается пустой (видны только векторные элементы, например подпись).
// Аналогично cmaps нужны для CJK-кодировок, standard_fonts — для базовых
// шрифтов PDF. Скрипт вызывается из predev/prebuild, работает и в Docker.

import { cp, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "node_modules/pdfjs-dist");
const dest = resolve(root, "public/pdfjs");

const parts = ["wasm", "cmaps", "standard_fonts"];

try {
  await access(src);
} catch {
  console.warn("[pdfjs-assets] pdfjs-dist не найден — пропускаю копирование");
  process.exit(0);
}

await mkdir(dest, { recursive: true });
for (const part of parts) {
  try {
    await cp(resolve(src, part), resolve(dest, part), { recursive: true });
    console.log(`[pdfjs-assets] ${part} → public/pdfjs/${part}`);
  } catch (error) {
    console.warn(`[pdfjs-assets] не скопировал ${part}:`, error.message);
  }
}
