import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse';

type CsvRow = {
  id: string;
  ministry?: string;
  type?: string;
  name: string;
  chapter_id?: string;
  chapter_name: string;
  article: string;
  content: string;
  type_normalized?: string;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envOptionalInt(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fnv1a32(input: string): number {
  // Fast deterministic hash for sampling
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function maybeTruncate(text: string, maxChars: number | null): string {
  if (!maxChars) return text;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trimEnd() + '…';
}

function buildRef(row: CsvRow): string {
  const safe = (s: string | undefined) => (s ?? '').trim();
  return [safe(row.id), safe(row.chapter_name), safe(row.article)].join('::');
}

async function streamCsv(params: {
  csvPath: string;
  onRow: (row: CsvRow) => void;
}): Promise<void> {
  const { csvPath, onRow } = params;

  await new Promise<void>((resolve, reject) => {
    const parser = parse({
      columns: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    });

    parser.on('readable', () => {
      let record: CsvRow | null;
      while ((record = parser.read()) !== null) {
        onRow(record);
      }
    });

    parser.on('error', reject);
    parser.on('end', () => resolve());

    fs.createReadStream(csvPath).on('error', reject).pipe(parser);
  });
}

async function main() {
  const projectRoot = process.cwd();
  const csvPath = path.resolve(projectRoot, '..', 'Data', 'top5_documents.csv');
  const outDir = path.resolve(projectRoot, '.rag');
  const dbPath = path.resolve(outDir, 'rag.db');
  const metaPath = path.resolve(outDir, 'meta.json');

  // Slim mode knobs (optional)
  // - RAG_SAMPLE_EVERY=2  => keep ~50% rows (deterministic by ref hash)
  // - RAG_MAX_CONTENT_CHARS=2000 => truncate each article content
  const sampleEvery = envInt('RAG_SAMPLE_EVERY', 1);
  const maxContentChars = envOptionalInt('RAG_MAX_CONTENT_CHARS');

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });

  console.log(`Building SQLite FTS index...`);
  console.log(`CSV: ${csvPath}`);
  console.log(`DB:  ${dbPath}`);
  console.log(`Options: RAG_SAMPLE_EVERY=${sampleEvery}, RAG_MAX_CONTENT_CHARS=${maxContentChars ?? 'none'}`);

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE VIRTUAL TABLE docs_fts USING fts5(
      ref,
      id,
      name,
      chapter_name,
      article,
      content
    );
  `);

  const insertStmt = db.prepare(
    'INSERT INTO docs_fts (ref, id, name, chapter_name, article, content) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const insertBatch = db.transaction((rows: Array<[string, string, string, string, string, string]>) => {
    for (const r of rows) insertStmt.run(...r);
  });

  const batch: Array<[string, string, string, string, string, string]> = [];
  const BATCH_SIZE = 1000;
  let count = 0;
  let seen = 0;
  let sampledOut = 0;
  let skipped = 0;

  const flush = () => {
    if (!batch.length) return;
    insertBatch(batch);
    batch.length = 0;
  };

  await streamCsv({
    csvPath,
    onRow: (row) => {
      seen += 1;
      if (!row.id || !row.name || !row.chapter_name || !row.article || !row.content) {
        skipped += 1;
        return;
      }

      const ref = buildRef(row);

      if (sampleEvery > 1) {
        const h = fnv1a32(ref);
        if (h % sampleEvery !== 0) {
          sampledOut += 1;
          return;
        }
      }

      const content = maybeTruncate(row.content, maxContentChars);
      batch.push([ref, row.id, row.name, row.chapter_name, row.article, content]);
      count += 1;

      if (batch.length >= BATCH_SIZE) {
        flush();
        if (count % 50000 === 0) console.log(`Inserted ${count} rows...`);
      }
    },
  });

  flush();

  console.log('Optimizing FTS index...');
  db.exec("INSERT INTO docs_fts(docs_fts) VALUES('optimize');");
  db.exec('ANALYZE;');
  db.close();

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        options: {
          sampleEvery,
          maxContentChars,
        },
        seen,
        docs: count,
        skipped,
        sampledOut,
        csvPath: path.relative(projectRoot, csvPath),
        dbPath: path.relative(projectRoot, dbPath),
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Done. Indexed ${count} rows (skipped ${skipped}).`);
  console.log(`Wrote: ${path.relative(projectRoot, dbPath)}`);
  console.log(`Wrote: ${path.relative(projectRoot, metaPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
