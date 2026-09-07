/**
 * The browser-evidence scripts serve a build directory over loopback so
 * Chromium can drive it. That server used to hand back any file the request
 * named — `join(root, urlPath)` walks out of the directory as soon as the path
 * contains `..` — so these are the tests for the guard that replaced it.
 *
 * Written against a temporary directory holding a build and a file beside it
 * that the server must never return.
 */
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { indexBuild, serveDist } from "./serve-dist.mjs";

let home: string;
let root: string;
let port = 0;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "serve-dist-"));
  root = join(home, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<title>the build</title>");
  writeFileSync(join(root, "assets", "app.js"), "// the bundle");
  writeFileSync(join(home, "secret.txt"), "NOT A BUILD ARTIFACT");
  symlinkSync(join(home, "secret.txt"), join(root, "escape.txt"));
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("indexBuild", () => {
  it("holds every file the build produced, keyed by its URL path", () => {
    const files = indexBuild(root);
    expect([...files.keys()].sort()).toEqual(["/assets/app.js", "/index.html"]);
    expect(files.get("/assets/app.js")).toBe(resolve(root, "assets/app.js"));
  });

  it("holds nothing outside the build, so there is no path to escape from", () => {
    const files = indexBuild(root);
    // The symlink is inside the directory; its target is not.
    expect(files.has("/escape.txt")).toBe(false);
    expect([...files.values()].every((f) => f.startsWith(realpathSync(root) + "/"))).toBe(true);
  });
});

/**
 * Sends the path exactly as written.
 *
 * `fetch` resolves `..` — and `%2e%2e`, which the URL parser also treats as a
 * dot segment — before the request leaves the client, so a traversal sent
 * through it never reaches the server and a test written on it proves nothing.
 */
function raw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => done({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("serveDist", () => {
  let server: { close: (cb: () => void) => void };
  let origin: string;

  beforeAll(async () => {
    server = (await serveDist({ root, port: 0, prefix: "/demo" })) as never;
    const address = (server as unknown as { address: () => { port: number } }).address();
    port = address.port;
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("serves a file from the build", async () => {
    const res = await fetch(`${origin}/demo/assets/app.js`);
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(await res.text()).toBe("// the bundle");
  });

  it("answers a percent-encoded traversal with the build's own entry point", async () => {
    const res = await raw("/demo/%2e%2e%2fsecret.txt");
    expect(res.body).not.toContain("NOT A BUILD ARTIFACT");
    expect(res.body).toBe("<title>the build</title>");
  });

  it("answers a plain traversal with the build's own entry point", async () => {
    const res = await raw("/demo/../secret.txt");
    expect(res.body).not.toContain("NOT A BUILD ARTIFACT");
    expect(res.body).toBe("<title>the build</title>");
  });

  it("answers a symlink out of the build with the entry point, not the file it points at", async () => {
    const res = await raw("/demo/escape.txt");
    expect(res.body).not.toContain("NOT A BUILD ARTIFACT");
    expect(res.body).toBe("<title>the build</title>");
  });

  it("refuses the root, so absolutely-referenced assets fail here rather than in production", async () => {
    const res = await fetch(`${origin}/assets/app.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("hosted under /demo");
  });

  it("answers malformed percent-encoding rather than crashing the server", async () => {
    const res = await fetch(`${origin}/demo/%zz`);
    expect(res.status).toBe(400);
    // The socket survives it.
    expect((await fetch(`${origin}/demo/assets/app.js`)).status).toBe(200);
  });
});
