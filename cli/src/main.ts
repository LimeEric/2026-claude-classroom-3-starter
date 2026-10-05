import { Command, Option } from "commander";
import { add, done, list, login, logout, whoami } from "./commands";
import { DEFAULT_SERVER } from "./config";
import { CliError, EXIT_AUTH } from "./errors";
import { serveMcp } from "./mcp";
import { version } from "./version";

const jsonOption = () =>
  new Option("--json", "print the result as JSON on stdout");

const program = new Command("ai-tutor")
  .description(
    "Read and update your ai-tutor to-do list (the one Bartholomew keeps in the web app) from the terminal.",
  )
  .version(version)
  .showHelpAfterError()
  .addHelpText(
    "after",
    `
Getting started:
  $ ai-tutor login            # prints a code and a URL; approve it in a signed-in browser
  $ ai-tutor add Buy milk     # prints the new item's row
  $ ai-tutor list             # one row per item: "[ ] <id>  <title>", "[x]" when done
  $ ai-tutor done <id>        # <id> is the full id from a row
  $ ai-tutor mcp --stdio      # the same list as MCP tools, for Claude Code and other agents

Output:
  Results go to stdout; prompts, progress and errors go to stderr.
  With --json, add and done print {"todo": {"id", "title", "done"}}, list
  prints {"todos": [...]}, and whoami {"server", "user": {"id", "name", "email"}}.

Environment:
  AI_TUTOR_URL       server to talk to (default: ${DEFAULT_SERVER})
  XDG_CONFIG_HOME    the login is saved per server URL in
                     $XDG_CONFIG_HOME/ai-tutor/hosts.json (default:
                     ~/.config/ai-tutor/hosts.json), readable by you only

Exit status:
  0 on success, ${EXIT_AUTH} when not logged in or the session has expired (run
  ai-tutor login), 1 on any other error.`,
  );

program
  .command("login")
  .description(
    "Log in through the browser: prints a one-time code and the URL of the page that approves it, then waits until it is approved, denied, or expired. Never opens a browser itself.",
  )
  .action(login);

program
  .command("whoami")
  .description("Print the user you are logged in as, and the server.")
  .addOption(jsonOption())
  .action(whoami);

program
  .command("logout")
  .description(
    "End the session on the server and delete the saved token. Succeeds when already logged out.",
  )
  .action(logout);

program
  .command("add")
  .description("Add an item to your list and print its row.")
  .argument("<title...>", "the item; several words are joined with spaces")
  .addOption(jsonOption())
  .action(add);

program
  .command("list")
  .description(
    "Print your list, oldest first, as rows of `[ ] <id>  <title>` (`[x]` when done).",
  )
  .addOption(
    new Option(
      "-q, --query <text>",
      "only items whose title contains <text>, ignoring case",
    ),
  )
  .addOption(jsonOption())
  .action(list);

program
  .command("done")
  .description("Mark an item done and print its row.")
  .argument("<id>", "the item's full id, as printed by list or add")
  .addOption(jsonOption())
  .action(done);

program
  .command("mcp")
  .description(
    "Run a Model Context Protocol server on stdin/stdout that offers the list as tools: list_todos (optional filter q), add_todo (title) and mark_todo_done (id). Uses the saved login and AI_TUTOR_URL like the other commands; it starts without a login, and each tool call then answers with an error asking the user to run ai-tutor login.",
  )
  .requiredOption("--stdio", "speak MCP over stdin/stdout (the only transport)")
  .addHelpText(
    "after",
    `
Register it with Claude Code from this repository:
  $ claude mcp add --transport stdio ai-tutor -- npx ai-tutor mcp --stdio
Only JSON-RPC is written to stdout; logs go to stderr. See docs/mcp.md.`,
  )
  .action(serveMcp);

try {
  await program.parseAsync();
} catch (error) {
  if (!(error instanceof CliError)) {
    throw error;
  }
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = error.exitCode;
}
