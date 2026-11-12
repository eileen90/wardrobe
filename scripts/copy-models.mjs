// Copies the on-device background-removal model + runtime into public/models
// so the app hosts everything itself (no third-party CDN, works offline).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@imgly/background-removal-data/dist');
const out = join(root, 'public/models');
const KEEP = [
  '/models/medium',
  '/onnxruntime-web/ort-wasm.wasm',
  '/onnxruntime-web/ort-wasm-simd.wasm',
  '/onnxruntime-web/ort-wasm-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
];

const all = JSON.parse(readFileSync(join(src, 'resources.json'), 'utf8'));
const kept = {};
mkdirSync(out, { recursive: true });
let copied = 0;
for (const key of KEEP) {
  kept[key] = all[key];
  for (const { hash } of all[key].chunks) {
    const to = join(out, hash);
    if (!existsSync(to)) {
      copyFileSync(join(src, hash), to);
      copied++;
    }
  }
}
writeFileSync(join(out, 'resources.json'), JSON.stringify(kept));
console.log(`models: ${copied} new chunk(s) copied to public/models`);
