import {
  type ApiErrorCode,
  type CreateRecipeRequest,
  createRecipeRequestSchema,
  type ImportJobSummary,
  importTextRequestSchema,
  importUrlRequestSchema,
  MAX_TAG_NAME_LENGTH,
  mergeTagRequestSchema,
  type PushSubscriptionRequest,
  type RecipeDetail,
  type RecipeListItem,
  renameTagRequestSchema,
  reorderTagsRequestSchema,
  replaceRecipeTagsRequestSchema,
  type ShortcutCredential,
  updateRecipeRequestSchema,
} from "@recipestock/schemas";
import { countTagNameLength, normalizeTagName } from "@recipestock/shared";
import { delay, HttpResponse, http } from "msw";
import {
  MOCK_USER_ID,
  type MockTag,
  proBillingStatusFixture,
  recipeDetailFixture,
  recipeImageUrl,
  recipeThumbnailUrl,
  type SessionFixture,
  sessionFixture,
  viewerFixture,
} from "./fixtures";
import { imagePlaceholderSize, imagePlaceholderSvg } from "./images";
import { type MockState } from "./scenarios";

const MOCK_UPLOAD_ORIGIN = "https://mock-r2.invalid";
const IMPORT_JOB_DURATION_MS = 6000;
// 画面は失敗したタグの保存を2回まで自動で送り直すので、最初に押した組の保存はこの回数まで届く。
const FIRST_TAG_SAVE_ATTEMPTS = 3;

const apiError = (status: number, code: ApiErrorCode, message: string, details?: unknown) =>
  HttpResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );

// Better Authのclientが読むエラーは通常APIのenvelopeとは形が異なる。
const authError = (status: number, code: string, message: string) =>
  HttpResponse.json({ code, message }, { status });

const svgResponse = (seed: string) =>
  HttpResponse.text(imagePlaceholderSvg(seed), {
    headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
  });

const objectKeyFromPath = (url: string, prefix: string) =>
  decodeURIComponent(new URL(url).pathname.slice(prefix.length));

// APIと同じく、語ごとにタイトル・出典かタグ名のどちらかに当たればよい。
const matchesQuery = (recipe: RecipeListItem, tagNames: readonly string[], query: string) => {
  const haystack = `${recipe.title} ${recipe.sourceName ?? ""}`.toLowerCase();

  return query
    .toLowerCase()
    .normalize("NFKC")
    .split(/\s+/)
    .filter(Boolean)
    .every(
      (term) =>
        haystack.includes(term) || tagNames.some((name) => name.toLowerCase().includes(term)),
    );
};

// APIの名前の揃え方と上限をそのまま使う。
const normalizeMockTagName = (name: string) => {
  const normalized = normalizeTagName(name);

  return normalized && countTagNameLength(normalized.name) <= MAX_TAG_NAME_LENGTH
    ? normalized
    : null;
};

const tagsInvalid = () => apiError(400, "validation_failed", "Request validation failed.");

type RecipeContent = RecipeDetail["content"];
type RecipeImage = NonNullable<RecipeContent["coverImage"]>;
type DraftContent = CreateRecipeRequest["content"];
type DraftImageRef = NonNullable<DraftContent["coverImage"]>;

const recipeImages = ({ content }: RecipeDetail): RecipeImage[] => [
  ...(content.coverImage ? [content.coverImage] : []),
  ...content.referenceImages,
  ...content.steps.flatMap((step) => step.images),
];

const toListItem = (detail: RecipeDetail): RecipeListItem => ({
  id: detail.id,
  title: detail.title,
  coverImageUrl: detail.content.coverImage
    ? recipeThumbnailUrl(detail.content.coverImage.objectKey)
    : null,
  sourceName: detail.source.sourceName ?? null,
  createdAt: detail.createdAt,
  locked: false,
});

/**
 * 下書きの画像参照を、APIの保存処理(apps/api/src/recipe-images.ts)と同じ規則で解決する。
 * 既存画像は保存済みのものだけを使え、アップロードや外部URLの画像はRecipe配下の新しいキーに置く。
 * 保存済みにない既存キーが混ざっていたらnullを返す。
 */
const resolveDraftContent = ({
  recipeId,
  draft,
  existingImages,
  createImageId,
}: {
  recipeId: string;
  draft: DraftContent;
  existingImages: readonly RecipeImage[];
  createImageId: () => string;
}): RecipeContent | null => {
  const existing = new Map(existingImages.map((image) => [image.objectKey, image]));
  const resolved = new Map<string, RecipeImage>();
  let hasUnknownExistingKey = false;

  const resolve = (image: DraftImageRef): RecipeImage[] => {
    const refId = image.type === "externalImageUrl" ? `url:${image.url}` : `key:${image.key}`;
    const cached = resolved.get(refId);

    if (cached) return [cached];

    if (image.type === "existingObjectKey") {
      const found = existing.get(image.key);

      if (!found) {
        hasUnknownExistingKey = true;
        return [];
      }

      resolved.set(refId, found);
      return [found];
    }

    const objectKey = `recipes/${MOCK_USER_ID}/${recipeId}/${createImageId()}.webp`;
    const created = {
      objectKey,
      ...imagePlaceholderSize(objectKey),
      url: recipeImageUrl(objectKey),
    };

    resolved.set(refId, created);
    return [created];
  };

  const content: RecipeContent = {
    title: draft.title,
    yieldText: draft.yieldText,
    coverImage: draft.coverImage ? resolve(draft.coverImage)[0] : undefined,
    referenceImages: draft.referenceImages.flatMap(resolve),
    ingredientGroups: draft.ingredientGroups,
    steps: draft.steps.map((step) => ({ text: step.text, images: step.images.flatMap(resolve) })),
    note: draft.note,
  };

  return hasUnknownExistingKey ? null : content;
};

/**
 * シナリオが宣言した状態を「動くサーバ」にする。
 * 作成・更新・削除・ログアウトは同じセッションのあいだ反映されるので、実際の操作をそのまま追える。
 */
export const createHandlers = (state: MockState, { delayMs }: { delayMs: number }) => {
  let session: SessionFixture | null = state.session;
  let recipes: RecipeListItem[] = [...state.recipes];
  let jobs: ImportJobSummary[] = [...state.importJobs];
  const jobSourceTexts = new Map(Object.entries(state.importJobSourceTexts));
  let pushSubscriptions = { ...state.pushSubscriptions };
  let credentials: ShortcutCredential[] = [...state.shortcutCredentials.credentials];
  const jobCompletions = new Map<string, number>();
  let nextId = 1;
  let tags: MockTag[] = [...state.tags];
  let viewer = state.viewer;
  let billing = state.billing;
  let billingReads = 0;
  let recipeDetailReads = 0;
  let imageUploadWrites = 0;
  let recipeTagWrites = 0;
  // Recipeのidごとに、付けたタグのidを付けた順に持つ。
  const recipeTags = new Map(
    Object.entries(state.recipeTags).map(([recipeId, tagIds]) => [recipeId, [...tagIds]]),
  );

  const tagsOf = (recipeId: string) =>
    (recipeTags.get(recipeId) ?? []).flatMap((tagId) => {
      const tag = tags.find((candidate) => candidate.id === tagId);
      return tag ? [{ id: tag.id, name: tag.name }] : [];
    });

  // APIと同じく、tagsの配列の順（＝利用者が決めた語彙の並び）のまま件数を付ける。
  const tagsWithCount = () =>
    tags.map((tag) => ({
      ...tag,
      recipeCount: recipes.filter((recipe) => recipeTags.get(recipe.id)?.includes(tag.id)).length,
    }));

  const requireSession = () =>
    session ? null : apiError(401, "unauthorized", "Sign in is required.");

  const isRecipeLimitReached = () =>
    viewer.recipeLimit !== null && recipes.length >= viewer.recipeLimit;

  const recipeLimitExceeded = () =>
    apiError(403, "recipe_limit_exceeded", "Recipe limit exceeded.");

  const configuredRecipeSaveFailure = () => {
    if (state.failures.saveRecipe === "generic") {
      return apiError(500, "unknown", "Failed to save recipe.");
    }
    if (state.failures.saveRecipe === "image-finalize") {
      return apiError(422, "image_finalize_failed", "Image could not be saved.");
    }

    return null;
  };

  // 作成・更新したRecipeの中身。シナリオや取り込みで一覧に入ったものは、初めて読むときに一覧の値からfixtureで作る。
  const recipeDetails = new Map<string, RecipeDetail>();

  const detailOf = (listed: RecipeListItem) => {
    const stored = recipeDetails.get(listed.id);

    if (stored) return stored;

    const fixture = recipeDetailFixture(listed.id);
    const content = { ...fixture.content, ...state.recipeContents[listed.id] };
    const detail: RecipeDetail = {
      ...fixture,
      title: listed.title,
      content: {
        ...content,
        title: listed.title,
        coverImage: listed.coverImageUrl ? content.coverImage : undefined,
      },
      source: { ...fixture.source, sourceName: listed.sourceName },
      createdAt: listed.createdAt,
      updatedAt: listed.createdAt,
    };

    recipeDetails.set(listed.id, detail);
    return detail;
  };

  const createImageId = () => `image_${nextId++}`;

  // 取り込みジョブは時間で進む。URLを貼ってから完了するまでの流れをそのまま見られるようにする。
  const advanceJobs = () => {
    const now = Date.now();

    jobs = jobs.map((job) => {
      const completesAt = jobCompletions.get(job.id);

      if (job.status !== "running" || completesAt === undefined || completesAt > now) {
        return job;
      }

      jobCompletions.delete(job.id);
      // APIと同じく原文は内部に保持し、画像も出典も持たないRecipeを作る。
      const recipeId = `recipe_mock_${nextId++}`;
      const createdRecipe: RecipeListItem = {
        id: recipeId,
        title: "取り込んだレシピ",
        coverImageUrl:
          job.kind === "url"
            ? recipeThumbnailUrl(`recipes/${MOCK_USER_ID}/${recipeId}/cover.webp`)
            : null,
        sourceName: job.kind === "url" ? "モック" : null,
        createdAt: new Date().toISOString(),
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
    // OAuthの往復でページがリロードされ、シナリオの状態は作り直される。
    // 未ログインのシナリオに戻らないよう、戻り先でログイン済みのdefaultシナリオを選ばせる。
    http.post("/api/auth/sign-in/social", async ({ request }) => {
      const { callbackURL } = (await request.json()) as { callbackURL?: string };
      const url = new URL(callbackURL ?? "/", window.location.origin);
      url.searchParams.set("scenario", "default");

      return HttpResponse.json({ url: `${url.pathname}${url.search}`, redirect: true });
    }),
    http.post("/api/auth/sign-in/email", () => {
      session = sessionFixture();

      return HttpResponse.json({ redirect: false, token: "mock_token", user: session.user });
    }),
    http.post("/api/auth/sign-up/email", () => HttpResponse.json({ token: null })),
    http.post("/api/auth/sign-out", () => {
      if (state.failures.signOut) {
        return authError(500, "UNKNOWN_ERROR", "Failed to sign out.");
      }

      session = null;

      return HttpResponse.json({ success: true });
    }),
    http.post("/api/auth/change-email", () =>
      state.failures.changeEmail
        ? authError(500, "UNKNOWN_ERROR", "Failed to change email.")
        : HttpResponse.json({ status: true }),
    ),
    http.post("/api/auth/change-password", () => {
      if (state.failures.changePassword === "invalid-password") {
        return authError(400, "INVALID_PASSWORD", "Invalid password.");
      }
      if (state.failures.changePassword === "generic") {
        return authError(500, "UNKNOWN_ERROR", "Failed to change password.");
      }

      return HttpResponse.json({ status: true });
    }),
    http.get("/api/auth/list-accounts", () => {
      if (!session) {
        return authError(401, "UNAUTHORIZED", "Unauthorized");
      }
      if (state.failures.listLoginAccounts) {
        return authError(500, "UNKNOWN_ERROR", "Failed to list accounts.");
      }

      return HttpResponse.json(state.loginAccounts);
    }),
    // APIはautoSignInAfterVerificationなので、検証が通ればそのままログインする。
    http.post("/api/auth/email-otp/verify-email", () => {
      session = sessionFixture();

      return HttpResponse.json({ status: true, token: "mock_token", user: session.user });
    }),
    http.post("/api/auth/email-otp/request-password-reset", () =>
      HttpResponse.json({ success: true }),
    ),
    http.post("/api/auth/email-otp/reset-password", () => HttpResponse.json({ status: true })),

    // --- viewer ---
    http.get("/api/me", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.getViewer) {
        return apiError(503, "temporarily_unavailable", "Failed to load viewer.");
      }

      return HttpResponse.json({
        ...viewer,
        recipeCount: recipes.length,
        isRecipeLimitReached: isRecipeLimitReached(),
      });
    }),

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
      const tagIds = [...new Set(url.searchParams.getAll("tagId"))];
      const untagged = url.searchParams.get("untagged") === "true";
      const limit = Number(url.searchParams.get("limit") ?? "20");
      const offset = cursor ? Number(cursor) : 0;
      const matched = recipes.filter((recipe) => {
        const attachedTagIds = recipeTags.get(recipe.id) ?? [];
        const tagNames = tagsOf(recipe.id).map((tag) => tag.name);

        return (
          (!query || matchesQuery(recipe, tagNames, query)) &&
          tagIds.every((tagId) => attachedTagIds.includes(tagId)) &&
          (!untagged || attachedTagIds.length === 0)
        );
      });
      // recipesはAPIの既定と同じく追加が新しい順に持っている。
      const sorted = url.searchParams.get("sort") === "oldest" ? [...matched].reverse() : matched;
      const items = sorted.slice(offset, offset + limit);
      const nextOffset = offset + items.length;

      return HttpResponse.json({
        items,
        nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
      });
    }),
    http.post("/api/recipes", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = createRecipeRequestSchema.safeParse(await request.json());
      if (!body.success) {
        return apiError(400, "validation_failed", "Request validation failed.");
      }

      if (isRecipeLimitReached()) {
        return recipeLimitExceeded();
      }

      const configuredFailure = configuredRecipeSaveFailure();
      if (configuredFailure) return configuredFailure;

      const recipeId = `recipe_mock_${nextId++}`;
      const content = resolveDraftContent({
        recipeId,
        draft: body.data.content,
        existingImages: [],
        createImageId,
      });
      if (!content) {
        return apiError(422, "image_finalize_failed", "Image could not be saved.");
      }

      const now = new Date().toISOString();
      const detail: RecipeDetail = {
        id: recipeId,
        title: content.title,
        content,
        source: {
          sourceUrl: body.data.source.sourceUrl ?? null,
          normalizedSourceUrl: body.data.source.sourceUrl ?? null,
          sourceName: body.data.source.sourceName ?? null,
        },
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      };

      recipeDetails.set(recipeId, detail);
      recipes = [toListItem(detail), ...recipes];

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

      recipeDetailReads += 1;
      if (
        state.failures.getRecipe === "always" ||
        (state.failures.getRecipe === "once" && recipeDetailReads === 1)
      ) {
        return apiError(500, "unknown", "Failed to load recipe.");
      }

      return HttpResponse.json({
        recipe: listed.locked
          ? { id: recipeId, locked: true }
          : { ...detailOf(listed), tags: tagsOf(recipeId) },
      });
    }),
    http.put("/api/recipes/:recipeId", async ({ params, request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = String(params.recipeId);
      const listed = recipes.find((recipe) => recipe.id === recipeId);

      if (!listed) {
        return apiError(404, "not_found", "Recipe was not found.");
      }

      const body = updateRecipeRequestSchema.safeParse(await request.json());
      if (!body.success) {
        return apiError(400, "validation_failed", "Request validation failed.");
      }

      const configuredFailure = configuredRecipeSaveFailure();
      if (configuredFailure) return configuredFailure;

      const current = detailOf(listed);
      const content = resolveDraftContent({
        recipeId,
        draft: body.data.content,
        existingImages: recipeImages(current),
        createImageId,
      });
      if (!content) {
        return apiError(422, "image_finalize_failed", "Image could not be saved.");
      }

      const detail: RecipeDetail = {
        ...current,
        title: content.title,
        content,
        updatedAt: new Date().toISOString(),
        tags: tagsOf(recipeId),
      };

      recipeDetails.set(recipeId, detail);
      // 一覧は追加日で並ぶので、更新しても位置は変わらない。
      recipes = recipes.map((recipe) => (recipe.id === recipeId ? toListItem(detail) : recipe));

      return HttpResponse.json({ recipe: detail });
    }),
    http.delete("/api/recipes/:recipeId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = String(params.recipeId);
      if (state.failures.deleteRecipe) {
        return apiError(500, "unknown", "Failed to delete recipe.");
      }

      recipes = recipes.filter((recipe) => recipe.id !== recipeId);
      recipeDetails.delete(recipeId);
      recipeTags.delete(recipeId);

      return HttpResponse.json({ ok: true });
    }),
    http.put("/api/recipes/:recipeId/tags", async ({ params, request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const recipeId = String(params.recipeId);
      const listed = recipes.find((recipe) => recipe.id === recipeId);

      if (!listed) {
        return apiError(404, "not_found", "Recipe was not found.");
      }

      const body = replaceRecipeTagsRequestSchema.safeParse(await request.json());
      const names = body.success ? body.data.names.map(normalizeMockTagName) : [null];

      if (names.some((name) => name === null)) {
        return tagsInvalid();
      }

      if (listed.locked || state.failures.replaceRecipeTags === "locked") {
        return apiError(403, "locked_recipe", "Recipe is locked.");
      }

      recipeTagWrites += 1;
      if (
        state.failures.replaceRecipeTags === "always" ||
        (state.failures.replaceRecipeTags === "first-save" &&
          recipeTagWrites <= FIRST_TAG_SAVE_ATTEMPTS)
      ) {
        return apiError(500, "unknown", "Failed to save recipe tags.");
      }

      // 揃えた名前が同じなら既存のタグを使い、なければ作る。
      const selectedTagIds: string[] = [];

      for (const name of names) {
        if (!name) continue;

        let tag = tags.find((candidate) => candidate.name.toLowerCase() === name.normalizedName);

        if (!tag) {
          tag = { id: `tag_mock_${nextId++}`, name: name.name };
          tags = [...tags, tag];
        }

        if (!selectedTagIds.includes(tag.id)) {
          selectedTagIds.push(tag.id);
        }
      }

      // 残したタグは付けた順を保ち、新しく付けたタグを後ろに足す。
      const currentTagIds = recipeTags.get(recipeId) ?? [];
      recipeTags.set(recipeId, [
        ...currentTagIds.filter((tagId) => selectedTagIds.includes(tagId)),
        ...selectedTagIds.filter((tagId) => !currentTagIds.includes(tagId)),
      ]);

      return HttpResponse.json({ tags: tagsOf(recipeId) });
    }),

    // --- tags ---
    http.get("/api/tags", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.listTags) {
        return apiError(503, "temporarily_unavailable", "Failed to list tags.");
      }

      return HttpResponse.json({ tags: tagsWithCount() });
    }),
    http.put("/api/tags/order", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = reorderTagsRequestSchema.safeParse(await request.json());

      if (!body.success) {
        return tagsInvalid();
      }

      // 送られたタグを先頭から並べ、送られなかったタグは今の相対順のまま後ろに残す。
      const requestedIds = [...new Set(body.data.tagIds)];
      const requested = requestedIds.flatMap((tagId) => tags.find((tag) => tag.id === tagId) ?? []);
      tags = [...requested, ...tags.filter((tag) => !requestedIds.includes(tag.id))];

      return HttpResponse.json({ ok: true });
    }),
    http.patch("/api/tags/:tagId", async ({ params, request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const tagId = String(params.tagId);

      if (!tags.some((tag) => tag.id === tagId)) {
        return apiError(404, "not_found", "Tag was not found.");
      }

      const body = renameTagRequestSchema.safeParse(await request.json());
      const name = body.success ? normalizeMockTagName(body.data.name) : null;

      if (!name) {
        return tagsInvalid();
      }

      const conflicting = tags.find(
        (tag) => tag.id !== tagId && tag.name.toLowerCase() === name.normalizedName,
      );

      if (conflicting) {
        return apiError(409, "tag_name_conflict", "Tag name is already used.", {
          tag: conflicting,
        });
      }

      tags = tags.map((tag) => (tag.id === tagId ? { ...tag, name: name.name } : tag));

      return HttpResponse.json({ tag: { id: tagId, name: name.name } });
    }),
    http.post("/api/tags/:tagId/merge", async ({ params, request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const tagId = String(params.tagId);
      const body = mergeTagRequestSchema.safeParse(await request.json());

      if (!body.success || body.data.intoTagId === tagId) {
        return tagsInvalid();
      }

      const source = tags.find((tag) => tag.id === tagId);
      const target = tags.find((tag) => tag.id === body.data.intoTagId);

      if (!source || !target) {
        return apiError(404, "not_found", "Tag was not found.");
      }

      // 付けた位置のまま統合先に置き換え、両方付いていたRecipeでは元のタグを外すだけにする。
      for (const [recipeId, tagIds] of recipeTags) {
        if (!tagIds.includes(source.id)) continue;

        recipeTags.set(
          recipeId,
          tagIds.includes(target.id)
            ? tagIds.filter((id) => id !== source.id)
            : tagIds.map((id) => (id === source.id ? target.id : id)),
        );
      }

      tags = tags.filter((tag) => tag.id !== source.id);

      return HttpResponse.json({ tag: target });
    }),
    http.delete("/api/tags/:tagId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const tagId = String(params.tagId);

      if (!tags.some((tag) => tag.id === tagId)) {
        return apiError(404, "not_found", "Tag was not found.");
      }

      tags = tags.filter((tag) => tag.id !== tagId);

      for (const [recipeId, tagIds] of recipeTags) {
        recipeTags.set(
          recipeId,
          tagIds.filter((id) => id !== tagId),
        );
      }

      return HttpResponse.json({ ok: true });
    }),

    // --- billing ---
    http.get("/api/billing/status", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.getBillingStatus) {
        return apiError(503, "temporarily_unavailable", "Failed to load billing status.");
      }

      // 決済から戻った直後を再現する。何度か読まれたところでwebhookが届いたことにしてProへ変える。
      billingReads += 1;
      if (
        state.upgradeAfterBillingReads !== undefined &&
        billingReads > state.upgradeAfterBillingReads
      ) {
        viewer = viewerFixture({ plan: "pro" });
        billing = proBillingStatusFixture();
      }

      return HttpResponse.json(billing);
    }),
    http.get("/api/billing/pro-price", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.getProPrice) {
        return apiError(503, "temporarily_unavailable", "Failed to load Pro price.");
      }

      return HttpResponse.json(state.proPrice);
    }),
    http.post("/api/billing/checkout", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.createCheckout) {
        return apiError(500, "unknown", "Failed to create checkout.");
      }

      return HttpResponse.json({
        url: `${window.location.origin}/settings/billing?checkout=success`,
      });
    }),
    http.post("/api/billing/portal", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.createBillingPortal) {
        return apiError(500, "unknown", "Failed to create billing portal.");
      }

      return HttpResponse.json({ url: `${window.location.origin}/settings/billing` });
    }),

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

      const body = importUrlRequestSchema.safeParse(await request.json());
      if (!body.success) {
        return apiError(400, "invalid_url", "Import URL is invalid.");
      }

      if (isRecipeLimitReached()) {
        return recipeLimitExceeded();
      }

      const job: ImportJobSummary = {
        id: `job_mock_${nextId++}`,
        kind: "url",
        status: "running",
        url: body.data.url,
        textPreview: null,
        recipeId: null,
        errorCode: null,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };

      jobs = [job, ...jobs];
      jobCompletions.set(job.id, Date.now() + IMPORT_JOB_DURATION_MS);

      return HttpResponse.json({ kind: "created", job }, { status: 202 });
    }),
    http.post("/api/import/text/jobs", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const body = importTextRequestSchema.safeParse(await request.json());
      if (!body.success) {
        return apiError(400, "validation_failed", "Request validation failed.");
      }

      if (isRecipeLimitReached()) {
        return recipeLimitExceeded();
      }

      const job: ImportJobSummary = {
        id: `job_mock_${nextId++}`,
        kind: "text",
        status: "running",
        url: null,
        textPreview: body.data.text.split("\n", 1)[0]?.trim() || null,
        recipeId: null,
        errorCode: null,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: null,
      };

      jobs = [job, ...jobs];
      jobSourceTexts.set(job.id, body.data.text);
      jobCompletions.set(job.id, Date.now() + IMPORT_JOB_DURATION_MS);

      return HttpResponse.json({ kind: "created", job }, { status: 202 });
    }),
    http.get("/api/import/jobs/:jobId", ({ params }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;

      const jobId = String(params.jobId);
      const job = jobs.find((candidate) => candidate.id === jobId);

      if (!job) {
        return apiError(404, "not_found", "Import job was not found.");
      }

      return HttpResponse.json({
        job,
        sourceText: jobSourceTexts.get(jobId) ?? null,
      });
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
    http.get("/api/push-subscriptions", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.getPushSubscriptions) {
        return apiError(503, "temporarily_unavailable", "Failed to load push subscriptions.");
      }

      return HttpResponse.json(pushSubscriptions);
    }),
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
    http.get("/api/shortcut-credentials", () => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.listShortcutCredentials) {
        return apiError(503, "temporarily_unavailable", "Failed to list shortcut credentials.");
      }

      return HttpResponse.json({ credentials });
    }),
    http.post("/api/shortcut-credentials", async ({ request }) => {
      const unauthorized = requireSession();
      if (unauthorized) return unauthorized;
      if (state.failures.issueShortcutCredential) {
        return apiError(500, "unknown", "Failed to issue shortcut credential.");
      }

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
      if (state.failures.revokeShortcutCredential) {
        return apiError(500, "unknown", "Failed to revoke shortcut credential.");
      }

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
    http.put(`${MOCK_UPLOAD_ORIGIN}/*`, () => {
      imageUploadWrites += 1;
      if (
        state.failures.uploadImage === "always" ||
        (state.failures.uploadImage === "after-first" && imageUploadWrites > 1)
      ) {
        return new HttpResponse(null, { status: 500 });
      }

      return new HttpResponse(null, { status: 200 });
    }),
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

    // どのハンドラにも当たらなかったAPI。素通しするとViteのproxyで実APIに届くので、ここで止める。
    // 必ず末尾に置く。
    http.all("/api/*", ({ request }) => {
      console.error(`[mock] No handler for ${request.method} ${new URL(request.url).pathname}`);

      return apiError(501, "unknown", "No mock handler matched this request.");
    }),
  ];
};
