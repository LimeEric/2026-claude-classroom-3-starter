import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/libsql/node";
import { inject } from "vitest";
import { authOptions } from "@/lib/auth-config";

/** The bin a user runs, which imports the build tests/integration/server.ts made. */
export const cliPath = join(process.cwd(), "cli", "bin", "ai-tutor.js");

/**
 * A Better Auth instance with testUtils on the server's database file and
 * secret, so the users and sessions it mints are ones the server accepts.
 * Close the returned `db` in afterAll.
 */
export async function testAuth() {
  const { baseURL, databaseUrl, secret } = inject("server");
  const db = drizzle({ connection: { url: databaseUrl } });
  const auth = betterAuth({
    ...authOptions(db),
    secret,
    baseURL,
    plugins: [testUtils()],
  });
  return { db, helpers: (await auth.$context).test };
}

/**
 * A fresh config home per file, and only the variables the CLI reads, so the
 * developer's own AI_TUTOR_URL or ~/.config/ai-tutor cannot leak in.
 */
export async function cliEnvironment() {
  const configHome = await mkdtemp(join(tmpdir(), "ai-tutor-config-"));
  const env = {
    NODE_ENV: "production" as const,
    PATH: process.env.PATH ?? "",
    HOME: configHome,
    XDG_CONFIG_HOME: configHome,
    AI_TUTOR_URL: inject("server").baseURL,
  };
  return {
    configHome,
    env,
    hostsFile: join(configHome, "ai-tutor", "hosts.json"),
  };
}
