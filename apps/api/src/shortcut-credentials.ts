import { type DbClient, shortcutCredentials } from "@recipestock/db";
import { type ShortcutCredential } from "@recipestock/schemas";
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { ulid } from "ulid";

const TOKEN_PREFIX = "rssc_";
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const TOKEN_RANDOM_LENGTH = 25;
// 発行したまま使われていないキーの寿命。平文はクリップボードを通るので、使われないまま有効にしておかない。
// ショートカットを追加しただけで、初めて共有するのは何日も後、という人を弾かない長さにする。
const UNUSED_CREDENTIAL_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** これより前に発行して、まだ使われていないキーは期限切れ。 */
const unusedCredentialCutoff = (now: Date) =>
  new Date(now.getTime() - UNUSED_CREDENTIAL_LIFETIME_MS);

export type ShortcutCredentialRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  createdAt: Date;
  firstUsedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/**
 * 解除済みのキーと、使われないまま期限が過ぎたキーは認証を通さない。ただ、連携し直しを促した理由を監視で見分けられるよう、
 * 知らないキーとは分けて返す。
 */
export type ShortcutCredentialAuthentication =
  | { status: "active"; credentialId: string; userId: string }
  | { status: "revoked"; credentialId: string; userId: string }
  | { status: "expired"; credentialId: string; userId: string }
  | { status: "unknown" };

export type ShortcutCredentialRepository = {
  createCredential(credential: ShortcutCredentialRecord): Promise<ShortcutCredentialRecord>;
  /** 解除済みのキーと、期限が過ぎた使われていないキーは返さない。 */
  listCredentials(params: { userId: string; now: Date }): Promise<ShortcutCredentialRecord[]>;
  revokeCredential(params: { credentialId: string; userId: string; now: Date }): Promise<boolean>;
  /** 認証を通したキーには、使った時刻を同じ書き込みで残す。 */
  authenticate(params: { tokenHash: string; now: Date }): Promise<ShortcutCredentialAuthentication>;
};

export type ShortcutCredentials = {
  issue(params: {
    userId: string;
    name: string;
  }): Promise<{ credential: ShortcutCredential; token: string }>;
  list(userId: string): Promise<ShortcutCredential[]>;
  revoke(params: { credentialId: string; userId: string }): Promise<boolean>;
  authenticate(params: { token: string }): Promise<ShortcutCredentialAuthentication>;
};

const mapCredential = (credential: ShortcutCredentialRecord): ShortcutCredential => ({
  id: credential.id,
  name: credential.name,
  createdAt: credential.createdAt.toISOString(),
  firstUsedAt: credential.firstUsedAt?.toISOString() ?? null,
  lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
});

export const createShortcutCredentialToken = () =>
  `${TOKEN_PREFIX}${Array.from(
    crypto.getRandomValues(new Uint8Array(TOKEN_RANDOM_LENGTH)),
    (value) => TOKEN_ALPHABET.charAt(value % TOKEN_ALPHABET.length),
  ).join("")}`;

export const hashShortcutCredentialToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

export const createShortcutCredentialRepository = (db: DbClient): ShortcutCredentialRepository => ({
  async createCredential(credential) {
    const [row] = await db.insert(shortcutCredentials).values(credential).returning();
    if (!row) {
      throw new Error("Shortcut credential was not created.");
    }
    return row;
  },

  async listCredentials({ userId, now }) {
    return db
      .select()
      .from(shortcutCredentials)
      .where(
        and(
          eq(shortcutCredentials.userId, userId),
          isNull(shortcutCredentials.revokedAt),
          or(
            isNotNull(shortcutCredentials.firstUsedAt),
            gt(shortcutCredentials.createdAt, unusedCredentialCutoff(now)),
          ),
        ),
      )
      .orderBy(desc(shortcutCredentials.createdAt));
  },

  async revokeCredential({ credentialId, userId, now }) {
    const [row] = await db
      .update(shortcutCredentials)
      .set({ revokedAt: now })
      .where(
        and(
          eq(shortcutCredentials.id, credentialId),
          eq(shortcutCredentials.userId, userId),
          isNull(shortcutCredentials.revokedAt),
        ),
      )
      .returning({ id: shortcutCredentials.id });
    return Boolean(row);
  },

  /**
   * 照合と使った時刻の記録を1つのSQLで済ませ、ショートカットからのrequestに往復を足さない。
   * token hashは解除済みの行を含めて一意なので、結果は高々1行である。
   */
  async authenticate({ tokenHash, now }) {
    const nowIso = now.toISOString();
    const cutoffIso = unusedCredentialCutoff(now).toISOString();
    const result = await db.execute<{
      credentialId: string;
      userId: string;
      status: "active" | "revoked" | "expired";
    }>(sql`
      with used_credential as (
        update shortcut_credentials
        set
          first_used_at = coalesce(shortcut_credentials.first_used_at, ${nowIso}::timestamptz),
          last_used_at = ${nowIso}::timestamptz
        where token_hash = ${tokenHash}
          and revoked_at is null
          and (first_used_at is not null or created_at > ${cutoffIso}::timestamptz)
        returning id, user_id
      )
      select id as "credentialId", user_id as "userId", 'active' as "status"
      from used_credential
      union all
      select id, user_id, case when revoked_at is not null then 'revoked' else 'expired' end
      from shortcut_credentials
      where token_hash = ${tokenHash}
        and (
          revoked_at is not null
          or (first_used_at is null and created_at <= ${cutoffIso}::timestamptz)
        )
      limit 1
    `);
    const row = result.rows[0];

    if (!row) {
      return { status: "unknown" };
    }

    return { status: row.status, credentialId: row.credentialId, userId: row.userId };
  },
});

export const createShortcutCredentials = ({
  repository,
  createId = ulid,
  createToken = createShortcutCredentialToken,
  getCurrentDate = () => new Date(),
}: {
  repository: ShortcutCredentialRepository;
  createId?: () => string;
  createToken?: () => string;
  getCurrentDate?: () => Date;
}): ShortcutCredentials => ({
  async issue({ userId, name }) {
    const token = createToken();
    const credential = await repository.createCredential({
      id: createId(),
      userId,
      name,
      tokenHash: await hashShortcutCredentialToken(token),
      createdAt: getCurrentDate(),
      firstUsedAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    return { credential: mapCredential(credential), token };
  },

  async list(userId) {
    return (await repository.listCredentials({ userId, now: getCurrentDate() })).map(mapCredential);
  },

  revoke({ credentialId, userId }) {
    return repository.revokeCredential({ credentialId, userId, now: getCurrentDate() });
  },

  async authenticate({ token }) {
    return repository.authenticate({
      tokenHash: await hashShortcutCredentialToken(token),
      now: getCurrentDate(),
    });
  },
});
