import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dev-services launches uvicorn through Python without Conda", async () => {
  const source = await readFile(new URL("./dev-services.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /conda/i);
  assert.match(source, /-m[\s\S]*uvicorn/);
});
