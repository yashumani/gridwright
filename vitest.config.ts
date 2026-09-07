import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@yashumani/gridwright-schema": pkg("schema"),
      "@yashumani/gridwright-expr": pkg("expr"),
      "@yashumani/gridwright-engine": pkg("engine"),
      "@yashumani/gridwright-bridge": pkg("bridge"),
      "@yashumani/gridwright-panels": pkg("panels"),
      "@yashumani/gridwright-react": pkg("react"),
      "@yashumani/gridwright-builder": pkg("builder"),
      "gridwright": pkg("cli"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx", "scripts/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Component tests opt into a DOM; everything else stays on node, which is
    // both faster and a check that the core packages carry no DOM assumptions.
    environmentMatchGlobs: [["packages/{react,panels,builder,workspace}/test/**", "jsdom"]],
  },
});
