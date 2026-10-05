import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import type { TestProject } from "vitest/node";

/**
 * Global setup of the integration project: builds the CLI once and starts one
 * `next dev` on a spare port over a temporary database, which every file in
 * tests/integration then talks to. Nothing here touches data/app.db.
 */

declare module "vitest" {
  export interface ProvidedContext {
    server: { baseURL: string; databaseUrl: string; secret: string };
  }
}

const run = promisify(execFile);

function sparePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

/** Polls until Better Auth answers, which also compiles its route. */
async function waitForServer(server: ChildProcess, url: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`next dev exited with ${server.exitCode}`);
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not come up within two minutes`);
}

export default async function setup(project: TestProject) {
  await run("npm", ["run", "build", "--workspace", "ai-tutor-cli"]);

  const dir = await mkdtemp(join(tmpdir(), "ai-tutor-integration-"));
  const databaseUrl = `file:${join(dir, "app.db")}`;
  const db = drizzle({ connection: { url: databaseUrl } });
  await migrate(db, { migrationsFolder: "./drizzle" });
  db.$client.close();

  const secret = "test-secret-at-least-32-characters-long";
  const port = await sparePort();
  const baseURL = `http://localhost:${port}`;
  const server = spawn(
    join("node_modules", ".bin", "next"),
    ["dev", "--port", String(port)],
    {
      // Real env vars win over .env, which next dev still loads for the rest.
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: baseURL,
        // Own dist dir, so a `npm run dev` or Playwright server can keep theirs.
        NEXT_DIST_DIR: ".next-cli",
      },
      stdio: "ignore",
      // Its own process group, so teardown can stop next dev and its workers.
      detached: true,
    },
  );

  const teardown = async () => {
    if (server.pid && server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      process.kill(-server.pid, "SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  };

  try {
    await waitForServer(server, `${baseURL}/api/auth/ok`);
  } catch (error) {
    await teardown();
    throw error;
  }
  project.provide("server", { baseURL, databaseUrl, secret });
  return teardown;
}
