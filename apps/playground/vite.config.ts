import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Source aliases so the playground rebuilds on a library edit without a
  // publish step in between.
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
  // The examples are served straight out of examples/ rather than copied into
  // a public/ folder. The copies had already drifted — the one the playground
  // served was three days behind the one the tests and the CLI validate — and
  // a second source of truth for a file nobody edits twice is a bug waiting.
  publicDir: fileURLToPath(new URL("../../examples", import.meta.url)),
  build: { outDir: "dist", emptyOutDir: true },
});
