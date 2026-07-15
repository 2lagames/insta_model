import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // Running outside a Git checkout does not block local development.
}
