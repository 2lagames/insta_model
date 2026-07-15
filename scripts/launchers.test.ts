import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("cross-platform launchers", () => {
  it("keeps npm run dev in a visible terminal on both platforms", async () => {
    const [windows, macos] = await Promise.all([
      readFile(join(projectRoot, "start.bat"), "utf8"),
      readFile(join(projectRoot, "start.command"), "utf8")
    ]);

    expect(windows).toContain("call npm run dev");
    expect(macos).toContain("npm run dev");
    expect(windows).not.toMatch(/taskkill|wmic|Stop-Process/i);
    expect(macos).not.toMatch(/\bkill\b|pkill|lsof/i);
  });

  it("checks prerequisites and installs dependencies only when needed", async () => {
    const [windows, macos] = await Promise.all([
      readFile(join(projectRoot, "start.bat"), "utf8"),
      readFile(join(projectRoot, "start.command"), "utf8")
    ]);

    expect(windows).toContain("where node");
    expect(windows).toContain("where npm");
    expect(macos).toContain("command -v node");
    expect(macos).toContain("command -v npm");
    expect(windows).toContain('if not exist "node_modules"');
    expect(macos).toContain('[ ! -d "node_modules" ]');
  });

  it("opens the local URL through Vite and documents both files", async () => {
    const [packageJson, readme, macosInfo] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, "README.md"), "utf8"),
      stat(join(projectRoot, "start.command"))
    ]);
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;

    expect(scripts["dev:web"]).toBe("vite --open");
    expect(readme).toContain("start.bat");
    expect(readme).toContain("start.command");
    expect(readme).toContain("http://localhost:5173");
    expect(macosInfo.mode & 0o111).not.toBe(0);
  });

  it("installs the repository secret-check hook before local development", async () => {
    const [packageJson, hook] = await Promise.all([
      readFile(join(projectRoot, "package.json"), "utf8"),
      readFile(join(projectRoot, ".githooks", "pre-commit"), "utf8")
    ]);
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;

    expect(scripts.dev).toContain("npm run setup:git-hooks");
    expect(scripts["setup:git-hooks"]).toContain("install-git-hooks.mjs");
    expect(scripts["check:secrets"]).toContain("check-secrets.ts");
    expect(hook).toContain("npm run check:secrets");
  });

  it("installs the latest tagged release and starts it on both platforms", async () => {
    const [windows, macos, readme, macosInfo] = await Promise.all([
      readFile(join(projectRoot, "instal.bat"), "utf8").catch(() => ""),
      readFile(join(projectRoot, "instal.command"), "utf8").catch(() => ""),
      readFile(join(projectRoot, "README.md"), "utf8"),
      stat(join(projectRoot, "instal.command")).catch(() => null)
    ]);

    expect(windows).toContain("winget install --id Git.Git");
    expect(windows).toContain("winget install --id OpenJS.NodeJS.LTS");
    expect(windows).toContain("https://github.com/2lagames/insta_model.git");
    expect(windows).toContain("if exist \".git\"");
    expect(windows).toContain("if exist \"package.json\"");
    expect(windows).toContain("git init");
    expect(windows).toContain("git fetch --tags");
    expect(windows).toContain("call npm ci");
    expect(windows).toContain("call npm run dev");
    expect(macos).toContain("https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh");
    expect(macos).toContain("brew install git node");
    expect(macos).toContain("[ -e .git ]");
    expect(macos).toContain("[ -e package.json ]");
    expect(macos).toContain("git init");
    expect(macos).toContain("git fetch --tags");
    expect(macos).toContain("npm ci");
    expect(macos).toContain("npm run dev");
    expect(readme).toContain("instal.bat");
    expect(readme).toContain("instal.command");
    expect((macosInfo?.mode ?? 0) & 0o111).not.toBe(0);
  });

  it("updates only to tagged releases and preserves local tracked work", async () => {
    const [windows, macos, readme] = await Promise.all([
      readFile(join(projectRoot, "update.bat"), "utf8"),
      readFile(join(projectRoot, "update.command"), "utf8"),
      readFile(join(projectRoot, "README.md"), "utf8")
    ]);

    expect(windows).toContain("where git");
    expect(windows).toContain("where node");
    expect(windows).toContain("where npm");
    expect(windows).toContain("git fetch --tags");
    expect(windows).toContain("git diff --quiet");
    expect(windows).toContain("call npm ci");
    expect(windows).toContain("call npm run dev");
    expect(macos).toContain("command -v git");
    expect(macos).toContain("command -v node");
    expect(macos).toContain("command -v npm");
    expect(macos).toContain("git fetch --tags");
    expect(macos).toContain("git diff --quiet");
    expect(macos).toContain("npm ci");
    expect(macos).toContain("npm run dev");
    expect(windows).not.toContain("git pull --ff-only");
    expect(macos).not.toContain("git pull --ff-only");
    expect(windows).not.toMatch(/git clean|taskkill|wmic|Stop-Process/i);
    expect(macos).not.toMatch(/git clean|\bkill\b|pkill|lsof/i);
    expect(windows).not.toMatch(/taskkill|wmic|Stop-Process/i);
    expect(macos).not.toMatch(/\bkill\b|pkill|lsof/i);
    expect(readme).toContain("update.bat");
    expect(readme).toContain("update.command");
    expect(readme).toContain("vX.Y.Z");
  });
});
