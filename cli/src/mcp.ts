import {
  createTodoRequest,
  createTodoResponse,
  listTodosQuery,
  listTodosResponse,
  todoParams,
  updateTodoResponse,
} from "@ai-tutor/api/todos";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { CliError } from "./errors";
import { addTodo, listTodos, markTodoDone } from "./todos";
import { version } from "./version";

/**
 * Runs `call` and returns its value as structured content, plus the same JSON
 * as text for clients that read only `content`. A CliError — "Not logged in…
 * Run `ai-tutor login` first." among them — is already written for a person,
 * so it becomes the tool's error text unchanged.
 */
async function result(call: () => Promise<Record<string, unknown>>) {
  try {
    const value = await call();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      structuredContent: value,
    };
  } catch (error) {
    if (!(error instanceof CliError)) {
      throw error;
    }
    return {
      content: [{ type: "text" as const, text: error.message }],
      isError: true,
    };
  }
}

/**
 * `ai-tutor mcp --stdio`: the todo operations as MCP tools, with every
 * schema taken from the shared wire contract. Each call reads the saved login
 * afresh, so the server starts without one and works once the user logs in.
 */
export async function serveMcp() {
  // stdout carries JSON-RPC and nothing else; route stray console output from
  // any dependency to stderr, where MCP clients collect logs.
  console.log = console.info = console.debug = console.error;

  const server = new McpServer(
    { name: "ai-tutor", version },
    {
      instructions:
        "Tools for the user's to-do list in the ai-tutor web app. If a tool reports that the user is not logged in, ask them to run `ai-tutor login` in a terminal and approve the code in their browser, then retry.",
    },
  );

  server.registerTool(
    "list_todos",
    {
      title: "List to-do items",
      description:
        "List the user's to-do items, oldest first. Each item has the id that mark_todo_done needs, its title, and whether it is done.",
      inputSchema: listTodosQuery,
      outputSchema: listTodosResponse,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (query) => result(async () => ({ todos: await listTodos(query) })),
  );

  server.registerTool(
    "add_todo",
    {
      title: "Add a to-do item",
      description:
        "Add an item to the end of the user's to-do list and return it with its new id.",
      inputSchema: createTodoRequest,
      outputSchema: createTodoResponse,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (body) => result(async () => ({ todo: await addTodo(body) })),
  );

  server.registerTool(
    "mark_todo_done",
    {
      title: "Mark a to-do item done",
      description:
        "Mark one of the user's to-do items done, by the id list_todos or add_todo returned, and return the updated item.",
      inputSchema: todoParams,
      outputSchema: updateTodoResponse,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) => result(async () => ({ todo: await markTodoDone(id) })),
  );

  await server.connect(new StdioServerTransport());
  console.error("ai-tutor MCP server running on stdio");
}
