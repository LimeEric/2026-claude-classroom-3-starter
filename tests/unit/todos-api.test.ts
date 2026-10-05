// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTodoResponse,
  errorResponse,
  listTodosResponse,
  updateTodoResponse,
} from "@ai-tutor/api/todos";
import { betterAuth } from "better-auth";
import { type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { authOptions } from "@/lib/auth-config";

// The route modules run for real — lib/auth.ts with its bearer plugin, lib/db.ts
// — on a throwaway file. `server-only` otherwise resolves to its throwing build.
vi.mock("server-only", () => ({}));

const secret = "test-secret-at-least-32-characters-long";
const baseURL = "http://localhost:3000";

let dir: string;
let db: ReturnType<typeof drizzle>;
let helpers: TestHelpers;
let routes: typeof import("@/app/api/todos/route");
let itemRoute: typeof import("@/app/api/todos/[id]/route");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-todos-api-"));
  const url = `file:${join(dir, "test.db")}`;
  db = drizzle({ connection: { url } });
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Read by lib/db.ts and the app's Better Auth instance on import.
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("BETTER_AUTH_SECRET", secret);
  vi.stubEnv("BETTER_AUTH_URL", baseURL);
  routes = await import("@/app/api/todos/route");
  itemRoute = await import("@/app/api/todos/[id]/route");

  // A second instance on the same file and secret, only to mint sessions: its
  // tokens are rows in the shared session table, which the app instance reads.
  const testAuth = betterAuth({
    ...authOptions(db),
    secret,
    baseURL,
    plugins: [testUtils()],
  });
  helpers = (await testAuth.$context).test;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

const request = (path: string, init: RequestInit = {}) =>
  new Request(new URL(path, baseURL), init);

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const patch = (id: string, init: RequestInit) =>
  itemRoute.PATCH(request(`/api/todos/${id}`, { method: "PATCH", ...init }), {
    params: Promise.resolve({ id }),
  });

async function signIn() {
  const user = await helpers.saveUser(helpers.createUser());
  const { cookies, headers, token } = await helpers.login({ userId: user.id });
  // The signed cookie value is what a client receives as `set-auth-token`.
  return { bearerToken: cookies[0].value, rawToken: token, cookie: headers };
}

describe("without a token", () => {
  const expectUnauthorized = async (response: Response) => {
    expect(response.status).toBe(401);
    expect(errorResponse.parse(await response.json())).toEqual({
      error: "unauthorized",
    });
  };

  test("GET /api/todos is 401", async () => {
    await expectUnauthorized(await routes.GET(request("/api/todos")));
  });

  test("POST /api/todos is 401", async () => {
    await expectUnauthorized(
      await routes.POST(
        request("/api/todos", {
          method: "POST",
          body: JSON.stringify({ title: "Buy milk" }),
        }),
      ),
    );
  });

  test("PATCH /api/todos/:id is 401", async () => {
    await expectUnauthorized(
      await patch("any-id", { body: JSON.stringify({ done: true }) }),
    );
  });
});

test("a client adds an item, lists it, marks it done and filters for it", async () => {
  const { bearerToken } = await signIn();
  const headers = bearer(bearerToken);

  const created = await routes.POST(
    request("/api/todos", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "  Buy milk  " }),
    }),
  );
  expect(created.status).toBe(201);
  const { todo } = createTodoResponse.parse(await created.json());
  expect(todo).toEqual({
    id: expect.any(String),
    title: "Buy milk",
    done: false,
  });

  await routes.POST(
    request("/api/todos", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Walk the dog" }),
    }),
  );

  const listed = await routes.GET(request("/api/todos", { headers }));
  expect(listed.status).toBe(200);
  expect(listTodosResponse.parse(await listed.json()).todos).toEqual([
    todo,
    { id: expect.any(String), title: "Walk the dog", done: false },
  ]);

  const updated = await patch(todo.id, {
    headers,
    body: JSON.stringify({ done: true }),
  });
  expect(updated.status).toBe(200);
  expect(updateTodoResponse.parse(await updated.json())).toEqual({
    todo: { ...todo, done: true },
  });

  const filtered = await routes.GET(request("/api/todos?q=MILK", { headers }));
  expect(listTodosResponse.parse(await filtered.json())).toEqual({
    todos: [{ ...todo, done: true }],
  });
});

test("the session cookie still reads the list but cannot write", async () => {
  const { cookie } = await signIn();

  const listed = await routes.GET(request("/api/todos", { headers: cookie }));
  expect(listed.status).toBe(200);
  expect(await listed.json()).toEqual({ todos: [] });

  const created = await routes.POST(
    request("/api/todos", {
      method: "POST",
      headers: cookie,
      body: JSON.stringify({ title: "Planted" }),
    }),
  );
  expect(created.status).toBe(401);
});

test("the unsigned token from the session table is refused", async () => {
  const { rawToken } = await signIn();

  const response = await routes.GET(
    request("/api/todos", { headers: bearer(rawToken) }),
  );
  expect(response.status).toBe(401);
});

test("another user's item is a 404, and a malformed body a 400", async () => {
  const owner = await signIn();
  const created = await routes.POST(
    request("/api/todos", {
      method: "POST",
      headers: bearer(owner.bearerToken),
      body: JSON.stringify({ title: "Owner's errand" }),
    }),
  );
  const { todo } = createTodoResponse.parse(await created.json());

  const intruder = await signIn();
  const stolen = await patch(todo.id, {
    headers: bearer(intruder.bearerToken),
    body: JSON.stringify({ done: true }),
  });
  expect(stolen.status).toBe(404);

  const malformed = await patch(todo.id, {
    headers: bearer(owner.bearerToken),
    body: JSON.stringify({ done: "yes" }),
  });
  expect(malformed.status).toBe(400);
  expect(errorResponse.parse(await malformed.json())).toMatchObject({
    error: "invalid_request",
    issues: [{ path: "done" }],
  });
});
