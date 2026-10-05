const origin = "http://same.origin";

/**
 * The `?redirect=` a page was sent with, if it is a path on this site, else
 * "/". Resolving it against a placeholder origin catches `//host`, `/\host` and
 * `scheme:` forms alike, so the login form cannot be made to send a user away.
 */
export function safeRedirect(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/";
  }
  const url = new URL(value, origin);
  return url.origin === origin
    ? `${url.pathname}${url.search}${url.hash}`
    : "/";
}

/** `path`, carrying `redirect` along unless it is the default. */
export function withRedirect(path: string, redirect: string): string {
  return redirect === "/"
    ? path
    : `${path}?${new URLSearchParams({ redirect })}`;
}
