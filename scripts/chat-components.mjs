import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const lockPath = resolve("chat-components.lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const source = process.env.CHAT_COMPONENTS_SOURCE && resolve(process.env.CHAT_COMPONENTS_SOURCE);
const sync = process.argv[2] === "sync";
if (sync && !source) throw new Error("Set CHAT_COMPONENTS_SOURCE to the chat-components checkout.");
if (sync) {
  const registry = JSON.parse(readFileSync(resolve(source, "registry.json"), "utf8"));
  lock.files = Object.fromEntries([...new Set([...registry.items.flatMap((item) => item.files.map((file) => file.path)), ...readdirSync(resolve(source, "components/ui")).map((file) => `components/ui/${file}`)])].filter((path) => /^(components\/ui\/|lib\/|hooks\/)/.test(path)).map((path) => [path, ""]));
  lock.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
}
const failures = [];
for (const [path, hash] of Object.entries(lock.files)) {
  const local = resolve(path);
  if (sync) {
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, readFileSync(resolve(source, path)));
  }
  const content = readFileSync(local);
  const actual = createHash("sha256").update(content).digest("hex");
  if (sync) lock.files[path] = actual;
  else if (actual !== hash || (source && !content.equals(readFileSync(resolve(source, path))))) failures.push(path);
}
if (sync) writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
if (failures.length) throw new Error(`Vendored source drift: ${failures.join(", ")}`);
console.log(`${Object.keys(lock.files).length} chat-components files verified at ${lock.commit}.`);
