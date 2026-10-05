import { execFile, spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { createTodoResponse, listTodosResponse } from "@ai-tutor/api/todos";
import type { TestHelpers } from "better-auth/plugins";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { cliEnvironment, cliPath, testAuth } from "./helpers";

/**
 * The built CLI against the integration project's `next dev` (see server.ts),
 * with its own config directory. The browser half of `ai-tutor login` is
 * played by fetch, with a session minted by Better Auth's testUtils.
 */

const run = promisify(execFile);
const { baseURL } = inject("server");

let cli: Awaited<ReturnType<typeof cliEnvironment>>;
let auth: Awaited<ReturnType<typeof testAuth>>;
let helpers: TestHelpers;

beforeAll(async () => {
  cli = await cliEnvironment();
  auth = await testAuth();
  helpers = auth.helpers;
});

afterAll(async () => {
  auth?.db.$client.close();
  await rm(cli.configHome, { recursive: true, force: true });
});

async function aiTutor(...args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [cliPath, ...args], {
      env: cli.env,
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
  const login = spawn(process.execPath, [cliPath, "login"], { env: cli.env });
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

  const { hostsFile } = cli;
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
});
