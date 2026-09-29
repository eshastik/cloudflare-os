// The one page this gatekeeper serves that asks the user something: which MCP server to connect.
// Lives here rather than in `@gadgets/mcp-shared/html` because the gateway connector, whose endpoint
// is a deployment setting, has no equivalent page.

import { escapeHtml, PAGE_STYLE } from "@gadgets/mcp-shared/html";

// Form controls, on top of the palette and page frame every connect page shares.
const FORM_STYLE = `
  label { display: block; font-size: 14px; font-weight: 600; color: var(--strong); margin: 0 0 6px; }
  p.hint { margin: 6px 0 0; font-size: 13px; color: var(--subtle); }

  input[type=url] { width: 100%; box-sizing: border-box; padding: 9px 11px; font: inherit;
                    background: var(--control); color: var(--text);
                    border: 1px solid var(--line); border-radius: 8px; }
  input[type=url]::placeholder { color: var(--subtle); }
  input[type=url]:focus { outline: 0; border-color: var(--brand);
                          box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent); }

  button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 8px;
           background: var(--contrast); color: var(--on-contrast); font: inherit; font-weight: 600;
           cursor: pointer; }
  button:hover { opacity: .9; }
`;

// Renders the endpoint prompt shown when the user starts connecting.
export function connectFormHtml(path: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Подключение сервера MCP</title><style>${PAGE_STYLE}${FORM_STYLE}</style></head>
<body><main>
  <h1>Подключение сервера MCP</h1>
  <p class="sub">Мы узнаем, какие инструменты есть у сервера, и, если он требует входа, проведём
  вас через вход.</p>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
  <form method="POST" action="${escapeHtml(path)}">
    <label for="url">Адрес сервера</label>
    <input id="url" type="url" name="url" placeholder="https://example.com/mcp" required autofocus>
    <p class="hint">Подключайте только сервер, которому доверяете. Сервер сам помечает, какие
    инструменты выполняются сразу, а какие ждут вашего подтверждения, и эти пометки надёжны
    ровно настолько, насколько надёжен сам сервер.</p>
    <button type="submit">Продолжить</button>
  </form>
</main></body></html>`;
}
