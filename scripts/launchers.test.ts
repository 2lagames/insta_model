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

  it("updates safely and starts the project on both platforms", async () => {
    const [windows, macos, readme, packageJson, macosInfo] = await Promise.all([
      readFile(join(projectRoot, "update.bat"), "utf8"),
      readFile(join(projectRoot, "update.command"), "utf8"),
      readFile(join(projectRoot, "README.md"), "utf8"),
      readFile(join(projectRoot, "package.json"), "utf8"),
      stat(join(projectRoot, "update.command"))
    ]);

    expect(windows).toContain("where git");
    expect(windows).toContain("where node");
    expect(windows).toContain("where npm");
    expect(windows).toContain("git pull --ff-only");
    expect(windows).toContain("call npm install");
    expect(windows).toContain("call npm run dev");
    expect(macos).toContain("command -v git");
    expect(macos).toContain("command -v node");
    expect(macos).toContain("command -v npm");
    expect(macos).toContain("git pull --ff-only");
    expect(macos).toContain("npm install");
    expect(macos).toContain("npm run dev");
    expect(windows).not.toMatch(/taskkill|wmic|Stop-Process/i);
    expect(macos).not.toMatch(/\bkill\b|pkill|lsof/i);
    expect(readme).toContain("update.bat");
    expect(readme).toContain("update.command");
    expect(JSON.parse(packageJson).version).toBe("0.2.2");
    expect(macosInfo.mode & 0o111).not.toBe(0);
  });
});
