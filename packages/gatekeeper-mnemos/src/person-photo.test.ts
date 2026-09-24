import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError, PERSON_PHOTO_MAX_BYTES } from "./mnemos-api.ts";

function client(reply: (url: string, init: RequestInit) => unknown) {
  const seen: { url: string; method: string; body: unknown }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(reply(url, init)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { api: new MnemosAPI("https://mnemos.example", async () => "token", fetcher), seen };
}

const photo = { principal_id: "anna", sha256_hex: "a".repeat(64), media_type: "image/jpeg", size_bytes: 9, updated_at: "2026-09-24T10:00:00Z", url: "https://objects.example/content/sha256/aa/aa/x", expires_at: "2026-09-24T10:15:00Z" };

test("фотографии людей: список проверяется, чужая ссылка не по https отвергается", async () => {
  const good = client(() => ({ photos: [photo] }));
  assert.deepEqual(await good.api.listPersonPhotos(), [photo]);
  assert.equal(good.seen[0]!.url, "https://mnemos.example/v1/people/photos");
  const bad = client(() => ({ photos: [{ ...photo, url: "javascript:alert(1)" }] }));
  await assert.rejects(bad.api.listPersonPhotos(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});

test("своя фотография: билет только до 512 КБ с суммой SHA-256, сохранение и снятие", async () => {
  const { api, seen } = client((url, init) => init.method === "POST" ? { upload_id: "up", url: "https://objects.example/s", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: "c", content_length: 9 } : init.method === "PUT" ? photo : { removed: true });
  const checksum = "A".repeat(43) + "=";
  assert.throws(() => api.beginPersonPhotoUpload(PERSON_PHOTO_MAX_BYTES + 1, checksum), MnemosAPIError);
  assert.throws(() => api.beginPersonPhotoUpload(0, checksum), MnemosAPIError);
  assert.throws(() => api.beginPersonPhotoUpload(9, "not-a-sum"), MnemosAPIError);
  await api.beginPersonPhotoUpload(9, checksum);
  assert.deepEqual(seen.at(-1), { url: "https://mnemos.example/v1/me/photo", method: "POST", body: { size_bytes: 9, checksum_sha256: checksum } });
  assert.deepEqual(await api.savePersonPhoto("up"), photo);
  assert.deepEqual(seen.at(-1), { url: "https://mnemos.example/v1/me/photo", method: "PUT", body: { upload_id: "up" } });
  await api.removePersonPhoto();
  assert.equal(seen.at(-1)!.url, "https://mnemos.example/v1/me/photo");
  await api.removePersonPhoto("boris");
  assert.deepEqual([seen.at(-1)!.url, seen.at(-1)!.method], ["https://mnemos.example/v1/people/boris/photo", "DELETE"]);
});
