import { errorJson, parseInput, readJson, unauthorized } from "@/lib/api-route";
import { getBearerSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { type UpdateTodoResponse, updateTodoRequest } from "@/lib/todo-api";
import { setTodoDoneFor } from "@/lib/todo-tools";

/**
 * Marks one item done or reopens it. Bearer only, like POST /api/todos; an id
 * on someone else's list is a 404, the same as one that does not exist.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/todos/[id]">,
) {
  const session = await getBearerSession(request);
  if (!session) {
    return unauthorized();
  }

  const input = parseInput(updateTodoRequest, await readJson(request));
  if ("response" in input) {
    return input.response;
  }

  const { id } = await ctx.params;
  const todo = await setTodoDoneFor(db, session.user.id, id, input.data.done);
  if (!todo) {
    return errorJson(404, { error: "not_found" });
  }

  return Response.json({ todo } satisfies UpdateTodoResponse);
}
