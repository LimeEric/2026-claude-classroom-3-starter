/** Exit status for "log in first": no saved token, or the server refused it. */
export const EXIT_AUTH = 4;

/** A failure reported as one `error:` line on stderr, then the exit status. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export const notLoggedIn = (server: string) =>
  new CliError(
    `Not logged in to ${server}. Run \`ai-tutor login\` first.`,
    EXIT_AUTH,
  );

export const sessionRejected = (server: string) =>
  new CliError(
    `${server} no longer accepts the saved session. Run \`ai-tutor login\` again.`,
    EXIT_AUTH,
  );

export const unreachable = (server: string) =>
  new CliError(
    `Could not reach ${server}. Is the server running? Set AI_TUTOR_URL to use another one.`,
  );
