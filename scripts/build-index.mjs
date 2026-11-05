// npm run build-index: the one-time, slow step of RAG.
// Reads every PDF listed in lib/copper/documents.ts (from public/docs/),
// cuts each page into passages of a few sentences, starts each passage with
// its document title, embeds every passage with Gemini's embedding model and
// saves everything to lib/copper/data/doc-index.json. The app loads that one
// file into memory when it starts, so a question only has to embed itself.
//
// Run with the key in the environment, e.g. via the npm script, which uses
// node --env-file=.env.local so the key never appears on screen.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany } from "ai";
import { extractText, getDocumentProxy } from "unpdf";

const EMBEDDING_MODEL = "gemini-embedding-001";
const DIMENSIONS = 768; // smaller file, still plenty for four documents
const SENTENCES_PER_PASSAGE = 3;
const MAX_PASSAGE_CHARS = 700;
const OUT_FILE = "lib/copper/data/doc-index.json";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
if (!apiKey) {
  console.error(
    "GOOGLE_GENERATIVE_AI_API_KEY is not set. Run: npm run build-index",
  );
  process.exit(1);
}

// documents.ts is TypeScript, so pull each document's id, title and file out of it.
const source = readFileSync("lib/copper/documents.ts", "utf8");
const documents = [
  ...source.matchAll(
    /id:\s*"([^"]+)",\s*title:\s*"([^"]+)"[\s\S]*?file:\s*"([^"]+)"/g,
  ),
].map(([, id, title, file]) => ({ id, title, file }));
if (documents.length === 0)
  throw new Error("No documents found in documents.ts");

/** Splits a page's text into sentences. */
function sentences(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(•])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Groups sentences into passages of a few sentences, capped in length. */
function passagesOf(pageText) {
  const out = [];
  let current = [];
  const flush = () => {
    if (current.length) out.push(current.join(" "));
    current = [];
  };
  for (const sentence of sentences(pageText)) {
    const length = current.join(" ").length + sentence.length;
    if (
      current.length >= SENTENCES_PER_PASSAGE ||
      (current.length && length > MAX_PASSAGE_CHARS)
    )
      flush();
    current.push(sentence);
  }
  flush();
  // A trailing scrap (a page number, a stray heading) joins the passage before it.
  if (out.length > 1 && out.at(-1).length < 40) {
    const scrap = out.pop();
    out[out.length - 1] += ` ${scrap}`;
  }
  return out;
}

const passages = [];
for (const doc of documents) {
  const bytes = new Uint8Array(readFileSync(join("public", doc.file)));
  const pdf = await getDocumentProxy(bytes);
  const { text: pages } = await extractText(pdf, { mergePages: false });
  pages.forEach((pageText, i) => {
    for (const body of passagesOf(pageText)) {
      passages.push({
        id: `${doc.id}-p${i + 1}-${passages.length}`,
        documentId: doc.id,
        title: doc.title,
        page: i + 1,
        // The title first, so the embedding knows which document this is from.
        text: `${doc.title}. ${body}`,
      });
    }
  });
}

console.log(`Embedding ${passages.length} passages with ${EMBEDDING_MODEL}...`);
const google = createGoogleGenerativeAI({ apiKey });
const { embeddings } = await embedMany({
  model: google.embedding(EMBEDDING_MODEL),
  values: passages.map((p) => p.text),
  providerOptions: {
    google: {
      outputDimensionality: DIMENSIONS,
      taskType: "RETRIEVAL_DOCUMENT",
    },
  },
  maxRetries: 5,
});

// Shortened embeddings aren't unit length; normalise so a dot product is cosine similarity.
const normalise = (v) => {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
};

const index = {
  model: EMBEDDING_MODEL,
  dimensions: DIMENSIONS,
  createdAt: new Date().toISOString(),
  passages: passages.map((p, i) => ({
    ...p,
    embedding: normalise(embeddings[i]),
  })),
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(index));

console.log(`Saved ${OUT_FILE}`);
for (const doc of documents) {
  const n = passages.filter((p) => p.documentId === doc.id).length;
  console.log(`  ${doc.title}: ${n} passages`);
}
