import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer } from "better-auth/plugins";
import { authOptions } from "@/lib/auth-config";
import { db } from "@/lib/db";

export const auth = betterAuth({
  ...authOptions(db),
  plugins: [
    // Lets getSession read `Authorization: Bearer <set-auth-token>` as the
    // session cookie. requireSignature refuses the raw token stored in the
    // session table, so the header needs the secret's signature like the cookie.
    bearer({ requireSignature: true }),
    // nextCookies mirrors Set-Cookie into next/headers, so it must stay last.
    nextCookies(),
  ],
});

/**
 * The session behind the Authorization header alone, for endpoints only API
 * clients may call: dropping the cookie keeps the browser, and with it any
 * cross-site request riding on its cookie, off the write path.
 */
export function getBearerSession(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Promise.resolve(null);
  }
  return auth.api.getSession({ headers: new Headers({ authorization }) });
}
