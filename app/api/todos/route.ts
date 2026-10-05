import {
  type CreateTodoResponse,
  createTodoRequest,
  type ListTodosResponse,
  listTodosQuery,
} from "@ai-tutor/api/todos";
import { parseInput, readJson, unauthorized } from "@/lib/api-route";
import { auth, getBearerSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { addTodoFor, listTodosFor } from "@/lib/todo-tools";

/**
 * The list, and the only endpoint the browser may call: the sidebar reads it
 * with its session cookie, an API client with its bearer token. Same query the
 * `listTodos` tool runs, on the session-derived user id.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return unauthorized();
  }

  const query = parseInput(
    listTodosQuery,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if ("response" in query) {
    return query.response;
  }

  return Response.json({
    todos: await listTodosFor(db, session.user.id, query.data.q),
  } satisfies ListTodosResponse);
}

/** Bearer only — in the browser the agent stays the one write path. */
export async function POST(request: Request) {
  const session = await getBearerSession(request);
  if (!session) {
    return unauthorized();
  }

  const input = parseInput(createTodoRequest, await readJson(request));
  if ("response" in input) {
    return input.response;
  }

  const todo = await addTodoFor(db, session.user.id, input.data.title);
  return Response.json({ todo } satisfies CreateTodoResponse, { status: 201 });
}
