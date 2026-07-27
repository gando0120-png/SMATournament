/**
 * 指定 tournament ドキュメントを再帰削除（firebase login 必須）
 *
 * 使い方:
 *   node scripts/admin-delete-tournaments.mjs
 *   node scripts/admin-delete-tournaments.mjs --confirm
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = "smatournament-ce785";

/** @type {Array<{ id: string, name: string, eventDate: string, reason: string }>} */
export const DELETE_TARGETS = [];
// 2026-07-24 実行済み（対象はすべて削除済み）

function run() {
  const confirm = process.argv.includes("--confirm");

  console.log(`Project: ${PROJECT_ID}`);
  console.log("削除対象:");
  for (const t of DELETE_TARGETS) {
    console.log(`  - ${t.id}`);
    console.log(`    名称: ${t.name}`);
    console.log(`    開催日: ${t.eventDate}`);
    console.log(`    理由: ${t.reason}`);
    console.log(`    パス: tournaments/${t.id} （サブコレクション含む再帰削除）`);
  }

  if (!confirm) {
    console.log("\nドライランです。実行するには --confirm を付けて再実行してください。");
    return;
  }

  console.log("\n再帰削除を開始します...\n");

  for (const t of DELETE_TARGETS) {
    const path = `tournaments/${t.id}`;
    console.log(`Deleting ${path} ...`);
    const result = spawnSync(
      "npx.cmd",
      ["firebase-tools", "firestore:delete", path, "-r", "-f", "--project", PROJECT_ID],
      { stdio: "inherit", cwd: resolve(__dirname, ".."), shell: true }
    );
    if (result.status !== 0) {
      console.error(`Failed to delete ${path}`);
      process.exit(result.status ?? 1);
    }
    console.log(`Deleted ${path}\n`);
  }

  console.log("すべての削除が完了しました。");
}

run();
