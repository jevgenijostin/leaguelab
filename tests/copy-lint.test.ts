import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test('G9: source and README obey the copy boundary', () => {
  const prohibited = /\b(odds|bet|bets|betting|wager|stake|bookmaker|bookie|gambl\w*|punter|payout|implied probability|value bet)\b/i;
  const violations: string[] = [];
  for (const file of [...files('src'), 'README.md']) {
    let content = readFileSync(file, 'utf8');
    if (file === 'README.md') content = content.replace(/<!-- scope-statement:start -->[\s\S]*?<!-- scope-statement:end -->/g, '');
    if (prohibited.test(content)) violations.push(file);
  }
  expect(violations).toEqual([]);
});
