# Mnemos в CloudflareOS — API для согласования

Контракт `src/types.d.ts` предложен для ревью, реализации Worker пока нет.
Новая точка входа не создаётся: экран предоставляется через `startAppUi` и
открывается оболочкой по `/gatekeepers/mnemos`, как существующие встроенные приложения.

Выдаваемые ресурсы: проект (`MnemosProject`) либо отдельный документ
(`MnemosDocument`). Ссылка на документ не позволяет перейти к соседнему документу
или получить возможность публикации всего проекта. Работа с черновиком доступна
в рамках проекта; допустимые узлы и режимы ограничиваются выданными правами.
Общего объекта для произвольного tenant/user/agent нет.

Идентичность определяется подключённой учётной записью Mnemos и делегированием
сессии. Нельзя выводить права Mnemos из имени пользователя CloudflareOS или
использовать общий административный токен в браузере. Способ подключения
учётной записи и выпуска делегированной сессии требуется реализовать отдельно:
существующий API Mnemos уже проверяет подписанный токен пользователя/агента,
но обмен с сессией CloudflareOS ещё не подключён.

Человеческий экран использует персональную UI-capability. Агентский доступ
проходит существующие authorizeObservation/submitAction/applyAction и проверку
наблюдателей; запись не исполняется в обход очереди. Объекты RPC освобождаются
при закрытии экрана или смене сессии. Бинарные тела идут напрямую в S3.

Сопоставление с Mnemos: read/search/download/history и все операции draft уже
имеют серверную реализацию. state() требует отдельного чтения общей головы.
Устойчивые повторы записи, подключение/обновление токенов, observer-проверки
и симуляция ожидающих действий ещё не реализованы. Это не готовый коннектор.
Администрирование пользователей/прав, приёмная и создание документов остаются
в общей области работ; контракт их экранов будет добавлен до подключения этих
экранов, а не заменён сторонней панелью.

Основание формы RPC: объектные возможности Cap'n Web, README проекта
https://github.com/cloudflare/capnweb (локальная зависимость ещё не установлена).

## Уточнение человеческой сессии и согласия OAuth

Проверено по workshop-backend: `AuthenticatedApiImpl` содержит проверенный
`UserDurableObject`; `startAccountAppUi` выбирает account из connectedAccounts
этого пользователя. Передаваемый AppUiContext содержит административный флаг,
но не удостоверение личности Mnemos. `isAdmin` не даёт права подписать произвольного
владельца Mnemos. Привязку нужно хранить на стороне персонального account:
проверенный внешний субъект + явно связанный человеческий principal Mnemos.
Сырые email/tenant/user из параметров iframe не участвуют в выборе владельца.

Предлагаемая UI-capability для первого подключения внешнего агента:

- `readAgentConsent(requestId)` — читает только сохранённую заявку в тенанте
  персональной связи, возвращает название/ID клиента, ресурс, scopes и срок.
- `decideAgentConsent(requestId, decision)` — `approve` создаёт новую внешнюю
  связь без грантов, `deny` погашает заявку. Решение связано с той же проверенной
  сессией и ранее показанной заявкой; повтор не выдаёт второй код.
- Код/ошибка OAuth передаются зарегистрированному callback доверенным host,
  не выдаются компоненту как токен или произвольный URL перехода.

Смена пользователя/закрытие UI инвалидирует capability. Персональная связь
Mnemos не передаётся gadget/агенту, а предоставление агенту ресурсов остаётся
через узкие MnemosProject/MnemosDocument. Managed AgenticOS — отдельный путь
выдачи; внешние Claude Code/Codex подключаются без AgenticOS.

Это уточнение API для согласования, не реализация Worker. Требуется решение
оператора по контракту перед Step 4 write-gatekeeper.

Контракт подтверждён оператором 2026-09-07 через разрешённый Telegram-канал:
«Да, реализуй» (сообщение 287, ответ на разъяснение пунктов интеграции).
Ревью Step 3 пройдено, разрешён переход к реализации по этому контракту.
Это не разрешение на публикацию/деплой и не утверждение готовности коннектора.

Начат серверный transport `src/mnemos-api.ts`: заданный HTTPS origin,
персональный credential provider на каждый запрос, ручной отказ redirect,
таймаут 20 с, ограничение JSON-ответа 1 МиБ и статические ошибки. Реализованы
list/revoke подключений и история документа; этот объект не выдаётся как UI RPC.
Три проверки node:test прошли (0,136 с), strict TypeScript прошёл. Зависимости
workspace установлены pnpm 11.17.0 из существующего lockfile; lockfile не изменён.
Worker/персональный account/UI-capability ещё предстоит собрать поверх клиента.

`account-session.ts` добавляет внутренний помощник персонального account:
хранение credential/generation через синхронный KV-интерфейс DurableObject,
проверка человеческого токена через каталог Mnemos до сохранения, tombstone
при отключении и защита от гонки отключения с завершением проверки credential.
Открытая сессия проверяет generation до и после запроса; dispose отменяет её
запросы. Контроллер показывает только list/revoke и не отдаёт токен.
Шесть тестов вместе с транспортом — PASS 0,130 с, strict TypeScript PASS.
Это внутренний контроллер, ещё не RpcTarget/Worker. `connect(token)` разрешено
вызывать только из доверенного серверного завершения связи, не из iframe.

Добавлены UserAccount DurableObject и MnemosManagementSession RpcTarget:
внутренняя серверная приёмка проверенного credential, выдача персональной
возможности list/revoke, отзыв account и dispose сессии. HTTP пока возвращает
404; серверная приёмка токена не выставлена в браузер. Требуется операторский
MNEMOS_API_ORIGIN для аккаунта; автоматическая связь/nonce-flow ещё не реализованы.
Пакет зарегистрирован в pnpm workspace (lockfile: только новый пустой importer).
`pnpm --dir packages/gatekeeper-mnemos run build` прошёл: типы настоящего runtime,
TypeScript и wrangler dry-run, bundle 6,81 КиБ. Шесть тестов PASS 0,132 с.
Работа самого DO в workerd пока не проверена; деплоя и service binding нет.
Следующие шаги: GatekeeperVendor, доверенный connect flow, startAppUi и ресурсы.

Добавлена проверка настоящего workerd через Miniflare версии, уже закреплённой
Wrangler в lockfile. `pnpm run test:worker` сначала собирает актуальный bundle,
затем проверяет DO RPC: приёмку credential, чтение через отдельную сессию,
отказ старой/новой сессии после revoke и отсутствие публичной HTTP-двери.
Тест нашёл реальный сбой: сохранённый fetch вызывался с this клиента вместо
глобального контекста Workers. Исправлено через bind(globalThis).
Runtime-тест PASS 0,326 с, шесть обычных тестов PASS 0,128 с; dry-run PASS.
Upstream Mnemos в этом тесте — изолированный HTTP-двойник, не рабочая установка.

Добавлен app/main.ts и сборка самодостаточного HTML: handshake MessagePort как
в Context Library, тема оболочки, список/пагинация и подтверждённый отзыв, блокировка
повторного нажатия и очистка данных после ошибки. UserAccount.startAppUi возвращает
HTML и персональную RPC-сессию. Реальный runtime-тест теперь получает этот frame,
читает через frame.ui и проверяет запрет внутреннего acceptVerifiedCredential.
TypeScript Worker/app, bundle и runtime PASS 0,325 с. Визуальная проверка браузера
пока не проведена. В навигацию приложения ещё не включено: нет GatekeeperUser/
Vendor и доверенного connect flow. React-компоненты Mnemos остаются отдельным
пакетом; этот экран использует нативный MessagePort-контракт CloudflareOS.

`pnpm run test:app` пересобирает HTML и запускает его в DOM-стенде с настоящим
MessagePort/Cap'n Web. Проверены загрузка списка через host.ui, явное подтверждение
отзыва, единственный вызов при двойном клике, обновление состояния, тема и вывод
имени агента как текста. PASS 0,221 с. Стенд воспроизводит getter host.ui как
в SandboxedGatekeeperApp; использует Node Web API для отсутствующих в jsdom
Streams/Fetch классов. Это не визуальная проверка в настоящем браузере.

Экран расширен контекстом человека и перечнем доступных проектов. whoAmI и
listProjects проходят персональный MnemosAPI и проверку поколения сессии до/
после запроса; whoAmI дополнительно отвергает агентскую личность. UI выводит
организацию/пользователя/проекты текстом, очищает их при ошибке. Проверены
собранный iframe (0,222 с) и вызовы через настоящий DO/RPC к HTTP-двойнику.
Пока это список проектов: открытие документа/редактирование ещё не подключены.

Проекты открывают постраничный список разрешённых узлов через Browse Mnemos;
файл открывает опубликованный текст (не более 256 КиБ) через Read. Персональная
сессия проверяет поколение до/после чтения и совпадение node_id ответа. UI
показывает признаки частичного дерева/текста и выводит содержимое через textContent.
Путь проект → документ проверен через собранный iframe/MessagePort (0,235 с)
и настоящий Worker RPC к изолированному upstream (0,335 с). Типы/dry-run PASS.
Это чтение: редактирование/публикация и реальное подключение в оболочке впереди.

HTML теперь задаёт CSP: собранный скрипт разрешён по SHA-256, прямые сетевые
запросы и непредусмотренные скрипты запрещены. Это сохраняет изоляцию iframe
CloudflareOS: все обращения к Mnemos идут через персональную host.ui RPC-сессию.
`pnpm run test:browser` пересобирает экран и проверяет в настоящем headless Chrome
работу MessagePort RPC, блокировку fetch и постороннего inline-скрипта. Тест
использует временный профиль и завершает только собственную группу процессов
после получения DOM-доказательств; таймаут считается ошибкой. Проверка занимает
около секунды и запускается отдельно от обычных быстрых тестов. По умолчанию
используется Google Chrome из /Applications на macOS; для другой установки
задайте CHROME_BINARY абсолютным путём к Chrome/Chromium.
Редактирование пока отсутствует: загрузку содержимого нужно провести через
доверенный интерфейс оболочки, поскольку iframe не может напрямую обращаться
к presigned S3 URL. ADR 0003 Mnemos требует прямой передачи клиент → S3 без
проксирования тел через storage-api/gRPC; новый путь должен сохранить это правило.

Добавлен доверенный канал GatekeeperUiFrame.textUploads: при настроенном
MNEMOS_STORAGE_ORIGIN startAppUi возвращает отдельный issuer только для оболочки.
Issuer принимает project/размер/checksum и вызывает POST /v1/uploads с credential
текущей персональной сессии; тело файла не идёт через Worker/storage-api.
SandboxedGatekeeperApp.uploadText передаёт текст прямо в S3, не открывая iframe
доступ к issuer/URL. Смена/закрытие frame отменяет передачу и освобождает issuer;
одновременно допускается одна передача. Страница освобождает исходный issuer,
хост — свою dup-ссылку. После revoke выдача тикета отвергается.
Настоящий workerd проверяет отдельный issuer, HTTP metadata и revoke: PASS
0,481 с с запуском тестового процесса. Frontend типы PASS, 4 проверки upload/
существующего host handshake PASS 0,338 с. Вызов uploadText через iframe пока
отдельно не проверен; кнопка редактора и SaveDraft ещё не подключены.

Добавлен textDownloads issuer и host.downloadText: личная версия/сторона,
точная длина/SHA-256/UTF-8, повторная проверка прав и head перед возвратом текста.
После revoke или смены head поздний текст не выдаётся iframe. Worker PASS
0,468 с, frontend host/целостность PASS 0,482 с; сборка и типы прошли.
Кнопки редактора/сохранения/публикации пока не подключены.

В app/main.ts собран первый текстовый редактор личного черновика:
openDraft → readDraftDocument → host.downloadText → textarea → host.uploadText
→ saveDraftDocument(expected_head). Поддержаны текстовые форматы и 256 КиБ,
строгий UTF-8 проверяет host; опубликованный усечённый Read не используется как
исходник редактора. Конфликт требует явного выбора присутствующей стороны;
отсутствие документа не превращается автоматически в пустой текст.
Публикация отдельно считывает обе головы, требует сохранённого текста и явного
подтверждения всех изменений личного проекта, а не только текущего документа.
Busy предотвращает двойные записи; неизвестный исход save/publish выключает
повтор, оставляет текст для копирования и предлагает заново открыть состояние.
Закрытие с несохранённым текстом подтверждается, beforeunload выставляет guard.
Собранный iframe/реальный MessagePort с тестовым API: happy path, двойной клик,
неизвестный save, выбор стороны конфликта PASS 0,379 с. Типы app/Worker PASS.
Это тестовый сквозной UI; настоящий Mnemos/S3/CORS и доверенный вход ещё не
соединены. Следующий приоритет — проверить реальную передачу/сохранение и
подключить GatekeeperUser/Vendor/вход в оболочке; не считать платформу готовой.

В gatekeeper добавлен внутренний LoginFlow: persistent starting/waiting/consuming/
finished, фиксированные HTTPS endpoints и callback из конфигурации, IAM state/
nonce, PKCE S256, server-side Basic code exchange, затем защищённый IAM credential
exchange. Секреты не входят в authorize URL; ответы ограничены 128 КиБ, запросы
20 с, redirect запрещён. Consume фиксируется до сети, отмена меняет generation,
поздний ответ не восстанавливает заявку, proof/verifier очищаются после исхода.
11 Node-тестов PASS 0,144 с, Worker/app types PASS. Пока контроллер не включён
в UserAccount HTTP callback: следующий шаг — доверенный callback capability,
одноразовый initiation nonce, привязка неизменяемого владельца и GatekeeperUser.
Проверки используют тестовые provider/IAM; реальный OIDC ещё не пройден.

### Internal human login integration

`UserAccount.beginLogin()` and `completeLogin(state, code)` now connect the persisted
OIDC/PKCE flow to the account's verified human credential. They are trusted internal
RPC methods; the iframe management capability does not expose them. Configure
`MNEMOS_LOGIN_CONFIG` as a **secret JSON binding** containing the `LoginConfig` fields
in `src/login-flow.ts`; do not commit provider or IAM client secrets in Wrangler vars.
The callback URL is operator configuration, never a browser-supplied redirect.

Account ownership (tenant/user) is immutable across reconnects. Credentials expire
locally at the IAM exchange deadline, at most 15 minutes. Revocation cancels pending
login and fences both the exchange and the subsequent identity probe. Worker fetch
uses manual redirects and rejects non-2xx responses without following Location.

Vendor/User capabilities and the trusted Workshop callback are implemented.
The vendor declares a human account UI, making it discoverable without agent resources.
Actual operator configuration and the live Workshop/OIDC flow remain to be verified.
The browser endpoints and initiation nonce routing are implemented below. No live configuration or deployment was changed.
The real workerd tests use simulated provider/IAM HTTP responses, not a live OIDC provider.


The configured `callbackUrl` handles the provider's GET callback. A trusted account
capability must first call `prepareBrowserLogin()` to obtain a nonce; opening
`<callbackUrl>/start/<account DO id>/<nonce>` consumes it and sets a separate
`__Host-mnemos-login` HttpOnly/Secure/SameSite=Lax cookie before redirecting to the
provider. Callback requires that cookie, exactly one state/code pair, and the
persisted login state. Both nonce stages expire after five minutes and are consumed
once. Wrong origins, duplicate cookies/query arguments, and body-based callbacks
are rejected. No credential/identity/account id is accepted from callback query data.
An account alarm clears unfinished browser/login proofs. A single cookie intentionally
allows one pending Mnemos login per browser/origin; starting another replaces it.

Real Worker coverage now includes public initiation → cookie → callback → identity,
missing-cookie refusal and replay refusal. The Worker test also exercises a persisted Workshop-style callback and account
capability, but the real Workshop instance is not yet configured with this connector.


### Workshop account handoff

`GatekeeperVendor.connectAccount(callback, options)` creates a fresh account and
retains the trusted callback. After the HTTP login, the account calls
`callback.complete(GatekeeperUserImpl, expiresAt)`; reconnect calls
`credentialsRestored(expiresAt)` without creating another account. The declared
expiry is the actual non-refreshable IAM credential deadline. The human account
provides the existing Mnemos management UI. It does not provide a verified login
email or an ambient agent singleton. Revocation deletes the callback and invalidates
existing sessions; a callback failure after persisting a capability also invalidates
its underlying credential. Abandoned logins discard their pending callback.

Like the other OAuth connectors, the Worker needs `allow_irrevocable_stub_storage`
to persist Workshop callback capabilities. Revocation is enforced by account/session
state rather than by destroying persistent RPC references. The real Worker test
covers callback persistence, description and UI reads through the saved account,
reconnect, revoke, and a callback interrupted after saving the account capability.

Agent resource methods currently reject requests, and the vendor advertises no
agent resource types. `VendorDescription.providesAccountUi` now explicitly keeps
human UI connectors discoverable without them. This declaration neither provisions
an account nor grants agent access; the admin vendor-disable switch still applies.
The approved project/document agent resources remain outstanding independently of
the first human workflow.


### Installation and development

Package discovery in `run-dev-server.js` already adds the vendor RPC binding and
router binding for `gatekeeper-mnemos`; no static duplicate binding is needed.
`deploy-inputs.json` defines the API origin, storage origin and secret login JSON
instead of the generic OAuth CLIENT_ID/CLIENT_SECRET defaults. Set callbackUrl to
`https://<workshop-host>/gatekeeper/mnemos/oauth` and register that exact URI with
the OIDC provider. Both Mnemos origins must be HTTPS origins without a path prefix.
For local development, keep actual settings in the package's private `.dev.vars`.
Do not put the login JSON in committed Wrangler vars.

The app build supports `--watch`, as expected by the dev launcher. Account
subscription updates refresh the Workshop app navigation when a human UI account
arrives through OAuth or is disconnected. Checked: backend types, targeted vendor
discovery test in workerd, frontend types, Worker login tests, built iframe test,
watcher startup and installation manifest generation. No existing service was
restarted, and no live provider credentials were installed or deployment performed.


### IMAP-почта в CloudflareOS

В приложении Mnemos откройте «Аккаунты почты Яндекс / iCloud / IMAP», выберите сервис, введите логин, пароль приложения и папку (по умолчанию INBOX). Подключение проверяет папку без скачивания тел писем. Затем в общей форме «Подключить почту к Mnemos» выберите этот аккаунт Mnemos как источник и получателя, папку и проект. Чтение конкретному агенту выдаётся отдельно через «Доступ к почте».

Пароль хранится только в закрытом состоянии аккаунта владельца. Удаление папки-аккаунта и полное отключение Mnemos удаляют пароль; старые источники блокируются по поколению и эпохе владельца. Показаны последние 1–10 писем выбранной папки. Отправка необязательна: при подключении можно отдельно задать SMTP-учётные данные и фиксированный адрес отправителя. Агент предлагает письмо; человек видит адресатов, тему и текст, согласовывает и отдельно отправляет. Используются TLS или STARTTLS; после неопределённого результата автоматической повторной отправки нет. Принятие письма SMTP-сервером не доказывает доставку в ящик адресата.

Встроены imap.yandex.ru:993 и imap.mail.me.com:993. Корпоративные назначения задаются оператором в `MNEMOS_IMAP_SERVERS`, например:

```json
[{"id":"corp-team","title":"Корпоративная почта","host":"imap.example.com","port":993}]
```

Хост не принимается из агентского вызова или пользовательской формы. Используется только implicit TLS с проверкой сертификата; серверы, доступные лишь по STARTTLS или в недоступной Worker частной сети, этим транспортом не покрыты. Локальный launcher Mnemos читает тот же список из приватного `imap-servers.json`.

Проверки: локальный TLS-протокол, изоляция владельцев и отзыв, форма с потерянным ответом, перенос папки в пределах одного аккаунта и политика ресурсов. Настоящий внешний ящик и сквозное чтение агентом ещё не проверены. Источники настроек: [Apple](https://support.apple.com/en-us/102525), [Яндекс](https://www.yandex.ru/support/yandex-360/customers/mail/ru/mail-clients/others).

SMTP-транспорт проверен через производственный `cloudflare:sockets` внутри настоящего локального Worker: TLS/STARTTLS, точные адресат/тема/текст, запрет до согласования, отсутствие повтора после перезапуска и потери серверного подтверждения. Запуск: `pnpm exec node --test __tests__/smtp-worker.test.mjs` из пакета (около0,5с). Сервер тестовый, CA задан только тестовому runtime; реальное внешнее подключение и доставка ещё не приняты.


### Operator-defined organization login profiles

An optional secret `MNEMOS_LOGIN_PROFILES` binding contains up to20 additional
profiles: `{id,name,config,apiOrigin?,storageOrigin?}`. `config` has the same fields
as `MNEMOS_LOGIN_CONFIG`; every profile must use the same configured callback URL.
API/storage origins, when present, must be exact HTTPS origins. Omitted origins
use the primary bindings. Each IAM/API pair must accept that organization's
credentials; the connector does not relax either service's tenant restriction.

New connections show only the operator's profile names. Browser input selects an
ID and cannot provide endpoints or secrets. The selection is retained for reconnect;
existing accounts remain on the default profile. Removing a selected profile makes
its connection unavailable instead of silently switching organization. The local
runner accepts private `login-profiles.json` alongside `login.json`.

Live acceptance currently covers selection/OIDC, organization identity, metrics
and reconnect for two local organizations. Other workflows on secondary profiles,
including external Telegram channel routing, require their own acceptance.
