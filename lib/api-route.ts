import type { z } from "zod";
import type { ErrorResponse } from "@/lib/todo-api";

export const errorJson = (status: number, body: ErrorResponse) =>
  Response.json(body, { status });

export const unauthorized = () => errorJson(401, { error: "unauthorized" });

/** Parses `value` with `schema`, or yields the 400 to return in its place. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
): { data: z.output<T> } | { response: Response } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { data: result.data };
  }
  return {
    response: errorJson(400, {
      error: "invalid_request",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    }),
  };
}

/** A body that is not JSON fails the schema like one of the wrong shape. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
