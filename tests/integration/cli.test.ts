// @vitest-environment node
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createTodoResponse, listTodosResponse } from "@ai-tutor/api/todos";
import { betterAuth } from "better-auth";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authOptions } from "@/lib/auth-config";

/**
 * The built CLI against a real `next dev` on a spare port, over a temporary
 * database and config directory — nothing here touches data/app.db or the real
 * ~/.config. The browser half of `ai-tutor login` is played by fetch, with a
 * session minted by Better Auth's testUtils on the same file and secret.
 */

const run = promisify(execFile);
const secret = "test-secret-at-least-32-characters-long";
const cli = join(process.cwd(), "cli", "bin", "ai-tutor.js");

let dir: string;
let configHome: string;
let baseURL: string;
let server: ChildProcess;
let db: ReturnType<typeof drizzle>;
let helpers: TestHelpers;

function sparePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

/** Polls until Better Auth answers, which also compiles its route. */
async function waitForServer(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`next dev exited with ${server.exitCode}`);
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up within ${timeoutMs}ms`);
}

/** Only what the CLI reads, so the developer's own AI_TUTOR_URL cannot leak in. */
const cliEnv = () => ({
  NODE_ENV: "production" as const,
  PATH: process.env.PATH,
  HOME: configHome,
  XDG_CONFIG_HOME: configHome,
  AI_TUTOR_URL: baseURL,
});

async function aiTutor(...args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
      env: cliEnv(),
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as {
      code: number;
      stdout: string;
      stderr: string;
    };
    return { code, stdout, stderr };
  }
}

beforeAll(async () => {
  await run("npm", ["run", "build", "--workspace", "ai-tutor-cli"]);

  dir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-"));
  configHome = join(dir, "config");
  const url = `file:${join(dir, "app.db")}`;
  db = drizzle({ connection: { url } });
  await migrate(db, { migrationsFolder: "./drizzle" });

  const port = await sparePort();
  baseURL = `http://localhost:${port}`;
  server = spawn(
    join("node_modules", ".bin", "next"),
    ["dev", "--port", String(port)],
    {
      // Real env vars win over .env, which next dev still loads for the rest.
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: url,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: baseURL,
        // Own dist dir, so a `npm run dev` or Playwright server can keep theirs.
        NEXT_DIST_DIR: ".next-cli",
      },
      stdio: "ignore",
      // Its own process group, so afterAll can stop next dev and its workers.
      detached: true,
    },
  );
  await waitForServer(`${baseURL}/api/auth/ok`, 120_000);

  const testAuth = betterAuth({
    ...authOptions(db),
    secret,
    baseURL,
    plugins: [testUtils()],
  });
  helpers = (await testAuth.$context).test;
}, 180_000);

afterAll(async () => {
  if (server?.pid && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    process.kill(-server.pid, "SIGTERM");
    await exited;
  }
  db?.$client.close();
  await rm(dir, { recursive: true, force: true });
});

/** What the /device page does for a signed-in user: claim the code, approve it. */
async function approveInBrowser(userCode: string, cookie: Headers) {
  const headers = new Headers(cookie);
  headers.set("origin", baseURL);
  headers.set("content-type", "application/json");

  const verify = await fetch(
    `${baseURL}/api/auth/device?${new URLSearchParams({ user_code: userCode })}`,
    { headers },
  );
  expect(verify.status).toBe(200);

  const approve = await fetch(`${baseURL}/api/auth/device/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userCode }),
  });
  expect(await approve.json()).toEqual({ success: true });
}

test("log in with a device code, manage the list, log out", async () => {
  const user = await helpers.saveUser(helpers.createUser());
  const cookie = await helpers.getAuthHeaders({ userId: user.id });

  // login: prints the code and the URL on stderr, then polls until approved.
  const login = spawn(process.execPath, [cli, "login"], { env: cliEnv() });
  let stdout = "";
  let stderr = "";
  login.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise<number | null>((resolve) =>
    login.on("exit", resolve),
  );
  const userCode = await Promise.race([
    new Promise<string>((resolve) => {
      login.stderr.on("data", (chunk) => {
        stderr += chunk;
        const match = stderr.match(/one-time code: (\S+)[\s\S]*Waiting/);
        if (match) resolve(match[1]);
      });
    }),
    exited.then((code) => {
      throw new Error(`login exited with ${code} before a code: ${stderr}`);
    }),
  ]);
  expect(stderr).toContain(`${baseURL}/device?user_code=`);

  // The dashed code as printed is what a user would type on the page.
  await approveInBrowser(userCode, cookie);
  expect(await exited).toBe(0);
  expect(stderr).toContain(`Logged in to ${baseURL} as`);

  const hostsFile = join(configHome, "ai-tutor", "hosts.json");
  expect((await stat(hostsFile)).mode & 0o777).toBe(0o600);
  const { token } = JSON.parse(await readFile(hostsFile, "utf8"))[baseURL];
  expect(token).toMatch(/\./); // signed, as requireSignature demands
  expect(stdout + stderr).not.toContain(token);

  const whoami = await aiTutor("whoami");
  expect(whoami).toMatchObject({ code: 0 });
  expect(whoami.stdout).toContain(user.email);

  const milk = await aiTutor("add", "Buy", "milk", "--json");
  expect(milk.code).toBe(0);
  const { todo } = createTodoResponse.parse(JSON.parse(milk.stdout));
  expect(todo).toMatchObject({ title: "Buy milk", done: false });
  const dog = await aiTutor("add", "Walk the dog");
  expect(dog.stdout).toMatch(/^\[ \] \S+ {2}Walk the dog\n$/);

  const listed = await aiTutor("list");
  expect(listed.stdout).toBe(
    `[ ] ${todo.id}  Buy milk\n${dog.stdout.replace(/\n$/, "")}\n`,
  );

  const done = await aiTutor("done", todo.id);
  expect(done).toMatchObject({
    code: 0,
    stdout: `[x] ${todo.id}  Buy milk\n`,
  });

  const filtered = await aiTutor("list", "--query", "MILK", "--json");
  expect(listTodosResponse.parse(JSON.parse(filtered.stdout))).toEqual({
    todos: [{ ...todo, done: true }],
  });

  const missing = await aiTutor("done", "no-such-id");
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain("No item with id no-such-id");

  const logout = await aiTutor("logout");
  expect(logout.code).toBe(0);
  expect(JSON.parse(await readFile(hostsFile, "utf8"))).toEqual({});
  // Revoked on the server too, not only forgotten locally.
  const revoked = await fetch(`${baseURL}/api/todos`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(revoked.status).toBe(401);

  const after = await aiTutor("whoami");
  expect(after.code).toBe(4);
  expect(after.stderr).toContain("Not logged in");
}, 60_000);
