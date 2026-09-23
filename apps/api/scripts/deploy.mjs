// 本番へのdeploy。webとWorkerを同じrelease（git SHA）で出し、両方のsource mapをSentryへ上げる。
// webもWorkerもminifyしているので、source mapが無いとSentryのstack traceが読めない。
//
// 必要な環境変数（`../../.env`から読む）:
// - SENTRY_AUTH_TOKEN: source mapの upload とreleaseの作成に使う
// - VITE_SENTRY_DSN: webのbundleに埋め込む。無ければブラウザのエラーが送られない
//
// WorkerのDSNは`SENTRY_DSN`のsecretとしてCloudflareに置き、deployの前に有無を確かめる。
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SENTRY_ORG = "tkhs";
const SENTRY_API_PROJECT = "recipestock-api";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const read = (command, args, options) =>
  execFileSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options }).trim();

const run = (command, args, options) =>
  execFileSync(command, args, { stdio: "inherit", ...options });

// releaseをcommitに結び付けるので、commitしていない変更を含むbuildは出さない。
if (read("git", ["status", "--porcelain"]) !== "") {
  fail("Commit or stash local changes before deploying. The Sentry release is the commit SHA.");
}

// source mapの無い本番や、エラーを送らないwebを出さない。
for (const name of ["SENTRY_AUTH_TOKEN", "VITE_SENTRY_DSN"]) {
  if (!process.env[name]) {
    fail(`${name} must be set in the repository root .env before deploying.`);
  }
}

// secretが無くてもWorkerは動き、APIのエラーだけが黙ってSentryへ届かなくなる。
const workerSecrets = JSON.parse(
  read("pnpm", ["exec", "wrangler", "secret", "list"], { cwd: apiDir }),
);
if (!workerSecrets.some(({ name }) => name === "SENTRY_DSN")) {
  fail(
    "SENTRY_DSN must be set as a Worker secret before deploying. Run `wrangler secret put SENTRY_DSN`.",
  );
}

const release = read("git", ["rev-parse", "HEAD"]);
const env = { ...process.env, SENTRY_RELEASE: release };
const sentry = (args) =>
  run(
    "pnpm",
    ["exec", "sentry-cli", ...args, "--org", SENTRY_ORG, "--project", SENTRY_API_PROJECT],
    {
      cwd: apiDir,
      env,
    },
  );

// webのsource mapは`@sentry/vite-plugin`が上げ、`dist`から消す。
run("pnpm", ["--filter", "@recipestock/web", "build"], { cwd: repoRoot, env });

// `--outdir`に残したbundleとsource mapを、deployのあとSentryへ上げる。
run(
  "pnpm",
  ["exec", "wrangler", "deploy", "--outdir", "dist", "--var", `SENTRY_RELEASE:${release}`],
  { cwd: apiDir, env },
);
sentry(["releases", "new", release, "--finalize"]);
sentry(["sourcemaps", "upload", "--release", release, "--strip-prefix", "dist/..", "dist"]);

console.info(`Deployed release ${release}.`);
