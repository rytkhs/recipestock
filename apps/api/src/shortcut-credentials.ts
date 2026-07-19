import { type DbClient, shortcutCredentials } from "@recipestock/db";
import { type ShortcutCredential } from "@recipestock/schemas";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "ulid";

const TOKEN_PREFIX = "rssc_";

export type ShortcutCredentialRecord = {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenSuffix: string;
  createdAt: Date;
  revokedAt: Date | null;
};

export type ShortcutCredentialRepository = {
  createCredential(credential: ShortcutCredentialRecord): Promise<ShortcutCredentialRecord>;
  listCredentials(userId: string): Promise<ShortcutCredentialRecord[]>;
  revokeCredential(params: { credentialId: string; userId: string; now: Date }): Promise<boolean>;
  authenticate(params: {
    tokenHash: string;
  }): Promise<{ credentialId: string; userId: string } | null>;
};

export type ShortcutCredentials = {
  issue(params: {
    userId: string;
    name: string;
  }): Promise<{ credential: ShortcutCredential; token: string }>;
  list(userId: string): Promise<ShortcutCredential[]>;
  revoke(params: { credentialId: string; userId: string }): Promise<boolean>;
  authenticate(params: { token: string }): Promise<{ credentialId: string; userId: string } | null>;
};

const mapCredential = (credential: ShortcutCredentialRecord): ShortcutCredential => ({
  id: credential.id,
  name: credential.name,
  tokenSuffix: credential.tokenSuffix,
  createdAt: credential.createdAt.toISOString(),
});

export const createShortcutCredentialToken = () =>
  `${TOKEN_PREFIX}${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")}`;

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

  async authenticate({ tokenHash }) {
    const result = await db.execute<{ credentialId: string; userId: string }>(sql`
      select id as "credentialId", user_id as "userId"
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
  async issue({ userId, name }) {
    const token = createToken();
    const credential = await repository.createCredential({
      id: createId(),
      userId,
      name,
      tokenHash: await hashShortcutCredentialToken(token),
      tokenSuffix: token.slice(-6),
      createdAt: getCurrentDate(),
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
});
