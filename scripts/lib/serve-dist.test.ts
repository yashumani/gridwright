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
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { fileUnder, serveDist } from "./serve-dist.mjs";

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

describe("fileUnder", () => {
  it("resolves a file that is in the build", () => {
    expect(fileUnder(root, "/assets/app.js")).toBe(resolve(root, "assets/app.js"));
  });

  it("refuses a path that climbs out of the build", () => {
    expect(fileUnder(root, "/../secret.txt")).toBeUndefined();
    expect(fileUnder(root, "/assets/../../secret.txt")).toBeUndefined();
  });

  it("refuses an absolute path, however many slashes it leads with", () => {
    expect(fileUnder(root, "//etc/hosts")).toBeUndefined();
    expect(fileUnder(root, "///etc/hosts")).toBeUndefined();
  });

  it("refuses a symlink that points out of the build", () => {
    // The path is inside the directory; the file is not. Checking only the
    // path would return this one.
    expect(fileUnder(root, "/escape.txt")).toBeUndefined();
  });

  it("refuses a directory, which readFileSync would throw on", () => {
    expect(fileUnder(root, "/assets")).toBeUndefined();
    expect(fileUnder(root, "/")).toBeUndefined();
  });

  it("refuses a file that is not there", () => {
    expect(fileUnder(root, "/nope.js")).toBeUndefined();
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
