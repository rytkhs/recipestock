# Recipe Stock

Recipe Stock は、レシピサイト、YouTube、SNS投稿、書籍、画像、スクリーンショットなどからレシピを取り込み、統一された形式で保存・検索・閲覧するための PWA です。

## Architecture

フロントエンドの静的アセットと API は、同一の Cloudflare Worker から配信します。

```txt
Browser / PWA
  -> Cloudflare Worker
       -> static Vite React SPA
       -> /api/* Hono API
            -> Neon PostgreSQL
            -> Cloudflare R2
            -> Better Auth
            -> Resend
            -> Stripe
            -> Vercel AI SDK + Cloudflare AI Gateway
```

- `/api/*`: Hono API
- それ以外: Vite React SPA の static assets / SPA fallback

## Tech Stack

| 領域 | 技術 |
| --- | --- |
| Frontend | Vite + React + TypeScript |
| Routing | TanStack Router |
| Server state | TanStack Query |
| Forms / validation | React Hook Form + Zod |
| API | Hono + Hono RPC client |
| Database | Neon PostgreSQL + Drizzle ORM |
| Storage / deploy | Cloudflare Workers + Cloudflare R2 |
| Auth | Better Auth |
| Email | Resend |
| Billing | Stripe |
| AI | Vercel AI SDK + Cloudflare AI Gateway |
| Monorepo | pnpm workspace + Turborepo |
| Lint / format | Biome |
| Tests | Vitest + Testing Library |

## Repository Structure

```txt
apps/
  web/      Vite React SPA
  api/      Hono API on Cloudflare Workers

packages/
  db/       Drizzle schema, migrations, Neon client
  schemas/  Zod schemas and API-facing types
  shared/   deterministic logic shared by API and web
  config/   shared TypeScript and tool configuration
```

## Prerequisites

- Node.js 22 系
- pnpm via Corepack
- Cloudflare account and Wrangler access
- Neon project / database
- 必要に応じて Resend, Stripe, Cloudflare AI Gateway のアカウント・キー

```bash
corepack enable
```

## Setup

依存関係をインストールします。

```bash
pnpm install
```

ローカル用の環境変数ファイルを作成します。

```bash
cp .env.example .env
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

`DATABASE_URL` には Neon の接続文字列を設定してください。

Cloudflare にログインし、開発用 R2 bucket を作成します。

```bash
pnpm --filter @recipestock/api exec wrangler login
pnpm --filter @recipestock/api exec wrangler r2 bucket create recipestock-images-dev
pnpm --filter @recipestock/api exec wrangler r2 bucket cors set recipestock-images-dev --file apps/api/cors.example.json
```

API 固有のセットアップ詳細は `apps/api/README.md` を参照してください。

## Development

API と Web をまとめて起動します。

```bash
pnpm dev
```

個別に起動する場合:

```bash
pnpm --filter @recipestock/api dev
pnpm --filter @recipestock/web dev
```

デフォルトの URL:

- Web: http://localhost:5173/
- API: http://localhost:8787/

## Commands

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | Turborepo 経由で開発サーバーを起動 |
| `pnpm build` | 全 package/app を build |
| `pnpm typecheck` | TypeScript の型チェック |
| `pnpm lint` | Biome による lint / format check |
| `pnpm format` | Biome による format |
| `pnpm test` | Vitest を実行 |
| `pnpm db:generate` | Drizzle migration を生成 |
| `pnpm db:migrate` | Drizzle migration を適用 |
| `pnpm deploy` | Web build 後に Cloudflare Worker へ deploy |

Cloudflare Worker の deploy 前検証:

```bash
pnpm --filter @recipestock/web build
pnpm --filter @recipestock/api exec wrangler deploy --dry-run
```

## Environment Variables

ローカルでは `apps/api/.dev.vars`、本番では Cloudflare secrets / vars に設定します。

主な値:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `CLOUDFLARE_ACCOUNT_ID`
- `CF_AIG_TOKEN`
- `AI_GATEWAY_NAME`
- `AI_TEXT_MODEL`
- `AI_VISION_MODEL`
- `IMPORT_TIMEOUT_MS`

## Verification

開発基盤の変更後は、少なくとも以下を実行します。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Worker 設定と static assets の確認には `wrangler deploy --dry-run` を使います。

```bash
pnpm --filter @recipestock/api exec wrangler deploy --dry-run
```
