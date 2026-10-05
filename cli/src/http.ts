import { errorResponse } from "@ai-tutor/api/todos";
import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import type { z } from "zod";
import { CliError, sessionRejected, unreachable } from "./errors";

/** Better Auth's own endpoints under `<server>/api/auth`. */
export const authClient = (server: string) =>
  createAuthClient({
    baseURL: server,
    plugins: [deviceAuthorizationClient()],
  });

export type AuthClient = ReturnType<typeof authClient>;

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A Better Auth client error as one sentence. */
export function describeAuthError(error: {
  status: number;
  statusText: string;
  message?: string;
  error_description?: string;
}): string {
  return (
    error.error_description ??
    error.message ??
    `${error.status} ${error.statusText}`.trim()
  );
}

/** Turns fetch's network failure into the CLI's message for it. */
export async function reach<T>(server: string, call: () => Promise<T>) {
  try {
    return await call();
  } catch (error) {
    if (error instanceof TypeError) {
      throw unreachable(server);
    }
    throw error;
  }
}

/** Validates user input against a wire schema before it is sent. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CliError(
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data;
}

/**
 * One call to /api/todos, answered by `schema`. A 401 means the saved token is
 * dead; a 404 becomes `notFound` when the caller expects one.
 */
export async function todoApi<T extends z.ZodType>(
  options: {
    server: string;
    token: string;
    method: "GET" | "POST" | "PATCH";
    path: string;
    body?: unknown;
    notFound?: string;
  },
  schema: T,
): Promise<z.output<T>> {
  const { server, token, method, path, body, notFound } = options;
  const response = await reach(server, () =>
    fetch(new URL(path, `${server}/`), {
      method,
      headers: {
        ...bearer(token),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const json: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new CliError(
        `${server} sent an unexpected response to ${method} /${path}.`,
      );
    }
    return result.data;
  }
  if (response.status === 401) {
    throw sessionRejected(server);
  }
  const error = errorResponse.safeParse(json);
  if (error.success && error.data.error === "not_found" && notFound) {
    throw new CliError(notFound);
  }
  if (error.success && error.data.issues) {
    throw new CliError(
      `The server rejected the request: ${error.data.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  throw new CliError(
    `${method} /${path} failed with ${response.status} ${response.statusText}.`,
  );
}
