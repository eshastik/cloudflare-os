import { PostgresBinaryKv } from "@gadgets/backend-utils/postgres-binary-kv";
import type { PostgresStateEnv } from "@gadgets/backend-utils/postgres-text-kv";
import { withPostgresState } from "@gadgets/backend-utils/postgres-state";
import { AwsClient } from "aws4fetch";
import { Buffer } from "node:buffer";
import type { AvatarReference } from "@gadgets/workshop-shared/api";

/** Приватные настройки изображений профиля; не передаются агентам или браузеру. */
export interface AvatarStateEnv extends PostgresStateEnv {
  SHELL_AVATAR_STATE_BACKEND?: string;
  SHELL_AVATAR_S3_ENDPOINT?: string;
  SHELL_AVATAR_S3_BUCKET?: string;
  SHELL_AVATAR_S3_ACCESS_KEY?: string;
  SHELL_AVATAR_S3_SECRET_KEY?: string;
}

/** Изображения профиля: запись подтверждается до ответа человеку. */
export interface AvatarStorage {
  get(key: string): Promise<Uint8Array | null>;
  reference(key: string): Promise<AvatarReference | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

type Photo = { object_key: string | null; sha256: string | null; media_type: string | null; size_bytes: number | null };

async function checksum(value: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", value)).toString("hex");
}

/** S3 содержит изображение, PostgreSQL — версию и адрес. Старое изображение переносится при первом чтении. */
class S3Avatars implements AvatarStorage {
  private readonly aws: AwsClient;
  constructor(private readonly env: AvatarStateEnv) {
    const endpoint = new URL(env.SHELL_AVATAR_S3_ENDPOINT!);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("Неверный адрес S3 для изображений профиля");
    }
    this.aws = new AwsClient({ accessKeyId: env.SHELL_AVATAR_S3_ACCESS_KEY!, secretAccessKey: env.SHELL_AVATAR_S3_SECRET_KEY!, service: "s3", region: "us-east-1", retries: 1 });
  }
  private url(key: string): string {
    return this.env.SHELL_AVATAR_S3_ENDPOINT!.replace(/\/$/, "") + "/" + encodeURIComponent(this.env.SHELL_AVATAR_S3_BUCKET!) + "/" + key;
  }
  private state<T>(write: boolean, use: Parameters<typeof withPostgresState<T>>[3]): Promise<T> {
    return withPostgresState(this.env.SHELL_POSTGRES!.connectionString, this.env.SHELL_STATE_TENANT!, write, use);
  }
  private async read(key: string): Promise<Photo | null> {
    return this.state(false, async client => {
      const result = await client.query<Photo>("SELECT object_key,sha256,media_type,size_bytes FROM mnemos_shell.avatars WHERE tenant_id=$1 AND user_id=$2", [this.env.SHELL_STATE_TENANT, key]);
      return result.rows[0] ?? null;
    });
  }
  private async upload(value: Uint8Array): Promise<Photo> {
    const sha = await checksum(value);
    const object_key = "shell-avatars/" + sha;
    const media_type = value[0] === 0xff ? "image/jpeg" : "image/png";
    const response = await this.aws.fetch(this.url(object_key), { method: "PUT", body: value, headers: { "Content-Type": media_type, "Cache-Control": "private, max-age=31536000, immutable" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error("S3 не принял изображение профиля");
    const photo = { object_key, sha256: sha, media_type, size_bytes: value.byteLength };
    // Удалять прежнюю копию можно только после чтения и сверки принятого S3 объекта.
    await this.download(photo);
    return photo;
  }
  private async download(photo: Photo): Promise<Uint8Array> {
    const response = await this.aws.fetch(this.url(photo.object_key!), { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Изображение профиля недоступно в S3"); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== photo.size_bytes || await checksum(bytes) !== photo.sha256) throw new Error("Не совпали байты изображения профиля");
    return bytes;
  }
  private async resolve(key: string): Promise<Photo | null> {
    const known = await this.read(key);
    if (known) return known;
    const legacy = new PostgresBinaryKv(this.env.SHELL_POSTGRES!.connectionString, this.env.SHELL_STATE_TENANT!, "avatars");
    const bytes = await legacy.get(key);
    if (!bytes) return null;
    const photo = await this.upload(bytes);
    await this.state(true, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [this.env.SHELL_STATE_TENANT + ":avatar:" + key]);
      // Снимок не перезаписывает новое фото или снятие, выполненные во время переноса.
      const inserted = await client.query("INSERT INTO mnemos_shell.avatars(tenant_id,user_id,object_key,sha256,media_type,size_bytes) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace='avatars' AND key=$7 AND value=$8) ON CONFLICT DO NOTHING RETURNING user_id", [this.env.SHELL_STATE_TENANT, key, photo.object_key, photo.sha256, photo.media_type, photo.size_bytes, Buffer.from(key), Buffer.from(bytes)]);
      if (inserted.rowCount) await client.query("DELETE FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace='avatars' AND key=$2", [this.env.SHELL_STATE_TENANT, Buffer.from(key)]);
    });
    return this.read(key);
  }
  async reference(key: string): Promise<AvatarReference | null> {
    const photo = await this.resolve(key);
    if (!photo?.object_key) return null;
    const url = new URL(this.url(photo.object_key));
    url.searchParams.set("X-Amz-Expires", "900");
    const signed = await this.aws.sign(url.href, { method: "GET", aws: { signQuery: true }, headers: {} });
    return { version: photo.sha256!, url: signed.url, sizeBytes: photo.size_bytes!, mediaType: photo.media_type! };
  }
  async get(key: string): Promise<Uint8Array | null> {
    const photo = await this.resolve(key);
    return photo?.object_key ? this.download(photo) : null;
  }
  async put(key: string, value: Uint8Array): Promise<void> {
    const photo = await this.upload(value);
    await this.save(key, photo);
  }
  private async save(key: string, photo: Photo): Promise<void> {
    await this.state(true, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [this.env.SHELL_STATE_TENANT + ":avatar:" + key]);
      await client.query("INSERT INTO mnemos_shell.avatars(tenant_id,user_id,object_key,sha256,media_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,user_id) DO UPDATE SET object_key=EXCLUDED.object_key,sha256=EXCLUDED.sha256,media_type=EXCLUDED.media_type,size_bytes=EXCLUDED.size_bytes", [this.env.SHELL_STATE_TENANT, key, photo.object_key, photo.sha256, photo.media_type, photo.size_bytes]);
      await client.query("DELETE FROM mnemos_shell.text_kv WHERE tenant_id=$1 AND namespace='avatars' AND key=$2", [this.env.SHELL_STATE_TENANT, Buffer.from(key)]);
    });
  }
  async delete(key: string): Promise<void> {
    // Строка без адреса запрещает позднему запросу переноса вернуть снятое фото.
    await this.save(key, { object_key: null, sha256: null, media_type: null, size_bytes: null });
  }
}

/** Включённое серверное хранилище не возвращается к KV при сбое. */
export function avatarStorage(env: AvatarStateEnv, legacy: KVNamespace): AvatarStorage {
  if (env.SHELL_AVATAR_STATE_BACKEND === undefined) {
    return {
      get: async key => { const bytes = await legacy.get(key, "arrayBuffer"); return bytes === null ? null : new Uint8Array(bytes); },
      reference: async () => null,
      put: (key, value) => legacy.put(key, value), delete: key => legacy.delete(key),
    };
  }
  if (env.SHELL_STATE_BACKEND !== "postgres" || !env.SHELL_POSTGRES || !env.SHELL_STATE_TENANT) throw new Error("Не настроено хранилище изображений профиля");
  if (env.SHELL_AVATAR_STATE_BACKEND === "s3" && env.SHELL_AVATAR_S3_ENDPOINT && env.SHELL_AVATAR_S3_BUCKET && env.SHELL_AVATAR_S3_ACCESS_KEY && env.SHELL_AVATAR_S3_SECRET_KEY) return new S3Avatars(env);
  if (env.SHELL_AVATAR_STATE_BACKEND === "postgres") {
    const kv = new PostgresBinaryKv(env.SHELL_POSTGRES.connectionString, env.SHELL_STATE_TENANT, "avatars");
    return { get: key => kv.get(key), reference: async () => null, put: (key, value) => kv.put(key, value), delete: key => kv.delete(key) };
  }
  throw new Error("Не настроено S3-хранилище изображений профиля");
}
