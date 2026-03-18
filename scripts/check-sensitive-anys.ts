import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASELINE_PATH = path.resolve(process.cwd(), 'scripts/sensitive-any-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const MATCH_PATTERN = /\bany\b|@ts-ignore|@ts-nocheck/g;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const TARGETS = [
  'src/lib/auth.ts',
  'src/security',
  'src/lib/queue.ts',
  'src/lib/sync.ts',
  'src/lib/fhir-map.ts',
  'src/lib/fhir-map',
  'src/validation',
  'src/lib/profile-runtime.ts',
  'src/screens/HandoverForm.tsx',
  'src/config/profiles',
] as const;

type BaselineEntry = {
  file: string;
  kind: string;
  text: string;
  count: number;
};

type BaselineFile = {
  description: string;
  generatedFrom: readonly string[];
  entries: BaselineEntry[];
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function isTrackedSourceFile(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  if (normalized.includes('/__tests__/')) return false;
  if (/\.(spec|test)\.[tj]sx?$/.test(normalized)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(normalized));
}

function walkFiles(relativeTarget: string): string[] {
  const absoluteTarget = path.resolve(process.cwd(), relativeTarget);
  const stats = statSync(absoluteTarget);

  if (stats.isFile()) {
    return isTrackedSourceFile(relativeTarget) ? [normalizePath(relativeTarget)] : [];
  }

  const discovered: string[] = [];
  for (const entry of readdirSync(absoluteTarget, { withFileTypes: true })) {
    const childRelativePath = normalizePath(path.join(relativeTarget, entry.name));
    if (entry.isDirectory()) {
      discovered.push(...walkFiles(childRelativePath));
      continue;
    }
    if (entry.isFile() && isTrackedSourceFile(childRelativePath)) {
      discovered.push(childRelativePath);
    }
  }

  return discovered;
}

function collectEntries(): BaselineEntry[] {
  const files = [...new Set(TARGETS.flatMap((target) => walkFiles(target)))].sort();
  const entries: BaselineEntry[] = [];

  for (const file of files) {
    const absoluteFile = path.resolve(process.cwd(), file);
    const lines = readFileSync(absoluteFile, 'utf8').split(/\r?\n/);

    lines.forEach((line) => {
      const matches = line.match(MATCH_PATTERN);
      if (!matches) return;

      const counts = new Map<string, number>();
      matches.forEach((match) => {
        counts.set(match, (counts.get(match) ?? 0) + 1);
      });

      counts.forEach((count, kind) => {
        entries.push({
          file,
          kind,
          text: line.trimEnd(),
          count,
        });
      });
    });
  }

  return entries.sort((left, right) => {
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.text.localeCompare(right.text);
  });
}

function entryKey(entry: BaselineEntry): string {
  return `${entry.file}::${entry.kind}::${entry.text}`;
}

function loadBaseline(): BaselineFile {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
}

function buildCounts(entries: BaselineEntry[]): Map<string, number> {
  const counts = new Map<string, number>();

  entries.forEach((entry) => {
    const key = entryKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + entry.count);
  });

  return counts;
}

function uniqueEntries(entries: BaselineEntry[]): BaselineEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const currentEntries = collectEntries();

if (WRITE_BASELINE) {
  const nextBaseline: BaselineFile = {
    description:
      'Known explicit any/ts-ignore/ts-nocheck usages in pilot-grade sensitive HANDOVER source paths. New entries fail CI until reviewed.',
    generatedFrom: TARGETS,
    entries: currentEntries,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8');
  console.log(`Updated sensitive any baseline at ${normalizePath(path.relative(process.cwd(), BASELINE_PATH))}.`);
  process.exit(0);
}

const baseline = loadBaseline();
const baselineCounts = buildCounts(baseline.entries);
const currentCounts = buildCounts(currentEntries);

const unexpectedEntries = uniqueEntries(currentEntries).filter((entry) => {
  const baselineCount = baselineCounts.get(entryKey(entry)) ?? 0;
  const currentCount = currentCounts.get(entryKey(entry)) ?? 0;
  return currentCount > baselineCount;
});
const removedEntries = uniqueEntries(baseline.entries).filter((entry) => {
  const currentCount = currentCounts.get(entryKey(entry)) ?? 0;
  const baselineCount = baselineCounts.get(entryKey(entry)) ?? 0;
  return baselineCount > currentCount;
});

if (unexpectedEntries.length > 0) {
  console.error('Sensitive any gate failed. Review the new usages before merging:');
  unexpectedEntries.forEach((entry) => {
    const key = entryKey(entry);
    const baselineCount = baselineCounts.get(key) ?? 0;
    const currentCount = currentCounts.get(key) ?? 0;
    console.error(`- ${entry.file} [${entry.kind}] (+${currentCount - baselineCount}): ${entry.text.trim()}`);
  });
  console.error('If an explicit any is truly required, document the reason and refresh the baseline with `pnpm gate:any-sensitive:write`.');
  process.exit(1);
}

console.log(`Sensitive any gate passed (${currentEntries.length} baseline entries, no regressions).`);
if (removedEntries.length > 0) {
  console.log('Info: baseline can be reduced because some legacy usages disappeared:');
  removedEntries.forEach((entry) => {
    console.log(`- ${entry.file} [${entry.kind}]: ${entry.text.trim()}`);
  });
}

