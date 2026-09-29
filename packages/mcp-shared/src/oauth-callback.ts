import type { McpLog } from "./log.js";
import { shellReturnResponse, type ShellBrowserProof } from "@gadgets/workshop-shared/shell-browser";
import { errorPageHtml, htmlResponse, INVALID_LINK_HTML } from "./html.js";

type OAuthCallbackAccount = {
  acceptAuthCode(code: string, nonce: string, issuer?: string, proof?: ShellBrowserProof): Promise<string | false>;
};

/** Completes the shared browser callback for an MCP account OAuth flow. */
export async function handleOAuthCallback(
  url: URL,
  accountForId: (id: string) => OAuthCallbackAccount,
  log: McpLog,
  proof: ShellBrowserProof = {},
): Promise<Response> {
  const error = url.searchParams.get("error");
  if (error) {
    const detail = url.searchParams.get("error_description") ?? error;
    return htmlResponse(errorPageHtml(
      "Вход не выполнен", `${detail} Вернитесь на сайт и начните подключение снова.`), 400);
  }

  const state = url.searchParams.get("state") ?? "";
  const separator = state.indexOf(":");
  const code = url.searchParams.get("code");
  if (separator < 0 || !code) return htmlResponse(INVALID_LINK_HTML, 400);

  let account: OAuthCallbackAccount;
  try {
    account = accountForId(state.slice(0, separator));
  } catch {
    return htmlResponse(INVALID_LINK_HTML, 400);
  }

  let returnPath: string | false;
  try {
    returnPath = await account.acceptAuthCode(
      code, state.slice(separator + 1), url.searchParams.get("iss") ?? undefined, proof);
    if (!returnPath) return htmlResponse(INVALID_LINK_HTML, 400);
  } catch (err) {
    log.warn("oauth code exchange failed", { event: "connect.oauth.failed", error: err });
    return htmlResponse(errorPageHtml(
      "Не удалось завершить подключение", err instanceof Error ? err.message : String(err)), 502);
  }
  return shellReturnResponse(returnPath);
}
