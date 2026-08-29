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
  build: { outDir: "dist", emptyOutDir: true },
});
