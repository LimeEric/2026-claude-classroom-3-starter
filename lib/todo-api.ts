import { z } from "zod";

/**
 * The wire contract of /api/todos, shared by the route handlers and any client
 * in this repo. Depends on nothing but zod, so a CLI can import it without
 * pulling in the database, Better Auth or Next.js.
 *
 * Every request carries `Authorization: Bearer <token>`, where the token is the
 * `set-auth-token` response header of a Better Auth sign-in. Only the list also
 * accepts the browser's session cookie, for the sidebar.
 */

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

export type Todo = z.infer<typeof todoSchema>;

/** `GET /api/todos?q=` — `q` keeps the items whose title contains it, ignoring ASCII case. */
export const listTodosQuery = z.object({
  q: z.string().trim().min(1).optional(),
});

export const listTodosResponse = z.object({ todos: z.array(todoSchema) });

export type ListTodosResponse = z.infer<typeof listTodosResponse>;

/** `POST /api/todos` — answers 201. */
export const createTodoRequest = z.object({ title: z.string().trim().min(1) });

export const createTodoResponse = z.object({ todo: todoSchema });

export type CreateTodoResponse = z.infer<typeof createTodoResponse>;

/** `PATCH /api/todos/:id` — answers 404 when the caller's list has no such id. */
export const updateTodoRequest = z.object({ done: z.boolean() });

export const updateTodoResponse = z.object({ todo: todoSchema });

export type UpdateTodoResponse = z.infer<typeof updateTodoResponse>;

/** Every non-2xx body; `issues` comes only with `invalid_request`. */
export const errorResponse = z.object({
  error: z.enum(["unauthorized", "invalid_request", "not_found"]),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

export type ErrorResponse = z.infer<typeof errorResponse>;
