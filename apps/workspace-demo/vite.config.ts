import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Source aliases, so the demo rebuilds on a library edit with no publish in
  // between — the same arrangement the playground uses.
  resolve: {
    alias: {
      "@gridwright/schema": pkg("schema"),
      "@gridwright/expr": pkg("expr"),
      "@gridwright/engine": pkg("engine"),
      "@gridwright/panels": pkg("panels"),
      "@gridwright/react": pkg("react"),
      "@gridwright/contracts": pkg("contracts"),
      "@gridwright/adapters": pkg("adapters"),
      "@gridwright/workspace": pkg("workspace"),
    },
  },
  // Relative asset URLs, so one build runs at a domain root, under a project
  // path, or straight off disk.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
