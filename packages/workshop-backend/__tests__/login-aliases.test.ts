import { expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { UserDurableObject } from '../src/user.js';
import { signInViaGatekeeper } from '../src/auth/login-flow.js';
import { parseLoginAliases } from '../src/auth/login-aliases.js';
import { handleServiceRoute } from '../src/auth/service-route.js';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_USER: DurableObjectNamespace<UserDurableObject>; }
}

const OWNER = 'owner@example.ru';
const ALIASES = JSON.stringify({ 'Owner@Example.ru': 'admin' });

// Учётную запись admin заводит первый же тест, которому она нужна: при перемешанном порядке это
// может быть любой из них, а повторно она не заводится.
let seeded: Promise<DurableObjectStub<UserDurableObject>> | undefined;
function seedAdmin() {
  return seeded ??= createAdmin();
}

async function createAdmin() {
  const admin = env.TEST_USER.get(env.TEST_USER.idFromName('admin'));
  expect(await admin.createAccount('admin', 'Владелец', new Uint8Array(32).fill(7))).toBeTypeOf('string');
  await runInDurableObject(admin, async instance => {
    const storage = (instance as unknown as { storage: { gadgets: { put(r: unknown): void } } }).storage;
    storage.gadgets.put({ id: 'chat-1', title: 'Беседа владельца', created: new Date(), lastActive: new Date() });
  });
  return admin;
}

it('привязанная почта входит в существующую учётную запись с беседами, новая не заводится', async () => {
  const admin = await seedAdmin();
  const before = await admin.accountSummary();
  expect(before).toEqual({ exists: true, gadgets: 1, connectedAccounts: 0 });

  let linkedTo: string | undefined;
  const token = await signInViaGatekeeper(env.TEST_USER, { LOGIN_ALIASES: ALIASES }, OWNER, 'mnemos', false,
    async stub => { linkedTo = stub.id.toString(); });
  expect(token?.startsWith('admin:')).toBe(true);
  expect(linkedTo).toBe(env.TEST_USER.idFromName('admin').toString());
  // Токен сессии принимает именно учётная запись admin.
  await admin.authenticate(token!.slice('admin:'.length));
  expect(await admin.whoami()).toMatchObject({ id: 'admin', name: 'Владелец' });
  expect((await admin.accountSummary()).gadgets).toBe(1);
  // Учётной записи по почте не появилось.
  expect(await env.TEST_USER.get(env.TEST_USER.idFromName(OWNER)).whoamiIfExists()).toBeNull();
});

it('привязка к несуществующей учётной записи не заводит пустую вместо неё', async () => {
  const token = await signInViaGatekeeper(env.TEST_USER, { LOGIN_ALIASES: JSON.stringify({ [OWNER]: 'nobody' }) },
    OWNER, 'mnemos', true, async () => {});
  expect(token).toBeNull();
  expect(await env.TEST_USER.get(env.TEST_USER.idFromName('nobody')).whoamiIfExists()).toBeNull();
});

it('без привязки сотрудник входит в учётную запись по своей почте', async () => {
  const token = await signInViaGatekeeper(env.TEST_USER, { LOGIN_ALIASES: ALIASES }, 'anna@example.ru', 'mnemos', false, async () => {});
  expect(token?.startsWith('anna@example.ru:')).toBe(true);
});

it('привязка принимает только почту → имя учётной записи с паролем', () => {
  expect(parseLoginAliases(ALIASES).get(OWNER)).toBe('admin');
  expect(() => parseLoginAliases(JSON.stringify({ [OWNER]: 'other@example.ru' }))).toThrow();
  expect(() => parseLoginAliases(JSON.stringify({ admin: 'admin' }))).toThrow();
  expect(() => parseLoginAliases('[]')).toThrow();
});

it('служебный маршрут закрыт без токена и отвечает сводкой по почте', async () => {
  const admin = await seedAdmin();
  const deps = (token?: string) => ({ token, aliases: ALIASES, summary: (name: string) => env.TEST_USER.get(env.TEST_USER.idFromName(name)).accountSummary() });
  const request = (query: string, auth?: string) => new Request('https://h.test/__service/shell-account?' + query, auth ? { headers: { Authorization: auth } } : {});
  const token = 't'.repeat(40);
  expect((await handleServiceRoute(request('name=admin', 'Bearer ' + token), deps(undefined))).status).toBe(404);
  expect((await handleServiceRoute(request('name=admin'), deps(token))).status).toBe(401);
  expect((await handleServiceRoute(request('name=admin', 'Bearer ' + 'x'.repeat(40)), deps(token))).status).toBe(401);
  const response = await handleServiceRoute(request('email=' + encodeURIComponent(OWNER), 'Bearer ' + token), deps(token));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ name: 'admin', aliased: true, ...(await admin.accountSummary()) });
});
