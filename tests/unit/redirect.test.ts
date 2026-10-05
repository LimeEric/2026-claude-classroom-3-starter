// @vitest-environment node
import { expect, test } from "vitest";
import { safeRedirect, withRedirect } from "@/lib/redirect";

test("a path on this site survives, query and all", () => {
  expect(safeRedirect("/device?user_code=ABCD1234")).toBe(
    "/device?user_code=ABCD1234",
  );
});

test.each([
  undefined,
  ["/device", "/"],
  "",
  "device",
  "https://evil.example/",
  "//evil.example/",
  "/\\evil.example/",
  "javascript:alert(1)",
])("%j falls back to /", (value) => {
  expect(safeRedirect(value)).toBe("/");
});

test("withRedirect carries a non-default target along", () => {
  expect(withRedirect("/signup", "/")).toBe("/signup");
  expect(withRedirect("/signup", "/device?user_code=AB")).toBe(
    "/signup?redirect=%2Fdevice%3Fuser_code%3DAB",
  );
});
