// Документ беседы через настоящий WebSocket (ADR 0003): по соединению беседы идут только описание
// файла, билет и место в Mnemos; сам файл браузер кладёт в хранилище мимо беседы. Старый путь байтами
// документ не принимает (это и отказы — модульными тестами __tests__/chat-documents.test.ts: отказ через
// соединение воркер считает необработанной ошибкой). Подключение Mnemos подделано на прототипе пользователя.
import {exports} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {newWebSocketRpcSession} from 'capnweb';
import type {PublicApi} from '@gadgets/workshop-shared/api';
import {UserDurableObject} from '../src/user';
import {afterEach, it, expect} from 'vitest';

// Подмена живёт на прототипе класса: после каждого теста возвращаются настоящие методы.
const METHODS = ['beginChatDocument', 'finishChatDocument', 'moveChatDocument', 'codeWorkTarget'] as const;
const ORIGINAL = Object.fromEntries(METHODS.map(m => [m, UserDurableObject.prototype[m]]));
afterEach(() => { for (const m of METHODS) (UserDurableObject.prototype as unknown as Record<string, unknown>)[m] = ORIGINAL[m]; });

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SIZE = 3 * 1024 * 1024;
const CHECKSUM = 'q'.repeat(43) + '=';

it('документ беседы: билет, узел в проекте или личном пространстве и перенос — без байтов по соединению беседы', async () => {
  const response = await exports.default.fetch(new Request('https://workshop.invalid/api', {headers: {Upgrade: 'websocket'}}));
  const socket = response.webSocket!;
  socket.accept();
  // Всё, что клиент отправил по соединению беседы, — чтобы доказать, что файла там нет.
  let sent = 0;
  const send = socket.send.bind(socket);
  socket.send = (message: string | ArrayBuffer | ArrayBufferView) => { sent += typeof message === 'string' ? message.length : message.byteLength; send(message); };
  using api = newWebSocketRpcSession<PublicApi>(socket);
  const name = 'docs' + crypto.randomUUID().replaceAll('-', '');
  const token = await api.createAccount(name, name, new Uint8Array([1, 2, 3]));
  using owner = await api.authenticate(token!);

  const calls: unknown[][] = [];
  const user = exports.UserDurableObject.getByName(name);
  await runInDurableObject(user, async instance => {
    instance['storage'].connectedAccounts.put({id: 3, vendorId: 'mnemos', description: {displayName: 'Учебная организация'}, account: {} as never});
    // RPC берёт методы с прототипа класса, а не с экземпляра.
    expect(Object.getPrototypeOf(instance)).toBe(UserDurableObject.prototype);
    const self = Object.getPrototypeOf(instance) as Record<string, unknown>;
    self.beginChatDocument = async (accountId: number | null, project: string | null, file: unknown) => {
      calls.push(['begin', accountId, project, file]);
      return {accountId: accountId ?? 7, project: project ?? 'p-personal', projectTitle: project ? '' : 'Личное пространство', personal: project === null,
        storageOrigin: 'https://storage.example',
        ticket: {upload_id: 'up-1', url: 'https://storage.example/staging/up-1?sig=1', method: 'PUT', checksum_header: 'x-amz-checksum-sha256',
          checksum_value: CHECKSUM, content_length: SIZE}};
    };
    self.finishChatDocument = async (accountId: number, project: string, request: string, upload: string, file: {name: string}) => {
      calls.push(['finish', accountId, project, request, upload, file]);
      return {resource: `node-${project}`, name: file.name, created: true};
    };
    self.codeWorkTarget = async (accountId: number, project: string) => accountId === 3 && project === 'project-a' ? {title: 'Проект А'} : null;
    self.moveChatDocument = async (accountId: number, project: string, node: string, target: string, request: string) => {
      calls.push(['move', accountId, project, node, target, request]);
      return {project: target, projectTitle: 'Склад', resource: 'moved-1', name: 'Отчёт.docx', notified: true};
    };
  });

  using workspace = await owner.newGadget();
  const context = {accountId: 3, projectId: 'project-a', title: 'Проект А'};

  // Беседы ещё нет: документ ложится в проект, выбранный для неё.
  const ticket = await workspace.beginChatDocumentUpload({name: 'Отчёт.docx', mimeType: DOCX, size: SIZE, checksum: CHECKSUM}, undefined,
    {accountId: 3, projectId: 'project-a'});
  expect(ticket.upload.url).toBe('https://storage.example/staging/up-1?sig=1');
  expect(ticket.storageOrigin).toBe('https://storage.example');
  expect(ticket.place).toEqual({projectTitle: 'Проект А', personal: false});
  expect(calls[0]).toEqual(['begin', 3, 'project-a', {name: 'Отчёт.docx', contentType: DOCX, size: SIZE, checksum: CHECKSUM}]);

  // Здесь браузер кладёт файл по ticket.upload.url — мимо беседы.
  const uploaded = await workspace.finishChatDocumentUpload(ticket.token);
  expect(uploaded.document).toEqual({accountId: 3, projectId: 'project-a', projectTitle: 'Проект А', personal: false,
    resource: 'node-project-a', name: 'Отчёт.docx', contentType: DOCX, size: SIZE});
  const finish = calls.find(c => c[0] === 'finish')!;
  expect(finish.slice(1, 3)).toEqual([3, 'project-a']);
  expect(finish[3]).toMatch(/^chat-[0-9a-f]{32}$/);
  expect(finish[4]).toBe('up-1');

  const chat = await workspace.newChat('Посмотри файл', null, undefined, [{id: uploaded.id}], undefined, context);
  const history = await workspace.getChatHistory(chat);
  const message = history.messages.findLast(m => m.type === 'message' && m.attachments?.length);
  const attachment = message?.type === 'message' ? message.attachments![0] : undefined;
  expect(attachment?.document?.resource).toBe('node-project-a');
  expect(attachment?.size).toBe(SIZE);
  expect(attachment?.content).toBeUndefined();

  // Хост пускает агента беседы читать только её вложения (ADR 0010), не другие узлы человека.
  const stub = exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString((await workspace.getMetadata()).id));
  type Grants = {impl: {authorizeChatDocument(caller: unknown, project: string, node: string, accountId: number): void}};
  const allowed = (project: string, node: string, chatId = chat, accountId = 3) => runInDurableObject(stub, (instance: unknown) => {
    try { (instance as Grants).impl.authorizeChatDocument({from: 'agent', chatId}, project, node, accountId); return true; } catch { return false; }
  });
  expect(await allowed('project-a', 'node-project-a')).toBe(true);
  expect(await allowed('project-a', 'node-other')).toBe(false);
  expect(await allowed('project-a', 'node-project-a', chat + 1000)).toBe(false);
  expect(await allowed('project-a', 'node-project-a', chat, 4)).toBe(false);

  const moved = await workspace.moveChatDocument(chat, uploaded.id, 'project-b');
  expect(moved).toMatchObject({projectId: 'project-b', projectTitle: 'Склад', personal: false, resource: 'moved-1'});
  const move = calls.find(c => c[0] === 'move')!;
  expect(move.slice(1, 5)).toEqual([3, 'project-a', 'node-project-a', 'project-b']);
  expect(move[5]).toMatch(/^move-/);
  // После переноса разрешено новое место, прежнее — нет.
  expect(await allowed('project-b', 'moved-1')).toBe(true);
  expect(await allowed('project-a', 'node-project-a')).toBe(false);
  // История показывает новое место: запись вложения обновлена, сообщение истории — нет.
  const after = await workspace.getChatHistory(chat);
  const again = after.messages.findLast(m => m.type === 'message' && m.attachments?.length);
  expect(again?.type === 'message' ? again.attachments![0].document?.projectId : undefined).toBe('project-b');

  // Без проекта беседы и без выбранного проекта документ ложится в личное пространство.
  const personal = await workspace.beginChatDocumentUpload({name: 'заметки.md', mimeType: '', size: SIZE, checksum: CHECKSUM});
  expect(calls.findLast(c => c[0] === 'begin')!.slice(1, 3)).toEqual([null, null]);
  expect(personal.place).toEqual({projectTitle: 'Личное пространство', personal: true});
  const note = await workspace.finishChatDocumentUpload(personal.token);
  expect(note.document).toMatchObject({accountId: 7, projectId: 'p-personal', personal: true, contentType: 'text/markdown', name: 'заметки.md'});

  // Файлы не проходили через соединение беседы: всё отправленное клиентом меньше одного файла.
  expect(sent).toBeLessThan(SIZE / 10);
});
