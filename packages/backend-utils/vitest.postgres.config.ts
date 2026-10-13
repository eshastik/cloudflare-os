import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["__tests__/postgres-state.node.ts"], environment: "node", testTimeout: 100 } });
