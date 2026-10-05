#!/usr/bin/env node
// Tracked so npm can link the bin on a fresh clone, before `prepare` has built
// dist/ — npm skips a bin whose target does not exist yet.
try {
  await import("../dist/ai-tutor.js");
} catch (error) {
  if (
    error?.code !== "ERR_MODULE_NOT_FOUND" ||
    !error.message.includes("dist")
  ) {
    throw error;
  }
  console.error(
    "error: ai-tutor is not built. Run `npm run build --workspace ai-tutor-cli`.",
  );
  process.exitCode = 1;
}
