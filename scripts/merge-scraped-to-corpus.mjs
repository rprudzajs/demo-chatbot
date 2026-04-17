#!/usr/bin/env node
/**
 * Concatenate data/scraped/pages/*.json into one markdown file for humans + RAG prep.
 *
 *   npm run scrape:ald:merge
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'data', 'scraped', 'pages');
const OUT = path.join(ROOT, 'data', 'scraped', 'corpus.md');

async function main() {
  const names = (await readdir(PAGES_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (names.length === 0) {
    console.error('No JSON files in', PAGES_DIR, '— run npm run scrape:ald first');
    process.exit(1);
  }

  const parts = [
    '# Scraped site corpus',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Pages: ${names.length}`,
    '',
    '---',
    '',
  ];

  for (const name of names) {
    const raw = await readFile(path.join(PAGES_DIR, name), 'utf8');
    const doc = JSON.parse(raw);
    parts.push(`## ${doc.title || '(no title)'}`);
    parts.push('');
    parts.push(`Source: ${doc.url}`);
    if (doc.canonical) {
      parts.push(`Canonical: ${doc.canonical}`);
    }
    if (doc.textMode) {
      parts.push(`Text mode: ${doc.textMode}`);
    }
    parts.push('');

    if (doc.headings?.length) {
      parts.push('### Headings');
      parts.push(doc.headings.join(' · '));
      parts.push('');
    }

    if (doc.meta && Object.keys(doc.meta).length > 0) {
      parts.push('### Meta tags');
      for (const [k, v] of Object.entries(doc.meta)) {
        parts.push(`- **${k}:** ${String(v).replace(/\n/g, ' ')}`);
      }
      parts.push('');
    }

    if (doc.jsonLd?.length) {
      parts.push('### JSON-LD (structured data)');
      for (let i = 0; i < doc.jsonLd.length; i += 1) {
        parts.push(`\`\`\`json`);
        parts.push(doc.jsonLd[i]);
        parts.push(`\`\`\``);
        parts.push('');
      }
    }

    parts.push('### Visible text');
    parts.push(doc.text || '');
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  await writeFile(OUT, parts.join('\n'), 'utf8');
  console.log('Wrote', OUT, `(${names.length} pages)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
