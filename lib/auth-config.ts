import { CLI_CLIENT_ID } from "@ai-tutor/api/device";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { deviceAuthorization } from "better-auth/plugins";
import * as schema from "@/lib/schema";

type DrizzleDb = Parameters<typeof drizzleAdapter>[0];

/**
 * Everything about the auth instance except the plugins, which each entry point
 * spreads in as a static array — Better Auth only infers plugin helpers (such as
 * `ctx.test`) from literal arrays. Kept free of the `server-only` marker in
 * lib/db.ts so the Better Auth CLI and the Vitest suite can load it.
 */
export function authOptions(db: DrizzleDb) {
  return {
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true },
    hooks: {
      // `/device/token` answers with the raw session token, which the bearer
      // plugin's requireSignature refuses. Setting the session cookie makes the
      // bearer plugin, whose after-hooks run after this one, expose the signed
      // value as `set-auth-token` — the same header a password sign-in yields.
      after: createAuthMiddleware(async (ctx) => {
        const newSession = ctx.context.newSession;
        if (ctx.path === "/device/token" && newSession) {
          await setSessionCookie(ctx, newSession);
        }
      }),
    },
  } satisfies BetterAuthOptions;
}

/**
 * The device authorization grant behind `ai-tutor login`: the CLI shows a code,
 * a signed-in user approves it on /device. A function so lib/auth.ts and
 * lib/auth-cli.ts (which generates its `deviceCode` table) configure it alike.
 */
export function deviceFlow() {
  return deviceAuthorization({
    verificationUri: "/device",
    validateClient: (clientId) => clientId === CLI_CLIENT_ID,
  });
}
