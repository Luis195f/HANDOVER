const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');

const measuredOnly = new Set([
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-unused-vars',
  '@typescript-eslint/no-require-imports',
]);

const legacy = [
  {
    file: 'src/lib/priority.ts',
    rule: '@typescript-eslint/no-empty-object-type',
    text: 'export interface PriorityInput extends MPACInput {}',
    reason: 'Existing compatibility interface; changing the priority contract is outside C09B.',
  },
  {
    file: 'vitest.setup.ts',
    rule: '@typescript-eslint/triple-slash-reference',
    text: '/// <reference types="vitest" />',
    reason: 'Existing Vitest setup reference; changing test initialization is outside C09B.',
  },
  {
    file: 'src/lib/prefill.ts',
    rule: 'prefer-const',
    text: 'let priority: "low" | "medium" | "high" =',
    reason: 'Existing prefill declaration; clinical code is not changed for lint migration.',
  },
];

const entryKey = (file, rule, text) => JSON.stringify([file, rule, text]);
const allowances = new Map(legacy.map((entry) => [entryKey(entry.file, entry.rule, entry.text), 1]));

const isUnavailableRule = (message) => message.ruleId && (
  message.message === `Definition for rule '${message.ruleId}' was not found.` ||
  message.message.startsWith(`Rule '${message.ruleId}' was removed and replaced by: `)
);

async function main() {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['**/*.{ts,tsx}']);
  const files = results.map((result) => path.relative(process.cwd(), result.filePath).replaceAll('\\', '/'));
  if (!files.some((file) => file.endsWith('.ts')) || !files.some((file) => file.endsWith('.tsx'))) {
    throw new Error('ESLint did not analyze both TypeScript and TSX files');
  }

  const invalid = [];
  const violations = [];
  for (const result of results) {
    const file = path.relative(process.cwd(), result.filePath).replaceAll('\\', '/');
    const lines = fs.readFileSync(result.filePath, 'utf8').split(/\r?\n/);
    for (const message of result.messages) {
      const diagnostic = `${file}:${message.line}:${message.column} ${message.ruleId || 'parser'}: ${message.message}`;
      if (message.fatal || isUnavailableRule(message)) {
        invalid.push(diagnostic);
        continue;
      }
      if (measuredOnly.has(message.ruleId)) continue;
      if (!message.ruleId && message.severity === 1 &&
          message.message.startsWith('Unused eslint-disable directive')) continue;
      const key = entryKey(file, message.ruleId, lines[message.line - 1]?.trim());
      const remaining = allowances.get(key) || 0;
      if (remaining > 0) {
        allowances.set(key, remaining - 1);
      } else {
        violations.push(diagnostic);
      }
    }
  }
  if (invalid.length) throw new Error(`Invalid TypeScript lint execution:\n${invalid.join('\n')}`);
  if (violations.length) throw new Error(`Blocking TypeScript lint violations:\n${violations.join('\n')}`);
  const stale = legacy.filter((entry) => allowances.get(entryKey(entry.file, entry.rule, entry.text)));
  if (stale.length) throw new Error(`Unused legacy allowances must be removed:\n${stale.map((entry) =>
    `${entry.file} ${entry.rule}: ${entry.reason}`).join('\n')}`);
  console.log(`TypeScript lint gate passed (${files.length} files; ${legacy.length} scoped legacy allowances).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
