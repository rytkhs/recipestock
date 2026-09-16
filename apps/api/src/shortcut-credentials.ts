import { type DbClient, shortcutCredentials } from "@recipestock/db";
import { SHORTCUT_CREDENTIAL_NAME_MAX_LENGTH, type ShortcutCredential } from "@recipestock/schemas";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";

const TOKEN_PREFIX = "rssc_";
const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const TOKEN_RANDOM_LENGTH = 25;
const TOKEN_SUFFIX_LENGTH = 4;

export type ShortcutCredentialRecord = {
  id: string;
  userId: string;
  name: string | null;
  tokenHash: string;
  tokenSuffix: string;
  createdAt: Date;
  verifiedAt: Date | null;
  revokedAt: Date | null;
};

export type ShortcutCredentialIdentity = {
  credentialId: string;
  userId: string;
  verified: boolean;
};

export type ShortcutCredentialRepository = {
  createCredential(credential: ShortcutCredentialRecord): Promise<ShortcutCredentialRecord>;
  listCredentials(userId: string): Promise<ShortcutCredentialRecord[]>;
  revokeCredential(params: { credentialId: string; userId: string; now: Date }): Promise<boolean>;
  markVerified(params: { credentialId: string; name: string | null; now: Date }): Promise<void>;
  authenticate(params: { tokenHash: string }): Promise<ShortcutCredentialIdentity | null>;
};

export type ShortcutCredentials = {
  issue(params: { userId: string }): Promise<{ credential: ShortcutCredential; token: string }>;
  list(userId: string): Promise<ShortcutCredential[]>;
  revoke(params: { credentialId: string; userId: string }): Promise<boolean>;
  authenticate(params: { token: string }): Promise<ShortcutCredentialIdentity | null>;
  /** 認証が初めて成功したcredentialを連携済みとして確定する (ADR 0025)。 */
  markVerified(params: { credentialId: string; deviceName: string | undefined }): Promise<void>;
};

const mapCredential = (credential: ShortcutCredentialRecord): ShortcutCredential => ({
  id: credential.id,
  name: credential.name,
  tokenSuffix: credential.tokenSuffix,
  createdAt: credential.createdAt.toISOString(),
  verifiedAt: credential.verifiedAt?.toISOString() ?? null,
});

/**
 * デバイス名はiOSが決める文字列で、長さも中身も保証がない。表示できる形へ落とし、
 * 空になるものは名前なしとして扱う。
 */
const normalizeDeviceName = (deviceName: string | undefined) => {
  const trimmed = deviceName?.trim() ?? "";
  return trimmed ? trimmed.slice(0, SHORTCUT_CREDENTIAL_NAME_MAX_LENGTH) : null;
};

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
   * 書き込みは初回の1回だけにする。`verified_at is null`の条件で、同時に届いた
   * 2件目以降は更新を起こさない (ADR 0025)。
   */
  async markVerified({ credentialId, name, now }) {
    await db
      .update(shortcutCredentials)
      .set({ verifiedAt: now, name })
      .where(and(eq(shortcutCredentials.id, credentialId), isNull(shortcutCredentials.verifiedAt)));
  },

  async authenticate({ tokenHash }) {
    const result = await db.execute<ShortcutCredentialIdentity>(sql`
      select id as "credentialId", user_id as "userId", verified_at is not null as "verified"
      from shortcut_credentials
      where token_hash = ${tokenHash}
        and revoked_at is null
      limit 1
    `);

    return result.rows[0] ?? null;
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
  async issue({ userId }) {
    const token = createToken();
    const credential = await repository.createCredential({
      id: createId(),
      userId,
      name: null,
      tokenHash: await hashShortcutCredentialToken(token),
      tokenSuffix: token.slice(-TOKEN_SUFFIX_LENGTH),
      createdAt: getCurrentDate(),
      verifiedAt: null,
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
    });
  },

  async markVerified({ credentialId, deviceName }) {
    await repository.markVerified({
      credentialId,
      name: normalizeDeviceName(deviceName),
      now: getCurrentDate(),
    });
  },
});
