import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const requiredEnvironmentVariables = ["NEON_API_KEY", "NEON_PROJECT_ID", "NEON_PARENT_BRANCH_ID"];

const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name],
);

if (missingEnvironmentVariables.length > 0) {
  console.error(
    `Missing environment variables for database tests: ${missingEnvironmentVariables.join(", ")}`,
  );
  process.exit(1);
}

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const port = process.env.NEON_LOCAL_PORT ?? "55432";
const databaseUrl = `postgresql://neon:npg@localhost:${port}/neondb?sslmode=require`;
const compose = ["compose", "-f", "compose.db-test.yml", "-p", "recipestock-db-test"];

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, NEON_LOCAL_PORT: port, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
};

const applyMigrations = () => {
  const migrationsDirectory = resolve(repoRoot, "packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((fileName) => /^\d+.*\.sql$/.test(fileName))
    .sort();

  const migrationSql = migrationFiles
    .map(
      (migrationFile) =>
        `\\echo Applying migration ${migrationFile}\n${readFileSync(
          resolve(migrationsDirectory, migrationFile),
          "utf8",
        )}\n`,
    )
    .join("\n");
  const result = spawnSync(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "db",
      "psql",
      "postgresql://neon:npg@localhost:5432/neondb?sslmode=require",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, NEON_LOCAL_PORT: port },
      input: migrationSql,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Database migrations failed with status ${result.status}`);
  }
};

const waitForDatabase = () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync(
      "docker",
      [...compose, "exec", "-T", "db", "pg_isready", "-h", "localhost", "-p", "5432"],
      {
        cwd: repoRoot,
        env: { ...process.env, NEON_LOCAL_PORT: port },
        stdio: "ignore",
      },
    );
    if (result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error("Neon Local did not become ready.");
};

let exitCode = 0;

try {
  run("docker", [...compose, "up", "-d"]);
  waitForDatabase();
  applyMigrations();
  run("pnpm", [
    "--filter",
    "@recipestock/api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.db.config.ts",
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  try {
    run("docker", [...compose, "down", "--volumes"]);
  } catch (cleanupError) {
    console.error(cleanupError instanceof Error ? cleanupError.message : cleanupError);
    exitCode = 1;
  }
}

process.exit(exitCode);
