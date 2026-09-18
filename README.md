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
`VITE_IOS_SHARE_SHORTCUT_URL` には、設定画面から追加する公開済みの iOS Shortcut URL
を設定してください。この値は Web アプリのビルド時にブラウザ向けコードへ埋め込まれます。
Shortcut のアクション列と API 契約は `docs/shortcut/ios-share.md` にあります。

Cloudflare にログインし、開発用 R2 bucket を作成します。

```bash
pnpm --filter @recipestock/api exec wrangler login
pnpm --filter @recipestock/api exec wrangler r2 bucket create recipestock-images-dev
pnpm --filter @recipestock/api exec wrangler r2 bucket cors set recipestock-images-dev --file apps/api/cors.example.json
pnpm --filter @recipestock/api exec wrangler r2 bucket lifecycle add recipestock-images-dev expire-tmp-uploads tmp/ --expire-days 1
```

ライフサイクルルールは、保存されないまま残る一時アップロード(`tmp/`)を消します(ADR 0024)。
本番など別の bucket を作るときも同じ設定を適用してください。

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

### モックモード

画面の状態(レシピなし、フリープランのロック、取り込み失敗、接続不可など)を目視で確認するときは、
API を MSW に差し替えて起動します。wrangler も Neon も R2 も不要です。

```bash
pnpm dev:mock
```

シナリオは画面左下のセレクタか、`?scenario=<id>` で切り替えます。
一度指定すると sessionStorage に残るので、画面遷移しても維持されます。
`?delay=2000` を付けると全 API レスポンスが遅くなり、スケルトンを観察できます。

| id | 内容 |
| --- | --- |
| `default` | Pro・26件(2ページ目あり)・タグあり |
| `empty` | レシピなし |
| `no-tags` | タグを持たない(チップ列なし・詳細で定番候補) |
| `free-locked` | Freeで末尾がロック |
| `limit-reached` | Freeで保存上限ちょうど |
| `import-limit` | Freeで今月のAI取り込みが上限 |
| `checkout-pending` | 決済から戻った直後(`/settings/billing?checkout=success` を開くと、数秒でProに変わる) |
| `pro-canceling` | Proで解約予約中 |
| `pro-past-due` | Proで支払いを確認できない |
| `list-error` | 一覧の取得失敗 |
| `next-page-error` | 2ページ目の取得失敗 |
| `importing` | 取り込み中 |
| `import-failed` | 取り込み失敗 |
| `text-import-failed` | テキストの取り込み失敗(原文を直して再試行) |
| `no-cover` | カバー画像なし |
| `image-only` | 画像だけの投稿(詳細が材料・手順なしで画像だけ。表紙はレシピ画像の1枚目と同じ。2件目は1枚だけ) |
| `broken-image` | 画像の読み込み失敗(一覧のサムネイルと、2・5・8件目の詳細の画像) |
| `signed-out` | 未ログイン |
| `offline` | 接続不可 |

検索ヒットなしの表示は、`default` で一致しない語を検索すると出ます。
取り込みは URL やテキストを送信してから数秒で成功に変わるので、島の一連の流れをそのまま追えます。
レシピの作成・編集・削除も、リロードするまでは入力した内容で詳細と一覧に反映されます。
Freeで保存上限に達しているシナリオ(`limit-reached` / `free-locked`)では、作成と URL・テキストの取り込みが本番と同じく `recipe_limit_exceeded` で失敗します。
Freeのシナリオでプランのページから「Proにする」を押すと、決済から戻った画面になりますが、Proには変わらず待ちきれなかったときの表示になります。
`signed-out` でメールアドレスによるログインや新規登録(OTP 検証)をすると、そのままログイン状態になります。
Google ログインはリロードを伴うので、戻り先で `default` シナリオに切り替わります。

ハンドラのない API は実 API に流さず、`501` を返してコンソールにエラーを出します。
API を追加したら `apps/web/src/mocks/handlers.ts` にハンドラを足してください。

設定画面の通知の有効化は、モックモードでは試せません(失敗の表示になります)。
Service Worker の scope `/` を MSW が使っているためです。

シナリオとフィクスチャは `apps/web/src/mocks/` にあります。
フィクスチャは `@recipestock/schemas` の型で縛ってあり、`src/mocks/scenarios.test.ts` が
Zod スキーマとの整合を検証するので、API 契約が変わればテストが落ちます。

`http://<LAN-IP>:5173` のように localhost 以外を http で開くと Service Worker が使えません。
この場合 MSW はページ内の `fetch` だけを差し替えるフォールバックで動くので、API のモックは効きますが、
`<img>` で読む画像は差し替わらず、すべて読み込み失敗の表示になります。
スマートフォンで画像まで確認するときは、trycloudflare などの HTTPS トンネル越しに開いてください。

## Commands

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | Turborepo 経由で開発サーバーを起動 |
| `pnpm dev:mock` | API を MSW に差し替えた Web のみの開発サーバーを起動 |
| `pnpm build` | 全 package/app を build |
| `pnpm typecheck` | TypeScript の型チェック |
| `pnpm lint` | Biome による lint / format check |
| `pnpm format` | Biome による format |
| `pnpm test` | Vitest を実行 |
| `pnpm test:db` | Neon ephemeral branchでDatabase統合テストを実行 |
| `pnpm test:all` | 通常テストとDatabase統合テストを実行 |
| `pnpm db:generate` | Drizzle migration を生成 |
| `pnpm db:migrate` | Drizzle migration を適用 |
| `pnpm deploy` | Web build 後に Cloudflare Worker へ deploy |

### Continuous integration

GitHub Actionsの`CI` workflowは、PRの作成・更新・再オープン、`main`へのpush、手動実行で起動する。forkからのPRも同じチェックの対象とする。

`checks` jobはUbuntu 24.04、Node.js 22系、`package.json`に指定したpnpmで次を順に実行する。

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

ビルドではPWA生成物も検証する。APIテストが参照するWebの静的アセットを生成するため、ビルドをテストより先に実行する。通常テストのCloudflare bindingsはローカルで実行し、CIにSecretsやローカル環境ファイルは不要。同じPR・ブランチへの更新では古い実行をキャンセルする。

### Database integration tests

`pnpm test:db`はDockerでNeon Localを起動し、テスト専用Neon projectにephemeral branchを作成する。全migrationとDatabase統合テストを実行した後、成功・失敗にかかわらずbranchを削除する。通常の開発用または本番用`DATABASE_URL`は使用しない。

事前にDockerを起動し、次の環境変数を設定する。ローカルではgit管理外の`.env.test.local`から自動的に読み込む。

- `NEON_API_KEY`: テスト専用projectでbranchを作成・削除できるAPI key
- `NEON_PROJECT_ID`: 実データを含まないテスト専用Neon project
- `NEON_PARENT_BRANCH_ID`: 空の親branch
- `NEON_LOCAL_PORT`: Neon Localの公開port。省略時は`55432`

```bash
cp .env.example .env.test.local
# .env.test.localへテスト専用projectの値を設定
pnpm test:db
```

日常の高速テストには`pnpm test`を使用し、Databaseまたはrepositoryを変更した場合は、CIに加えて必要に応じてローカルでも`pnpm test:all`を実行する。

Cloudflare Worker の deploy 前検証:

```bash
pnpm --filter @recipestock/web build
pnpm --filter @recipestock/api exec wrangler deploy --dry-run
```

## Environment Variables

ローカルでは `apps/api/.dev.vars`、本番では Cloudflare secrets / vars に設定します。

主な値:

- `DATABASE_URL`
- `VITE_IOS_SHARE_SHORTCUT_URL`（Web ビルド時に公開される iOS Shortcut URL）
- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `CLOUDFLARE_ACCOUNT_ID`
- `AI_GATEWAY_NAME`
- `AI_TEXT_MODEL`
- `AI_VISION_MODEL`
- `IMPORT_TIMEOUT_MS`
- `IMPORT_JOB_TIMEOUT_MS`

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
