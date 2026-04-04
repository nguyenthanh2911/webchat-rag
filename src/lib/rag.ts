import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type RagDoc = {
  ref: string;
  id: string;
  name: string;
  chapter_name: string;
  article: string;
  content: string;
  ministry?: string;
  type?: string;
  type_normalized?: string;
};

export type Citation = {
  id: string;
  name: string;
  chapter_name: string;
  article: string;
  quote: string;
  ref: string;
  score?: number;
};

type RagDb = {
  db: Database.Database;
  searchStmt: Database.Statement;
};

let cachedDb: RagDb | null = null;

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/[\t\u00A0]+/g, ' ')
    .replace(/[“”"'`]/g, ' ')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[,:;.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'thông',
  'tư',
  'nghị',
  'định',
  'quy',
  'định',
  'văn',
  'bản',
  'này',
  'là',
  'về',
  'của',
  'và',
  'cho',
  'đối',
  'với',
  'theo',
]);

function tokenizeForSearch(query: string): string[] {
  const normalized = normalizeText(query);
  return normalized
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => t.length >= 2 || /\d/.test(t))
    .filter((t) => {
      const isAlphaOnly = /^\p{L}+$/u.test(t);
      if (isAlphaOnly && t.length <= 4 && STOPWORDS.has(t)) return false;
      return true;
    });
}

function buildMatchQuery(question: string): string {
  const q = normalizeText(question);

  // Common legal intents: prefer matching the article title.
  const phraseBoosts = [
    'đối tượng áp dụng',
    'phạm vi điều chỉnh',
    'giải thích từ ngữ',
    'hiệu lực thi hành',
    'điều khoản thi hành',
    'trách nhiệm thi hành',
  ];
  for (const phrase of phraseBoosts) {
    if (q.includes(phrase)) {
      // Search phrase in article first; still allow content as fallback.
      return `article:"${phrase}" OR content:"${phrase}"`;
    }
  }

  // If user explicitly mentions "Điều <number>", anchor to article.
  const m = q.match(/điều\s+(\d{1,3})/);
  if (m?.[1]) {
    return `article:"điều ${m[1]}" OR article:${m[1]} OR content:"điều ${m[1]}"`;
  }

  const tokens = tokenizeForSearch(question);
  if (!tokens.length) return '';
  return tokens.map((t) => `"${t.replaceAll('"', '')}"`).join(' AND ');
}

function getArtifactsDir(): string {
  return path.resolve(process.cwd(), '.rag');
}

function loadDb(): RagDb {
  if (cachedDb) return cachedDb;

  const dir = getArtifactsDir();
  const dbPath = path.resolve(dir, 'rag.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`RAG DB not found. Run: npm run build:index (expected ${dbPath})`);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const searchStmt = db.prepare(
    `
      SELECT
        ref,
        id,
        name,
        chapter_name,
        article,
        content,
        bm25(docs_fts) AS score
      FROM docs_fts
      WHERE docs_fts MATCH ?
      ORDER BY score
      LIMIT ?;
    `.trim(),
  );

  cachedDb = { db, searchStmt };
  return cachedDb;
}

function firstSentences(text: string, maxChars = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trimEnd() + '…';
}

export function retrieve(query: string, k = 5): { docs: RagDoc[]; citations: Citation[] } {
  const match = buildMatchQuery(query);
  if (!match) return { docs: [], citations: [] };
  const { searchStmt } = loadDb();

  // Pull a wider candidate set then lightly re-rank, to improve relevance on generic queries.
  const candidateLimit = Math.max(20, k * 8);
  const rows = searchStmt.all(match, candidateLimit) as Array<
    RagDoc & {
      score: number;
    }
  >;

  const qNorm = normalizeText(query);
  const reranked = rows
    .map((r) => {
      let boost = 0;
      const articleNorm = normalizeText(r.article);
      if (qNorm.includes('đối tượng áp dụng') && articleNorm.includes('đối tượng áp dụng')) boost += 5;
      if (qNorm.includes('phạm vi điều chỉnh') && articleNorm.includes('phạm vi điều chỉnh')) boost += 5;
      if (qNorm.includes('giải thích từ ngữ') && articleNorm.includes('giải thích từ ngữ')) boost += 5;
      const m = qNorm.match(/điều\s+(\d{1,3})/);
      if (m?.[1] && articleNorm.includes(`điều ${m[1]}`)) boost += 6;
      return { row: r, boost };
    })
    // bm25 is "smaller is better"; boost pushes items earlier.
    .sort((a, b) => (a.row.score - a.boost) - (b.row.score - b.boost))
    .slice(0, k)
    .map((x) => x.row);

  const topDocs: RagDoc[] = [];
  const citations: Citation[] = [];

  for (const row of reranked) {
    const doc: RagDoc = {
      ref: row.ref,
      id: row.id,
      name: row.name,
      chapter_name: row.chapter_name,
      article: row.article,
      content: row.content,
    };
    topDocs.push(doc);
    citations.push({
      id: doc.id,
      name: doc.name,
      chapter_name: doc.chapter_name,
      article: doc.article,
      quote: firstSentences(doc.content),
      ref: doc.ref,
      score: row.score,
    });
  }

  return { docs: topDocs, citations };
}
