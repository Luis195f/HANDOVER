import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TS_EXTENSIONS = ['.ts', '.tsx'];

async function fileExists(url) {
  try {
    await access(url, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, defaultResolve) {
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);

  if (!hasExtension && !specifier.startsWith('node:') && context.parentURL) {
    for (const ext of TS_EXTENSIONS) {
      const candidate = new URL(`${specifier}${ext}`, context.parentURL);
      const path = fileURLToPath(candidate);
      if (await fileExists(path)) {
        return {
          url: candidate.href,
          format: 'module',
        };
      }
    }
  }

  const resolved = await defaultResolve(specifier, context, defaultResolve);
  return resolved;
}

export async function load(url, context, defaultLoad) {
  if (TS_EXTENSIONS.some((ext) => url.endsWith(ext))) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
      },
      fileName: fileURLToPath(url),
    });
    return {
      format: 'module',
      source: outputText,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}
