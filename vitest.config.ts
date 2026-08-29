import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@gridwright/schema": pkg("schema"),
      "@gridwright/expr": pkg("expr"),
      "@gridwright/engine": pkg("engine"),
      "@gridwright/panels": pkg("panels"),
      "@gridwright/react": pkg("react"),
      "@gridwright/builder": pkg("builder"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    environment: "node",
  },
});
