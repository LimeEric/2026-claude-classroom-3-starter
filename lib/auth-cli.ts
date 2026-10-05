import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/libsql/node";
import { authOptions, deviceFlow } from "@/lib/auth-config";

/**
 * Config target for `npm run auth:generate` only. The Better Auth CLI refuses to
 * load a module graph containing `server-only`, which rules out lib/auth.ts, and
 * `generate` never queries the database — hence the throwaway connection. Lists
 * every lib/auth.ts plugin that brings a table.
 */
export const auth = betterAuth({
  ...authOptions(drizzle({ connection: { url: ":memory:" } })),
  plugins: [deviceFlow()],
});
