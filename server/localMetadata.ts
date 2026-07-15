import { isAbsolute, relative, resolve } from "node:path";

const importIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function resolveImportMetadataPath(dataDir: string, importId: string): string | undefined {
  if (!importIdPattern.test(importId)) {
    return undefined;
  }

  const importsDir = resolve(dataDir, "imports");
  const metadataPath = resolve(importsDir, importId, "scrapecreators-response.json");
  const pathFromImports = relative(importsDir, metadataPath);
  if (pathFromImports.startsWith("..") || isAbsolute(pathFromImports)) {
    return undefined;
  }
  return metadataPath;
}
