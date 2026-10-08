/** Pack real distributables and use them outside the workspace/source aliases. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const runner = process.env.npm_execpath;
assert(runner, "Run with pnpm verify:consumer so packing uses pnpm's workspace rewriting");
const out = resolve(".release/packages");
mkdirSync(out, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), "gridwright-consumer-"));
const run = (args, cwd = root) => execFileSync(process.execPath, [runner, ...args], {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const dependencies = {};
const packages = [];
for (const dir of readdirSync("packages")) {
  const manifest = JSON.parse(readFileSync(join("packages", dir, "package.json"), "utf8"));
  run(["--dir", join(root, "packages", dir), "pack", "--pack-destination", out]);
  const filename = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  const archive = join(out, filename);
  dependencies[manifest.name] = `file:${archive.replaceAll("\\", "/")}`;
  packages.push({ name: manifest.name, version: manifest.version, filename,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex") });
}

// All internal packages are supplied together; none may fall back to an npm
// package with a similar name. The consumer has no workspace or source aliases.
writeFileSync(join(consumer, "package.json"), JSON.stringify({
  private: true, type: "module", dependencies: { ...dependencies, react: "19.3.0", "react-dom": "19.3.0" },
  devDependencies: { typescript: "7.0.2", "@types/react": "19.3.0", "@types/react-dom": "19.3.0", vite: "5.4.21" },
}, null, 2));
run(["exec", "npm", "install", "--ignore-scripts", "--cache", join(tmpdir(), "gridwright-npm-cache")], consumer);

for (const pkg of packages) {
  const installed = join(consumer, "node_modules", pkg.name);
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);
  assert(!JSON.stringify(manifest).includes("workspace:"), `${pkg.name}: unresolved workspace dependency`);
  for (const file of ["LICENSE", "README.md", manifest.main, manifest.types]) {
    assert(existsSync(join(installed, file)), `${pkg.name}: missing ${file}`);
  }
  for (const entry of Object.values(manifest.exports ?? {})) {
    assert(existsSync(join(installed, entry.default)), `${pkg.name}: missing exported JavaScript`);
    assert(existsSync(join(installed, entry.types)), `${pkg.name}: missing exported types`);
  }
}

const manifestText = `gridwright: 1
title: Consumer acceptance
source: { kind: file, files: [{ id: sales, path: ./sales.csv }] }
model:
  fields: [{ name: region, type: string, from: sales.region }, { name: amount, type: number, from: sales.amount }]
  dimensions: [{ id: region, field: region }]
  measures: [{ id: revenue, expr: "sum(amount)" }]
datasets: { by_region: { dimensions: [region], measures: [revenue] } }
panels:
  - { id: table, type: table, dataset: by_region, layout: { x: 0, y: 0, w: 12, h: 5 }, props: { columns: [{ ref: region }, { ref: revenue }] } }
`;
const csv = "region,amount\nNorth,10\nNorth,20\nSouth,5\n";
writeFileSync(join(consumer, "sales.gw.yaml"), manifestText);
writeFileSync(join(consumer, "sales.csv"), csv);
writeFileSync(join(consumer, "smoke.mjs"), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundle, Engine } from '@yashumani/gridwright-engine';
${packages.map((p) => `await import(${JSON.stringify(p.name)});`).join("\n")}
await import('@yashumani/gridwright-bridge/sql');
const r = loadBundle(readFileSync('sales.gw.yaml', 'utf8'), [{ name: 'sales.csv', text: readFileSync('sales.csv', 'utf8') }]);
assert(r.ok, JSON.stringify(r));
const result = await new Engine(r.manifest, r.source).query('by_region');
assert.equal(result.rowCount, 2);
assert.deepEqual(Object.values(result.data).find(v => v.every(x => typeof x === 'number')).sort((a,b) => a-b), [5,30]);
console.log('PASS packed public imports, grouped numbers and SQL subpath');
`);
console.log(execFileSync(process.execPath, ["smoke.mjs"], { cwd: consumer, encoding: "utf8" }).trim());
const cli = join(consumer, "node_modules/gridwright/dist/bin.js");
console.log(execFileSync(process.execPath, [cli, "validate", "sales.gw.yaml", "--data"], { cwd: consumer, encoding: "utf8" }).trim());

writeFileSync(join(consumer, "index.html"), '<div id="root" style="height:600px"></div><script type="module" src="/app.tsx"></script>');
writeFileSync(join(consumer, "app.tsx"), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { loadBundle } from '@yashumani/gridwright-engine';
import { Dashboard, injectStyles } from '@yashumani/gridwright-react';
const r = loadBundle(${JSON.stringify(manifestText)}, [{name:'sales.csv', text:${JSON.stringify(csv)}}]);
injectStyles();
if (!r.ok) throw new Error(JSON.stringify(r.issues));
createRoot(document.getElementById('root')!).render(<Dashboard manifest={r.manifest} source={r.source} />);
`);
writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
  compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", jsx: "react-jsx", strict: true, skipLibCheck: false, noEmit: true },
  include: ["app.tsx"],
}));
run(["exec", "tsc", "--noEmit"], consumer);
run(["exec", "vite", "build"], consumer);

if (!process.argv.includes("--no-browser")) {
  const { chromium } = await import("playwright");
  const { serveDist } = await import("./lib/serve-dist.mjs");
  const server = await serveDist({ root: join(consumer, "dist"), port: 0 });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole("cell", { name: "30", exact: true }).waitFor();
    await page.getByRole("cell", { name: "5", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS packed React consumer renders North 30 and South 5 in Chromium");
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}
writeFileSync(resolve(".release/manifest.json"), JSON.stringify({
  version: "0.1.0", commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), packages,
}, null, 2));
console.log(`PASS ${packages.length} packed packages: licenses, exports, declarations, install, CLI, typecheck and consumer build`);
console.log(`Consumer evidence retained at ${consumer}`);
