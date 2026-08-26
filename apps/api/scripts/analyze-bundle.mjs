/**
 * API Worker bundleの構成を計測する。
 *
 * `wrangler deploy --dry-run --metafile` が出力するesbuild metafileを読み、
 * bundleへの寄与をpackage単位で集計する。`--scenario` を付けると、指定した依存を
 * entry pointから到達不能にした場合の削減量も出す。
 *
 * minifyなどのbuild設定はapps/api/wrangler.jsoncに従う。
 *
 * 使い方:
 *   pnpm --filter @recipestock/api analyze:bundle
 *   pnpm --filter @recipestock/api analyze:bundle -- --scenario
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const apiDir = fileURLToPath(new URL("..", import.meta.url));

const withScenario = process.argv.slice(2).includes("--scenario");

const TOP_ROWS = 30;

// 「この依存を消したらいくら減るか」を見るための候補。bundle全体の1%以上を占める
// package群を、削減判断の単位でまとめてある。
const SCENARIOS = [
  ["resend (svix / postal-mimeを含む)", /node_modules\/resend\//],
  ["better-auth kysely migration path", /node_modules\/(kysely|@better-auth\/kysely-adapter)\//],
  ["better-auth OpenTelemetry instrumentation", /node_modules\/@opentelemetry\//],
  ["stripe SDK", /node_modules\/stripe\//],
  [
    "web-push (asn1.js / bn.js / http_eceを含む)",
    /node_modules\/(web-push|asn1\.js|bn\.js|http_ece)\//,
  ],
  ["zod v4 locales (en以外)", /node_modules\/zod\/v4\/locales\/(?!en\.js|index\.js)/],
  ["zod v3互換", /node_modules\/zod\/v3\//],
  [
    "AI SDK一式 (ai / @ai-sdk / workers-ai-provider / @openrouter)",
    /node_modules\/(ai|@ai-sdk\/[^/]+|workers-ai-provider|@openrouter\/ai-sdk-provider)\//,
  ],
];

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const buildMetafile = async (outDir) => {
  const { stdout } = await execFileAsync(
    "npx",
    ["wrangler", "deploy", "--dry-run", `--outdir=${outDir}`, "--metafile"],
    { cwd: apiDir },
  );
  const totals = stdout.match(/Total Upload:\s*(.+)$/m)?.[1]?.trim();
  const metafile = JSON.parse(await readFile(join(outDir, "bundle-meta.json"), "utf8"));
  return { metafile, totals };
};

/** bundleの構成要素をpackage単位で集計する。 */
const groupByPackage = (output) => {
  const groups = new Map();

  for (const [path, info] of Object.entries(output.inputs)) {
    const bytes = info.bytesInOutput ?? 0;
    const nested = path.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/g);
    const key = nested
      ? nested.at(-1).replace("node_modules/", "")
      : path.startsWith("src/")
        ? "(apps/api own code)"
        : path;
    groups.set(key, (groups.get(key) ?? 0) + bytes);
  }

  return [...groups.entries()].sort((a, b) => b[1] - a[1]);
};

/** entry pointから到達できるinputの合計bytesを返す。blockedに一致するinputは辿らない。 */
const reachableBytes = (metafile, output, blocked) => {
  const sizes = new Map(Object.entries(output.inputs).map(([p, i]) => [p, i.bytesInOutput ?? 0]));
  const seen = new Set();
  const stack = [output.entryPoint];

  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file) || blocked(file)) continue;
    seen.add(file);

    for (const dependency of metafile.inputs[file]?.imports ?? []) {
      if (dependency.external || !dependency.path) continue;
      if (!metafile.inputs[dependency.path]) continue;
      stack.push(dependency.path);
    }
  }

  let total = 0;
  for (const file of seen) total += sizes.get(file) ?? 0;
  return total;
};

const outDir = await mkdtemp(join(tmpdir(), "worker-bundle-"));

try {
  const { metafile, totals } = await buildMetafile(outDir);
  const output = Object.values(metafile.outputs).find((o) => o.entryPoint);

  console.log(`Total Upload: ${totals}`);
  console.log(`modules: ${Object.keys(output.inputs).length}`);

  const groups = groupByPackage(output);
  const attributed = groups.reduce((sum, [, bytes]) => sum + bytes, 0);

  console.log(`\n## package別の寄与 (上位${TOP_ROWS}件 / 合計 ${kib(attributed)})`);
  for (const [name, bytes] of groups.slice(0, TOP_ROWS)) {
    const share = `${((100 * bytes) / attributed).toFixed(1)}%`;
    console.log(`${kib(bytes).padStart(11)}  ${share.padStart(6)}  ${name}`);
  }

  if (withScenario) {
    const base = reachableBytes(metafile, output, () => false);
    console.log(`\n## 到達不能にした場合の削減量 (baseline ${kib(base)})`);
    for (const [name, pattern] of SCENARIOS) {
      const saved = base - reachableBytes(metafile, output, (file) => pattern.test(file));
      console.log(`${kib(saved).padStart(11)}  ${name}`);
    }
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}
