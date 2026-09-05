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
      "@gridwright/bridge": pkg("bridge"),
      "@gridwright/panels": pkg("panels"),
      "@gridwright/react": pkg("react"),
      "@gridwright/builder": pkg("builder"),
      "gridwright": pkg("cli"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Component tests opt into a DOM; everything else stays on node, which is
    // both faster and a check that the core packages carry no DOM assumptions.
    environmentMatchGlobs: [["packages/{react,panels,builder}/test/**", "jsdom"]],
  },
});
