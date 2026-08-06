/**
 * functions デプロイ用に js/domain を vendor へ同期する
 */
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const source = join(root, "js/domain");
const target = join(root, "functions/vendor/domain");

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Synced ${source} -> ${target}`);
