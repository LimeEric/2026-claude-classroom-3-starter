import {
  type CreateTodoRequest,
  createTodoResponse,
  type ListTodosQuery,
  listTodosResponse,
  type Todo,
  updateTodoResponse,
} from "@ai-tutor/api/todos";
import { getHost, serverUrl } from "./config";
import { notLoggedIn } from "./errors";
import { todoApi } from "./http";

/**
 * The saved login for the current server, read on every call so that an MCP
 * server started before `ai-tutor login` picks the login up without a restart.
 */
export async function signedIn() {
  const server = serverUrl();
  const host = await getHost(server);
  if (!host) {
    throw notLoggedIn(server);
  }
  return { server, token: host.token };
}

/**
 * The todo operations behind both the commands and the MCP tools. Input is
 * already parsed by its wire schema, by the command or by the MCP SDK.
 */
export async function listTodos({ q }: ListTodosQuery): Promise<Todo[]> {
  const search = q ? `?${new URLSearchParams({ q })}` : "";
  const { todos } = await todoApi(
    { ...(await signedIn()), method: "GET", path: `api/todos${search}` },
    listTodosResponse,
  );
  return todos;
}

export async function addTodo(body: CreateTodoRequest): Promise<Todo> {
  const { todo } = await todoApi(
    { ...(await signedIn()), method: "POST", path: "api/todos", body },
    createTodoResponse,
  );
  return todo;
}

export async function markTodoDone(id: string): Promise<Todo> {
  const { todo } = await todoApi(
    {
      ...(await signedIn()),
      method: "PATCH",
      path: `api/todos/${encodeURIComponent(id)}`,
      body: { done: true },
      notFound: `No item with id ${id} on your list. List the items for their ids.`,
    },
    updateTodoResponse,
  );
  return todo;
}
