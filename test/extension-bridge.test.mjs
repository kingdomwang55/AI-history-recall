import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("extension bridge never reloads the host page during version recovery", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "capture", "useExtensionBridge.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /window\.location\.reload\s*\(/);
});
