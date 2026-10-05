# The ai-tutor MCP server

`ai-tutor mcp --stdio` runs a [Model Context Protocol](https://modelcontextprotocol.io)
server over stdin/stdout. It gives an agent such as Claude Code the same to-do
list the web app and the `ai-tutor` CLI work on, as three tools:

| Tool             | Input                                  | Returns                     |
| ---------------- | -------------------------------------- | --------------------------- |
| `list_todos`     | `q` (optional): keep titles containing it, ignoring case | `{ "todos": [...] }` |
| `add_todo`       | `title`                                | `{ "todo": {...} }`         |
| `mark_todo_done` | `id`, as `list_todos` or `add_todo` returned it | `{ "todo": {...} }` |

Each item is `{ "id", "title", "done" }`. The input and output schemas come from
the zod contract in `packages/api/src/todos.ts`, the one the REST API uses.

The server uses the CLI's saved login for the server URL in `AI_TUTOR_URL`
(default `http://localhost:3000`). It starts even when you're not logged in.
Until you log in, every tool call returns an error asking you to run
`ai-tutor login`. The login is read again on each call, so after you log in,
the next call works and you don't need to restart anything.

## Before you start

1. Run `npm install` in this repository. It also builds the CLI.
2. Start the web app with `npm run dev`, or set `AI_TUTOR_URL` to wherever it runs.
3. Log in from a terminal with `npx ai-tutor login`, then approve the code in
   your browser. You can do this before or after registering the server.

## Register it for this repository

Run this from the repository root:

```bash
claude mcp add --transport stdio ai-tutor -- npx ai-tutor mcp --stdio
```

That uses the default `local` scope. Only you see the server, only in this
project, and Claude Code stores it in `~/.claude.json`. Everything after `--`
is the command Claude Code runs. Without the `--`, Claude Code would treat
`--stdio` as one of its own options.

To share the server with everyone who clones the repository, add
`--scope project`. Claude Code then writes a `.mcp.json` at the repository
root for you to commit:

```bash
claude mcp add --scope project --transport stdio ai-tutor -- npx ai-tutor mcp --stdio
```

```json
{
  "mcpServers": {
    "ai-tutor": {
      "type": "stdio",
      "command": "npx",
      "args": ["ai-tutor", "mcp", "--stdio"],
      "env": {}
    }
  }
}
```

Claude Code asks each person to approve a project-scoped server the first time
they start `claude` in the repository. Until they do, it shows as pending.

## Register it for a project elsewhere on the machine

`npx ai-tutor` only resolves inside this repository. Run it from another
directory and `claude mcp list` reports `✘ Failed to connect`. So point Claude
Code at the CLI by its absolute path instead:

```bash
cd ~/code/some-other-project
claude mcp add --transport stdio ai-tutor -- \
  node /path/to/this/repo/cli/bin/ai-tutor.js mcp --stdio
```

To make the server available in every project instead, add `--scope user`.
Claude Code still stores it in `~/.claude.json`.

To talk to a server other than `http://localhost:3000`, pass `AI_TUTOR_URL`
with `--env`. Put `--env` before `--transport`: if the server name comes right
after `--env`, Claude Code reads the name as another `KEY=value` pair and
rejects it.

```bash
claude mcp add --env AI_TUTOR_URL=https://tutor.example.com --transport stdio ai-tutor -- \
  node /path/to/this/repo/cli/bin/ai-tutor.js mcp --stdio
```

Your login is saved per server URL, so log in to that URL as well:
`AI_TUTOR_URL=https://tutor.example.com node /path/to/this/repo/cli/bin/ai-tutor.js login`.

Don't commit a `.mcp.json` that contains your absolute path. If another
project needs it shared, write `${AI_TUTOR_REPO}/cli/bin/ai-tutor.js` in its
`args`. Claude Code expands `${VAR}` in `.mcp.json` from each person's
environment.

## Check that it's connected

```bash
claude mcp list
```

The output should include this line:

```text
ai-tutor: npx ai-tutor mcp --stdio - ✔ Connected
```

`claude mcp get ai-tutor` shows the scope, the status, the command and the
environment for that one server.

Inside a Claude Code session, `/mcp` lists `ai-tutor` with its status and a
tool count of 3. To confirm the tools themselves work, ask
"What's on my to-do list?". Claude should call `list_todos`.

## When it doesn't work

| Symptom | Cause and fix |
| --- | --- |
| `✘ Failed to connect` | Run the registered command yourself. It should print `ai-tutor MCP server running on stdio` on stderr and then wait; stop it with Ctrl-C. If it says `ai-tutor is not built`, run `npm install` (or `npm run build --workspace ai-tutor-cli`). If `npx` can't find `ai-tutor`, you're outside this repository; use the absolute path. |
| ``⏸ Pending approval (run `claude` to approve)`` | A project-scoped server you haven't approved yet. Start `claude` in that project and accept it. `claude mcp reset-project-choices` brings the prompt back. |
| Tools answer "Not logged in…" or "…no longer accepts the saved session" | Run `npx ai-tutor login` (or the absolute-path form) for the same `AI_TUTOR_URL`. |
| Tools answer "Could not reach http://localhost:3000" | The web app isn't running. Start it with `npm run dev`, or set `AI_TUTOR_URL` with `--env`. |

To unregister the server, run `claude mcp remove ai-tutor`. Add `-s project`
or `-s user` if you registered it with that scope.
