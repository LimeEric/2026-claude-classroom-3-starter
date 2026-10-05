import { z } from "zod";

/**
 * The wire contract of /api/todos, shared by the route handlers and the CLI in
 * cli/. Depends on nothing but zod, so a client can import it without pulling
 * in the database, Better Auth or Next.js.
 *
 * Every request carries `Authorization: Bearer <token>`, where the token is the
 * `set-auth-token` response header of a Better Auth sign-in or device-token
 * exchange. Only the list also accepts the browser's session cookie, for the
 * sidebar.
 */

// The descriptions travel into JSON Schema, which is how the CLI's MCP tools
// explain their parameters to a model.
export const todoSchema = z.object({
  id: z
    .string()
    .describe("The item's id, as returned when it was listed or added."),
  title: z.string().describe("What the item says."),
  done: z.boolean().describe("Whether the item has been marked done."),
});

export type Todo = z.infer<typeof todoSchema>;

/** The `:id` segment of `/api/todos/:id`. */
export const todoParams = todoSchema.pick({ id: true });

/** `GET /api/todos?q=` — `q` keeps the items whose title contains it, ignoring ASCII case. */
export const listTodosQuery = z.object({
  q: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Keep only the items whose title contains this text, ignoring case. Omit it for the whole list.",
    ),
});

export type ListTodosQuery = z.infer<typeof listTodosQuery>;

export const listTodosResponse = z.object({ todos: z.array(todoSchema) });

export type ListTodosResponse = z.infer<typeof listTodosResponse>;

/** `POST /api/todos` — answers 201. */
export const createTodoRequest = z.object({
  title: z.string().trim().min(1).describe("What the new item should say."),
});

export type CreateTodoRequest = z.infer<typeof createTodoRequest>;

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
