const fs = require('node:fs/promises');
const path = require('node:path');
const { ESLint } = require('eslint');

const compareCounts = (left, right) =>
  right.errors + right.warnings - left.errors - left.warnings || left.name.localeCompare(right.name);

const isUnavailableRule = (message) => message.ruleId && (
  message.message === `Definition for rule '${message.ruleId}' was not found.` ||
  message.message.startsWith(`Rule '${message.ruleId}' was removed and replaced by: `)
);

async function main() {
  await fs.rm('artifacts/eslint-ts-baseline.json', { force: true });
  await fs.rm('artifacts/eslint-ts-baseline.md', { force: true });
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['**/*.{ts,tsx}']);
  const files = results.map((result) => ({
    name: path.relative(process.cwd(), result.filePath).replaceAll('\\', '/'),
    errors: result.errorCount,
    warnings: result.warningCount,
  })).sort((left, right) => left.name.localeCompare(right.name));

  if (!files.some((file) => file.name.endsWith('.ts')) ||
      !files.some((file) => file.name.endsWith('.tsx'))) {
    throw new Error('ESLint did not analyze both TypeScript and TSX files');
  }

  const invalid = results.flatMap((result) =>
    result.messages.filter((message) => message.fatal || isUnavailableRule(message)).map((message) =>
      `${path.relative(process.cwd(), result.filePath)}: ${message.message}`));
  if (invalid.length > 0) {
    throw new Error(`ESLint configuration or parsing failed:\n${invalid.join('\n')}`);
  }

  const byRule = new Map();
  for (const result of results) {
    for (const message of result.messages) {
      const name = message.ruleId || (message.message.startsWith('Unused eslint-disable directive')
        ? 'eslint/unused-disable'
        : 'eslint/unclassified');
      const counts = byRule.get(name) || { name, errors: 0, warnings: 0 };
      if (message.severity === 2) counts.errors += 1;
      if (message.severity === 1) counts.warnings += 1;
      byRule.set(name, counts);
    }
  }

  const report = {
    filesAnalyzed: files.length,
    tsFiles: files.filter((file) => file.name.endsWith('.ts')).length,
    tsxFiles: files.filter((file) => file.name.endsWith('.tsx')).length,
    errors: files.reduce((total, file) => total + file.errors, 0),
    warnings: files.reduce((total, file) => total + file.warnings, 0),
    byRule: [...byRule.values()].sort(compareCounts),
    top20Files: [...files].sort(compareCounts).slice(0, 20),
    files,
  };

  const lines = [
    '### TypeScript ESLint baseline (non-blocking rule debt)',
    `- Files analyzed: ${report.filesAnalyzed} (${report.tsFiles} TS, ${report.tsxFiles} TSX)`,
    `- Rule violations: ${report.errors} errors, ${report.warnings} warnings`,
    '',
    '| Rule | Errors | Warnings |',
    '| --- | ---: | ---: |',
    ...report.byRule.map((rule) => `| ${rule.name} | ${rule.errors} | ${rule.warnings} |`),
    '',
    '| Top 20 files | Errors | Warnings |',
    '| --- | ---: | ---: |',
    ...report.top20Files.map((file) => `| ${file.name} | ${file.errors} | ${file.warnings} |`),
    '',
  ];
  await fs.mkdir('artifacts', { recursive: true });
  await fs.writeFile('artifacts/eslint-ts-baseline.json', `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile('artifacts/eslint-ts-baseline.md', `${lines.join('\n')}\n`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
