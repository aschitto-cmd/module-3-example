// Module 3: search_docs. The passages and their embeddings were made once by
// `npm run build-index` and saved in lib/copper/data/doc-index.json. This file
// loads that one file into memory when the server starts, so answering a
// question only has to embed the question, then find the closest passages.
import { callEmbed } from "@/lib/ai/call";
import { DOCUMENTS } from "@/lib/copper/documents";
import index from "@/lib/copper/data/doc-index.json";

type Passage = {
  id: string;
  documentId: string;
  title: string;
  page: number;
  text: string;
  embedding: number[];
};

// Loaded once, kept in memory for every question after.
const PASSAGES: Passage[] = index.passages;

export const TOP_K = 5;

export type DocMatch = {
  title: string;
  page: number;
  text: string;
  /** Opens the PDF at that page. */
  url: string;
  /** Cosine similarity: closer to 1 means closer in meaning. */
  score: number;
};

export type DocSearch = { query: string; matches: DocMatch[] };

/** Both vectors have length 1, so the dot product is the cosine similarity. */
function similarity(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function normalise(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

/** The passages whose meaning is closest to an already-embedded question. */
export function closestPassages(query: number[], count = TOP_K): DocMatch[] {
  const q = normalise(query);
  return PASSAGES.map((p) => ({ p, score: similarity(q, p.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ p, score }) => {
      const file = DOCUMENTS.find((d) => d.id === p.documentId)?.file ?? "";
      return {
        title: p.title,
        page: p.page,
        text: p.text,
        url: `${file}#page=${p.page}`,
        score: Math.round(score * 1000) / 1000,
      };
    });
}

/** search_docs: embeds the question and returns the 5 closest passages. */
export async function searchDocs(query: string): Promise<DocSearch> {
  const embedding = await callEmbed(
    { module: 3, feature: "search-docs" },
    query,
  );
  return { query, matches: closestPassages(embedding) };
}
