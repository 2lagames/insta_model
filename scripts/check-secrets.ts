import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const privatePathPatterns = [
  /(^|\/)(data|input|output)(\/|$)/i,
  /(^|\/)\.env($|\.)/i,
  /(^|\/).*\.local\.json$/i,
  /(^|\/)(credentials?|secrets?|private|personal)(\/|$)/i,
  /\.(pem|key|p12|pfx)$/i
];

const signaturePatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/ },
  { label: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ }
];

const fixtureMarkers = ["example", "fake", "fixture", "placeholder", "replacement", "sample", "test"];

export function scanSecretText(path: string, text: string, localSecrets: string[] = []): string[] {
  const normalizedPath = path.replaceAll("\\", "/");
  const findings: string[] = [];
  if (privatePathPatterns.some((pattern) => pattern.test(normalizedPath))) {
    findings.push(`${path}: private runtime path must not be committed`);
  }

  for (const secret of localSecrets) {
    if (secret.length >= 8 && text.includes(secret)) {
      findings.push(`${path}: contains a locally saved API key`);
      break;
    }
  }

  for (const { label, pattern } of signaturePatterns) {
    if (pattern.test(text)) {
      findings.push(`${path}: possible ${label}`);
    }
  }

  const assignmentPattern = /\b(api[_-]?key|password|passwd|secret|token)\b\s*[:=]\s*["']([^"'\s]{16,})["']/gi;
  for (const match of text.matchAll(assignmentPattern)) {
    const value = match[2].toLowerCase();
    if (!fixtureMarkers.some((marker) => value.includes(marker))) {
      findings.push(`${path}: possible credential assigned to ${match[1]}`);
    }
  }

  return [...new Set(findings)];
}

function gitPaths(args: string[]): string[] {
  const output = execFileSync("git", args, { encoding: "utf8" });
  return output.split("\0").filter(Boolean);
}

function readLocalSecrets(): string[] {
  try {
    const connections = JSON.parse(readFileSync("data/connections.local.json", "utf8")) as Record<string, unknown>;
    return ["apifyApiToken", "ollamaCloudApiKey", "runningHubApiKey"]
      .flatMap((name) => typeof connections[name] === "string" ? [connections[name].trim()] : [])
      .filter(Boolean);
  } catch {
    return [];
  }
}

function run(): void {
  const stagedPaths = new Set(gitPaths(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]));
  const paths = new Set([
    ...gitPaths(["ls-files", "-z"]),
    ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"]),
    ...stagedPaths
  ]);
  const localSecrets = readLocalSecrets();
  const findings: string[] = [];

  for (const path of paths) {
    let content: Buffer;
    try {
      content = stagedPaths.has(path)
        ? execFileSync("git", ["show", `:${path}`])
        : readFileSync(path);
    } catch {
      continue;
    }
    const text = content.includes(0) ? "" : content.toString("utf8");
    findings.push(...scanSecretText(path, text, localSecrets));
  }

  if (findings.length > 0) {
    console.error("Secret check failed:");
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Secret check passed (${paths.size} files scanned).`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  run();
}
