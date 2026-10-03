import { type DbClient, shortcutCredentials } from "@recipestock/db";
import { type ShortcutCredential } from "@recipestock/schemas";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";

const TOKEN_PREFIX = "rssc_";
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const TOKEN_RANDOM_LENGTH = 25;
const TOKEN_SUFFIX_LENGTH = 4;

export type ShortcutCredentialRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenSuffix: string;
  createdAt: Date;
  firstUsedAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/**
 * 解除済みのキーは認証を通さない。ただ、連携し直しを促した理由を監視で見分けられるよう、
 * 知らないキーとは分けて返す。
 */
export type ShortcutCredentialAuthentication =
  | { status: "active"; credentialId: string; userId: string }
  | { status: "revoked"; credentialId: string; userId: string }
  | { status: "unknown" };

export type ShortcutCredentialRepository = {
  createCredential(credential: ShortcutCredentialRecord): Promise<ShortcutCredentialRecord>;
  listCredentials(userId: string): Promise<ShortcutCredentialRecord[]>;
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
  tokenSuffix: credential.tokenSuffix,
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

  async listCredentials(userId) {
    return db
      .select()
      .from(shortcutCredentials)
      .where(and(eq(shortcutCredentials.userId, userId), isNull(shortcutCredentials.revokedAt)))
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
    const result = await db.execute<{ credentialId: string; userId: string; revoked: boolean }>(sql`
      with used_credential as (
        update shortcut_credentials
        set
          first_used_at = coalesce(shortcut_credentials.first_used_at, ${nowIso}::timestamptz),
          last_used_at = ${nowIso}::timestamptz
        where token_hash = ${tokenHash}
          and revoked_at is null
        returning id, user_id
      )
      select id as "credentialId", user_id as "userId", false as "revoked"
      from used_credential
      union all
      select id, user_id, true
      from shortcut_credentials
      where token_hash = ${tokenHash}
        and revoked_at is not null
      limit 1
    `);
    const row = result.rows[0];

    if (!row) {
      return { status: "unknown" };
    }

    return {
      status: row.revoked ? "revoked" : "active",
      credentialId: row.credentialId,
      userId: row.userId,
    };
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
      tokenSuffix: token.slice(-TOKEN_SUFFIX_LENGTH),
      createdAt: getCurrentDate(),
      firstUsedAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    return { credential: mapCredential(credential), token };
  },

  async list(userId) {
    return (await repository.listCredentials(userId)).map(mapCredential);
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
