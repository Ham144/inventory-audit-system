import { spawnSync } from "node:child_process";

const [major, minor] = process.versions.node.split(".").map(Number);
const supported =
  (major === 20 && minor >= 19) ||
  (major === 22 && minor >= 12) ||
  major >= 24;

if (!supported) {
  process.stderr.write(
    `Prisma generate skipped: Node ${process.versions.node} is unsupported. Use Node 20.19+, 22.12+, or 24+ then run: pnpm exec prisma generate\n`,
  );
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "prisma", "generate"], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
