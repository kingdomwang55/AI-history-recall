import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = process.cwd();

function resolveSourcePath(specifier) {
  if (!specifier.startsWith("@/")) return null;

  const relativePath = specifier.slice(2);
  const basePath = path.join(projectRoot, "src", relativePath);
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, path.join(basePath, "index.ts")];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? basePath;
}

function resolveExtensionlessPath(specifier, parentURL) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  if (path.extname(specifier)) return null;

  const parentDirectory = parentURL ? path.dirname(fileURLToPath(parentURL)) : projectRoot;
  const basePath = specifier.startsWith("/")
    ? specifier
    : path.resolve(parentDirectory, specifier);
  const candidates = [`${basePath}.ts`, `${basePath}.tsx`, `${basePath}.js`, path.join(basePath, "index.ts")];

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

export function resolve(specifier, context, nextResolve) {
  const sourcePath = resolveSourcePath(specifier) ?? resolveExtensionlessPath(specifier, context.parentURL);

  if (sourcePath) {
    return {
      shortCircuit: true,
      url: pathToFileURL(sourcePath).href
    };
  }

  return nextResolve(specifier, context);
}
