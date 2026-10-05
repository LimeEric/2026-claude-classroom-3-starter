import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./errors";

export const DEFAULT_SERVER = "http://localhost:3000";

/** `AI_TUTOR_URL`, or the local dev server, without a trailing slash. */
export function serverUrl(): string {
  const value = process.env.AI_TUTOR_URL?.trim() || DEFAULT_SERVER;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(`AI_TUTOR_URL is not a URL: ${value}`);
  }
  return url.href.replace(/\/+$/, "");
}

/**
 * Where gh keeps its hosts file: `$XDG_CONFIG_HOME/ai-tutor`, else
 * `%APPDATA%\ai-tutor` on Windows, else `~/.config/ai-tutor`.
 */
export function configDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "ai-tutor");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "ai-tutor");
  }
  return join(homedir(), ".config", "ai-tutor");
}

export const hostsFile = () => join(configDir(), "hosts.json");

/** One entry per server URL, so pointing AI_TUTOR_URL elsewhere keeps both. */
type Host = { token: string; email: string };
type Hosts = Record<string, Host>;

async function readHosts(): Promise<Hosts> {
  let text: string;
  try {
    text = await readFile(hostsFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
  try {
    return JSON.parse(text) as Hosts;
  } catch {
    throw new CliError(
      `${hostsFile()} is not valid JSON. Delete it and run \`ai-tutor login\` again.`,
    );
  }
}

/** Owner-only from the first byte: written to a 0600 temp file, then renamed. */
async function writeHosts(hosts: Hosts): Promise<void> {
  const file = hostsFile();
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(hosts, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

export async function getHost(server: string): Promise<Host | undefined> {
  return (await readHosts())[server];
}

export async function saveHost(server: string, host: Host): Promise<void> {
  await writeHosts({ ...(await readHosts()), [server]: host });
}

/** Whether there was an entry to remove. */
export async function removeHost(server: string): Promise<boolean> {
  const hosts = await readHosts();
  if (!(server in hosts)) {
    return false;
  }
  delete hosts[server];
  await writeHosts(hosts);
  return true;
}
