import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createTodoResponse,
  listTodosResponse,
  updateTodoResponse,
} from "@ai-tutor/api/todos";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { cliEnvironment, cliPath, testAuth } from "./helpers";

/**
 * `ai-tutor mcp --stdio` spawned by the MCP client SDK, against the integration
 * project's `next dev` (see server.ts). The login is written straight into the
 * config directory — `ai-tutor login` itself is covered by cli.test.ts.
 */

const { baseURL } = inject("server");

let cli: Awaited<ReturnType<typeof cliEnvironment>>;
let auth: Awaited<ReturnType<typeof testAuth>>;
let client: Client;
// Anything on stdout that is not a JSON-RPC message ends up here.
const transportErrors: Error[] = [];

beforeAll(async () => {
  cli = await cliEnvironment();
  auth = await testAuth();
  client = new Client({ name: "ai-tutor-test", version: "0.0.0" });
  client.onerror = (error) => transportErrors.push(error);
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, "mcp", "--stdio"],
      env: cli.env,
      stderr: "ignore",
    }),
  );
});

afterAll(async () => {
  await client?.close();
  auth?.db.$client.close();
  await rm(cli.configHome, { recursive: true, force: true });
});

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[])
    .map((block) => block.text)
    .join("\n");

/** What `ai-tutor login` leaves behind: the signed token, owner-only. */
async function saveLogin() {
  const user = await auth.helpers.saveUser(auth.helpers.createUser());
  const { cookies } = await auth.helpers.login({ userId: user.id });
  await mkdir(dirname(cli.hostsFile), { recursive: true, mode: 0o700 });
  await writeFile(
    cli.hostsFile,
    JSON.stringify({
      [baseURL]: { token: cookies[0].value, email: user.email },
    }),
    { mode: 0o600 },
  );
}

test("the tools and their schemas come from the shared contract", async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  expect(Object.keys(byName).sort()).toEqual([
    "add_todo",
    "list_todos",
    "mark_todo_done",
  ]);

  expect(byName.list_todos.inputSchema).toMatchObject({
    type: "object",
    properties: { q: { type: "string", minLength: 1 } },
  });
  expect(byName.list_todos.inputSchema.required ?? []).toEqual([]);
  expect(byName.list_todos.annotations?.readOnlyHint).toBe(true);
  expect(byName.add_todo.inputSchema).toMatchObject({
    properties: { title: { type: "string", minLength: 1 } },
    required: ["title"],
  });
  expect(byName.mark_todo_done.inputSchema).toMatchObject({
    properties: { id: { type: "string" } },
    required: ["id"],
  });
  expect(byName.mark_todo_done.outputSchema).toMatchObject({
    properties: { todo: { required: ["id", "title", "done"] } },
  });
});

test("without a login every tool answers with an error naming ai-tutor login", async () => {
  for (const [name, args] of [
    ["list_todos", {}],
    ["add_todo", { title: "Buy milk" }],
    ["mark_todo_done", { id: "any-id" }],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Run `ai-tutor login`");
  }
});

test("once logged in, add, list and mark done work without a restart", async () => {
  await saveLogin();

  const added = await client.callTool({
    name: "add_todo",
    arguments: { title: "  Buy milk  " },
  });
  expect(added.isError).toBeFalsy();
  const { todo } = createTodoResponse.parse(added.structuredContent);
  expect(todo).toMatchObject({ title: "Buy milk", done: false });
  // The same object as text, for clients that ignore structuredContent.
  expect(JSON.parse(text(added))).toEqual({ todo });

  await client.callTool({
    name: "add_todo",
    arguments: { title: "Walk the dog" },
  });

  const listed = await client.callTool({ name: "list_todos", arguments: {} });
  expect(
    listTodosResponse.parse(listed.structuredContent).todos.map((t) => t.title),
  ).toEqual(["Buy milk", "Walk the dog"]);

  const done = await client.callTool({
    name: "mark_todo_done",
    arguments: { id: todo.id },
  });
  expect(updateTodoResponse.parse(done.structuredContent)).toEqual({
    todo: { ...todo, done: true },
  });

  const filtered = await client.callTool({
    name: "list_todos",
    arguments: { q: "MILK" },
  });
  expect(listTodosResponse.parse(filtered.structuredContent)).toEqual({
    todos: [{ ...todo, done: true }],
  });
});

test("bad input and unknown ids are tool errors, not protocol failures", async () => {
  const empty = await client.callTool({
    name: "add_todo",
    arguments: { title: "   " },
  });
  expect(empty.isError).toBe(true);

  const missing = await client.callTool({
    name: "mark_todo_done",
    arguments: { id: "no-such-id" },
  });
  expect(missing.isError).toBe(true);
  expect(text(missing)).toContain("No item with id no-such-id");

  expect(transportErrors).toEqual([]);
});
