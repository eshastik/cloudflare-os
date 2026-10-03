import type { PostgresStateEnv } from "@gadgets/backend-utils/postgres-text-kv";
// Project-specific Env/ctx.exports augmentation for Wrangler's generated types.

declare global {
  namespace Cloudflare {
    interface Env extends PostgresStateEnv {
      // Public-collections snapshot KV.
      CONTEXT_COLLECTIONS: KVNamespace;
      // Optional Git-compatible backing repos for artifact-backed context collections.
      ARTIFACTS?: Artifacts;
    }

    interface GlobalProps {
      // Populates Cloudflare.Exports, the type of ctx.exports.
      mainModule: typeof import("./index.js");
      // Storage classes exposed as DO namespaces on ctx.exports.
      durableNamespaces:
        | "ContextCollectionDurableObject"
        | "UserLibraryDurableObject"
        | "LibraryRegistryDurableObject"
        | "ContextGatekeeper";
    }
  }

}
