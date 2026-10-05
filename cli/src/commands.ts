import { setTimeout as sleep } from "node:timers/promises";
import { CLI_CLIENT_ID } from "@ai-tutor/api/device";
import {
  createTodoRequest,
  createTodoResponse,
  listTodosQuery,
  listTodosResponse,
  type Todo,
  updateTodoResponse,
} from "@ai-tutor/api/todos";
import { getHost, removeHost, saveHost, serverUrl } from "./config";
import { CliError, notLoggedIn, sessionRejected } from "./errors";
import {
  type AuthClient,
  authClient,
  bearer,
  describeAuthError,
  parseInput,
  reach,
  todoApi,
} from "./http";

type Output = { json?: boolean };

const out = (line: string) => process.stdout.write(`${line}\n`);
const info = (line: string) => process.stderr.write(`${line}\n`);
const printJson = (value: unknown) => out(JSON.stringify(value, null, 2));

/** `[ ] <id>  <title>`, or `[x]` once done — the row format of every command. */
const row = (todo: Todo) =>
  `${todo.done ? "[x]" : "[ ]"} ${todo.id}  ${todo.title}`;

/** The default 8-character code, split in two so it is easier to read out. */
const displayCode = (code: string) =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

async function signedIn() {
  const server = serverUrl();
  const host = await getHost(server);
  if (!host) {
    throw notLoggedIn(server);
  }
  return { server, token: host.token };
}

async function sessionUser(client: AuthClient, server: string, token: string) {
  const { data, error } = await reach(server, () =>
    client.getSession({ fetchOptions: { headers: bearer(token) } }),
  );
  if (error) {
    throw new CliError(
      `Could not read the session: ${describeAuthError(error)}`,
    );
  }
  return data?.user ?? null;
}

/** RFC 8628 device authorization: show a code, poll until it is approved. */
export async function login() {
  const server = serverUrl();
  const client = authClient(server);

  const { data: grant, error } = await reach(server, () =>
    client.device.code({ client_id: CLI_CLIENT_ID }),
  );
  if (error) {
    throw new CliError(`Could not start a login: ${describeAuthError(error)}`);
  }

  info(`Your one-time code: ${displayCode(grant.user_code)}`);
  info(`Approve it in a browser where you are signed in to ${server}:`);
  info(`  ${grant.verification_uri_complete}`);
  info(`(or open ${grant.verification_uri} and type the code)`);
  info(
    `Waiting for approval. The code expires in ${Math.round(grant.expires_in / 60)} minutes.`,
  );

  let interval = grant.interval * 1000;
  let token: string | null = null;
  while (!token) {
    await sleep(interval);
    const { data, error } = await reach(server, () =>
      client.device.token({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: grant.device_code,
        client_id: CLI_CLIENT_ID,
        fetchOptions: {
          // The body's access_token is the unsigned one the server refuses as
          // a bearer token; the signed one arrives in this header instead.
          onSuccess: ({ response }) => {
            token = response.headers.get("set-auth-token");
          },
        },
      }),
    );
    if (data) {
      if (!token) {
        throw new CliError(`${server} approved the login but sent no token.`);
      }
      break;
    }
    switch (error.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5000;
        continue;
      case "access_denied":
        throw new CliError("The login was denied in the browser.");
      case "expired_token":
        throw new CliError(
          "The code expired before it was approved. Run `ai-tutor login` again.",
        );
      default:
        throw new CliError(`Login failed: ${describeAuthError(error)}`);
    }
  }

  const user = await sessionUser(client, server, token);
  if (!user) {
    throw sessionRejected(server);
  }
  await saveHost(server, { token, email: user.email });
  info(`Logged in to ${server} as ${user.name} <${user.email}>.`);
}

export async function whoami({ json }: Output) {
  const { server, token } = await signedIn();
  const user = await sessionUser(authClient(server), server, token);
  if (!user) {
    throw sessionRejected(server);
  }
  if (json) {
    printJson({
      server,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } else {
    out(`${user.name} <${user.email}> on ${server}`);
  }
}

export async function logout() {
  const server = serverUrl();
  const host = await getHost(server);
  if (!host) {
    info(`Not logged in to ${server}.`);
    return;
  }
  // Revoke the session on the server first: deleting only the local copy would
  // leave a working token behind in any backup of the file.
  const { error } = await reach(server, () =>
    authClient(server).signOut({
      fetchOptions: { headers: bearer(host.token) },
    }),
  );
  // A 401 means the session is already gone, which is the goal anyway.
  if (error && error.status !== 401) {
    throw new CliError(`Could not log out: ${describeAuthError(error)}`);
  }
  await removeHost(server);
  info(`Logged out of ${server}.`);
}

export async function add(words: string[], { json }: Output) {
  const body = parseInput(createTodoRequest, { title: words.join(" ") });
  const { todo } = await todoApi(
    { ...(await signedIn()), method: "POST", path: "api/todos", body },
    createTodoResponse,
  );
  if (json) {
    printJson({ todo });
  } else {
    out(row(todo));
  }
}

export async function list({ json, query }: Output & { query?: string }) {
  const { q } = parseInput(listTodosQuery, { q: query });
  const search = q ? `?${new URLSearchParams({ q })}` : "";
  const { todos } = await todoApi(
    { ...(await signedIn()), method: "GET", path: `api/todos${search}` },
    listTodosResponse,
  );
  if (json) {
    printJson({ todos });
  } else if (todos.length === 0) {
    info(q ? `Nothing on the list matches "${q}".` : "Nothing on the list.");
  } else {
    todos.map(row).forEach(out);
  }
}

export async function done(id: string, { json }: Output) {
  const { todo } = await todoApi(
    {
      ...(await signedIn()),
      method: "PATCH",
      path: `api/todos/${encodeURIComponent(id)}`,
      body: { done: true },
      notFound: `No item with id ${id} on your list. Run \`ai-tutor list\` for the ids.`,
    },
    updateTodoResponse,
  );
  if (json) {
    printJson({ todo });
  } else {
    out(row(todo));
  }
}
