import {
  type ApiErrorCode,
  type ImportJobSummary,
  type PushSubscriptionRequest,
  type RecipeListItem,
  type ShortcutCredential,
} from "@recipestock/schemas";
import { delay, HttpResponse, http } from "msw";
import {
  MOCK_USER_ID,
  recipeDetailFixture,
  recipeThumbnailUrl,
  type SessionFixture,
  sessionFixture,
} from "./fixtures";
import { imagePlaceholderSvg } from "./images";
import { type MockState } from "./scenarios";

const MOCK_UPLOAD_ORIGIN = "https://mock-r2.invalid";
const IMPORT_JOB_DURATION_MS = 6000;

const apiError = (status: number, code: ApiErrorCode, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

const svgResponse = (seed: string) =>
  HttpResponse.text(imagePlaceholderSvg(seed), {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
  });

const objectKeyFromPath = (url: string, prefix: string) =>
  decodeURIComponent(new URL(url).pathname.slice(prefix.length));

const matchesQuery = (recipe: RecipeListItem, query: string) => {
  const haystack = `${recipe.title} ${recipe.sourceName ?? ""}`.toLowerCase();

  return haystack.includes(query.toLowerCase());
};

/**
 * シナリオが宣言した状態を「動くサーバ」にする。
 * 作成・削除・ログアウトは同じセッションのあいだ反映されるので、実際の操作をそのまま追える。
 */
export const createHandlers = (state: MockState, { delayMs }: { delayMs: number }) => {
  let session: SessionFixture | null = state.session;
  let recipes: RecipeListItem[] = [...state.recipes];
  let jobs: ImportJobSummary[] = [...state.importJobs];
  let pushSubscriptions = { ...state.pushSubscriptions };
  let credentials: ShortcutCredential[] = [...state.shortcutCredentials.credentials];
  const jobCompletions = new Map<string, number>();
  let nextId = 1;

  const requireSession = () =>
    session ? null : apiError(401, "unauthorized", "Sign in is required.");

  // 取り込みジョブは時間で進む。URLを貼ってから完了するまでの流れをそのまま見られるようにする。
  const advanceJobs = () => {
    const now = Date.now();

    jobs = jobs.map((job) => {
      const completesAt = jobCompletions.get(job.id);

      if (job.status !== "running" || completesAt === undefined || completesAt > now) {
        return job;
      }

      jobCompletions.delete(job.id);
      const recipeId = `recipe_mock_${nextId++}`;
      const createdRecipe: RecipeListItem = {
        id: recipeId,
        title: "取り込んだレシピ",
        coverImageUrl: recipeThumbnailUrl(`recipes/${MOCK_USER_ID}/${recipeId}/cover.webp`),
        sourceName: "モック",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        locked: false,
      };

      recipes = [createdRecipe, ...recipes];

      return {
        ...job,
        status: "succeeded",
        recipeId,
        finishedAt: new Date().toISOString(),
      };
    });
  };

  return [
    // 全体遅延。レスポンスを返さないので、後続のハンドラに処理が落ちる。
    // 静的アセットまで遅くしないように、APIだけを対象にする。
    http.all("/api/*", async () => {
      if (delayMs > 0) {
        await delay(delayMs);
      }
    }),

    // --- Better Auth ---
    http.get("/api/auth/get-session", () => {
      if (state.sessionFailure) {
        return HttpResponse.error();
      }

      return HttpResponse.json(session);
    }),
    http.post("/api/auth/sign-in/social", () =>
      HttpResponse.json({ url: "/recipes", redirect: true }),
    ),
    http.post("/api/auth/sign-in/email", () => {
      session = sessionFixture();

      return HttpResponse.json({ redirect: false, token: "mock_token", user: session.user });
    }),
    http.post("/api/auth/sign-up/email", () => HttpResponse.json({ token: null })),
    http.post("/api/auth/sign-out", () => {
      session = null;

      return HttpResponse.json({ success: true });
    }),
    http.post("/api/auth/change-email", () => HttpResponse.json({ status: true })),
    http.post("/api/auth/change-password", () => HttpResponse.json({ status: true })),
    http.post("/api/auth/email-otp/verify-email", () => HttpResponse.json({ status: true })),
    http.post("/api/auth/email-otp/request-password-reset", () =>
      HttpResponse.json({ success: true }),
    ),
    http.post("/api/auth/email-otp/reset-password", () => HttpResponse.json({ status: true })),

    // --- viewer ---
    http.get(
      "/api/me",
      () =>
        requireSession() ??
        HttpResponse.json({
          ...state.viewer,
          recipeCount: recipes.length,
          isRecipeLimitReached:
            state.viewer.recipeLimit !== null && recipes.length >= state.viewer.recipeLimit,
        }),
    ),

    // --- recipes ---
    http.get("/api/recipes", ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const url = new URL(request.url);
      const cursor = url.searchParams.get("cursor");

      if (
        state.failures.listRecipes === "always" ||
        (state.failures.listRecipes === "after-first-page" && cursor)
      ) {
        return apiError(500, "unknown", "Failed to list recipes.");
      }

      const query = url.searchParams.get("q") ?? "";
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const offset = cursor ? Number(cursor) : 0;
      const matched = query ? recipes.filter((recipe) => matchesQuery(recipe, query)) : recipes;
      const items = matched.slice(offset, offset + limit);
      const nextOffset = offset + items.length;

      return HttpResponse.json({
        items,
        nextCursor: nextOffset < matched.length ? String(nextOffset) : null,
      });
    }),
    http.post("/api/recipes", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = `recipe_mock_${nextId++}`;
      const detail = recipeDetailFixture(recipeId);

      recipes = [
        {
          id: recipeId,
          title: detail.title,
          coverImageUrl: recipeThumbnailUrl(`recipes/${MOCK_USER_ID}/${recipeId}/cover.webp`),
          sourceName: detail.source.sourceName ?? null,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
          locked: false,
        },
        ...recipes,
      ];

      return HttpResponse.json({ recipe: detail }, { status: 201 });
    }),
    http.get("/api/recipes/:recipeId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = String(params.recipeId);
      const listed = recipes.find((recipe) => recipe.id === recipeId);

      if (!listed) {
        return apiError(404, "not_found", "Recipe was not found.");
      }

      return HttpResponse.json({
        recipe: listed.locked ? { id: recipeId, locked: true } : recipeDetailFixture(recipeId),
      });
    }),
    http.put("/api/recipes/:recipeId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = String(params.recipeId);

      if (!recipes.some((recipe) => recipe.id === recipeId)) {
        return apiError(404, "not_found", "Recipe was not found.");
      }

      return HttpResponse.json({ recipe: recipeDetailFixture(recipeId) });
    }),
    http.delete("/api/recipes/:recipeId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = String(params.recipeId);
      recipes = recipes.filter((recipe) => recipe.id !== recipeId);

      return HttpResponse.json({ ok: true });
    }),

    // --- billing ---
    http.get("/api/billing/status", () => requireSession() ?? HttpResponse.json(state.billing)),
    http.post("/api/billing/checkout", () =>
      HttpResponse.json({ url: `${window.location.origin}/settings/billing?checkout=success` }),
    ),
    http.post("/api/billing/portal", () =>
      HttpResponse.json({ url: `${window.location.origin}/settings/billing` }),
    ),

    // --- import jobs ---
    http.get("/api/import/jobs/recent", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      advanceJobs();

      return HttpResponse.json({ jobs });
    }),
    http.post("/api/import/url/jobs", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = (await request.json()) as { url?: string };
      const job: ImportJobSummary = {
        id: `job_mock_${nextId++}`,
        kind: "url",
        status: "running",
        url: body.url ?? null,
        recipeId: null,
        errorCode: null,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };

      jobs = [job, ...jobs];
      jobCompletions.set(job.id, Date.now() + IMPORT_JOB_DURATION_MS);

      return HttpResponse.json({ kind: "created", job }, { status: 201 });
    }),
    http.patch("/api/import/jobs/:jobId/dismiss", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const jobId = String(params.jobId);
      const job = jobs.find((candidate) => candidate.id === jobId);

      if (!job) {
        return apiError(404, "not_found", "Import job was not found.");
      }

      jobs = jobs.filter((candidate) => candidate.id !== jobId);

      return HttpResponse.json({ job });
    }),

    // --- push subscriptions ---
    http.get(
      "/api/push-subscriptions",
      () => requireSession() ?? HttpResponse.json(pushSubscriptions),
    ),
    http.post("/api/push-subscriptions", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = (await request.json()) as PushSubscriptionRequest;
      const subscription = { endpoint: body.endpoint, expirationTime: null };

      pushSubscriptions = {
        ...pushSubscriptions,
        subscriptions: [
          ...pushSubscriptions.subscriptions.filter(
            (current) => current.endpoint !== body.endpoint,
          ),
          subscription,
        ],
      };

      return HttpResponse.json({ subscription });
    }),
    http.delete("/api/push-subscriptions", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = (await request.json()) as { endpoint: string };

      pushSubscriptions = {
        ...pushSubscriptions,
        subscriptions: pushSubscriptions.subscriptions.filter(
          (current) => current.endpoint !== body.endpoint,
        ),
      };

      return HttpResponse.json({ revoked: true });
    }),

    // --- iOS Shortcut credentials ---
    http.get(
      "/api/shortcut-credentials",
      () => requireSession() ?? HttpResponse.json({ credentials }),
    ),
    http.post("/api/shortcut-credentials", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = (await request.json()) as { name: string };
      const credential: ShortcutCredential = {
        id: `credential_mock_${nextId++}`,
        name: body.name,
        tokenSuffix: "a1b2c3",
        createdAt: new Date().toISOString(),
      };

      credentials = [credential, ...credentials];

      return HttpResponse.json({
        credential,
        token: "rssc_MockTokenForLocalDev00001",
      });
    }),
    http.delete("/api/shortcut-credentials/:credentialId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const credentialId = String(params.credentialId);
      credentials = credentials.filter((credential) => credential.id !== credentialId);

      return HttpResponse.json({ revoked: true });
    }),

    // --- images ---
    http.post("/api/images/upload-url", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const objectKey = `tmp/${MOCK_USER_ID}/upload_${nextId++}.webp`;

      return HttpResponse.json({
        uploadUrl: `${MOCK_UPLOAD_ORIGIN}/${objectKey}`,
        objectKey,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
    }),
    // upload-urlが返す署名URLへの書き込み。オリジン外なのでワイルドカードで受ける。
    http.put(`${MOCK_UPLOAD_ORIGIN}/*`, () => new HttpResponse(null, { status: 200 })),
    http.get("/api/images/thumbnail/:version/*", ({ request }) => {
      const objectKey = objectKeyFromPath(request.url, "/api/images/thumbnail/v1/");

      if (objectKey.includes("broken")) {
        return apiError(404, "thumbnail_unavailable", "Thumbnail was not found.");
      }

      return svgResponse(objectKey);
    }),
    http.get("/api/images/object/*", ({ request }) => {
      const objectKey = objectKeyFromPath(request.url, "/api/images/object/");

      if (objectKey.includes("broken")) {
        return apiError(404, "not_found", "Image was not found.");
      }

      return svgResponse(objectKey);
    }),
  ];
};
