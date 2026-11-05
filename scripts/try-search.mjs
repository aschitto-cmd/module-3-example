// npm run try-search -- "reset Wi-Fi": shows the 5 passages search_docs would
// return for a question, using the same model, size and maths as the app.
import { readFileSync } from "node:fs";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embed } from "ai";

const queries = process.argv.slice(2);
if (queries.length === 0) queries.push("reset Wi-Fi");
const index = JSON.parse(
  readFileSync("lib/copper/data/doc-index.json", "utf8"),
);
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
});

for (const query of queries) {
  const { embedding } = await embed({
    model: google.embedding(index.model),
    value: query,
    providerOptions: {
      google: {
        outputDimensionality: index.dimensions,
        taskType: "RETRIEVAL_QUERY",
      },
    },
  });
  const norm = Math.sqrt(embedding.reduce((s, x) => s + x * x, 0));
  const q = embedding.map((x) => x / norm);
  const top = index.passages
    .map((p) => ({
      p,
      score: p.embedding.reduce((s, x, i) => s + x * q[i], 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  console.log(`\n"${query}"`);
  for (const { p, score } of top)
    console.log(
      `  ${score.toFixed(3)}  ${p.title}, page ${p.page}: ${p.text.slice(p.title.length + 2, p.title.length + 110)}`,
    );
}
