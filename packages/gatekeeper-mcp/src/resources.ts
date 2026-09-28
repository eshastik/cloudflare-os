import type { SupportedResource } from "@gadgets/workshop-shared/gatekeeper";

const DESCRIPTION =
  "MCP-адрес, который вы указываете. Инструменты находятся автоматически, запись требует подтверждения.";

const HTTPS_RESOURCE: SupportedResource = {
  urlPattern: "https://*",
  title: "Любой MCP-сервер",
  description: DESCRIPTION,
};

const HTTP_RESOURCE: SupportedResource = { ...HTTPS_RESOURCE, urlPattern: "http://*" };

export function mcpResources(allowInsecure: boolean): SupportedResource[] {
  return allowInsecure ? [HTTPS_RESOURCE, HTTP_RESOURCE] : [HTTPS_RESOURCE];
}

export function mcpResourceFor(endpoint: string): SupportedResource {
  return new URL(endpoint).protocol === "http:" ? HTTP_RESOURCE : HTTPS_RESOURCE;
}
