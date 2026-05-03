import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SOURCES = [
  {
    from: join(repoRoot, "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2"),
    to: join(repoRoot, "public/fonts/Geist-Variable.woff2"),
  },
  {
    from: join(repoRoot, "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2"),
    to: join(repoRoot, "public/fonts/GeistMono-Variable.woff2"),
  },
];

await mkdir(join(repoRoot, "public/fonts"), { recursive: true });

for (const { from, to } of SOURCES) {
  await copyFile(from, to);
  console.log(`copied ${from.split("/node_modules/")[1] ?? from} → ${to.split("/repo/")[1] ?? to}`);
}
