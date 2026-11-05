# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 3 starter: Ask Copper

**Summary:** Ask Copper, the Module 2 shopping chatbot, finished: a floating
chat panel that answers prices, totals and stock with four tools and shows
each step. Module 3 teaches it to answer from the customer documents.

| Piece | Where | What it does |
|---|---|---|
| Component | `components/copper/ask-copper.tsx` | The launcher and chat panel, mounted from `app/page.tsx` and opened by the header's `#ask` link. Draws each answer as stations: the tools on offer, thinking, each tool call, then the reply |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()`: streams the conversation with `callStream`, up to 5 steps, and sends each step back as a live `Progress` |
| Tools | `lib/copper/assistant/tools.ts` | `copperTools`: `get_products`, `get_prices`, `calculate_cost`, `check_availability` |
| Instructions | `lib/copper/assistant/instructions.ts` | `COPPER_INSTRUCTIONS`. Copper says it can't help yet with warranty, setup, troubleshooting or privacy |
| Data | `lib/copper/inventory.ts`, `lib/copper/documents.ts` | Stock from `lib/copper/data/inventory.json`; `DOCUMENTS`: the four customer documents and their PDF paths under `public/docs/`. The PDFs are added in class |
| AI calls | `{ module: 2, feature: "ask-copper" }` | One streamed call per question |

## Module 3: search_docs (RAG over the customer documents)

**Summary:** Ask Copper can now answer setup, troubleshooting, warranty and
policy questions from the four PDFs, citing the document and page, with a
fifth tool, `search_docs`.

| Piece | Where | What it does |
|---|---|---|
| Documents | `public/docs/*.pdf` | The four customer PDFs, served at the paths in `lib/copper/documents.ts` |
| Index build | `scripts/build-index.mjs` (`npm run build-index`) | One-time: splits each page into passages of up to 3 sentences, starts each with its document title, embeds them all and writes `lib/copper/data/doc-index.json` (131 passages, 768 numbers each) |
| Search | `lib/copper/assistant/search-docs.ts` | Loads the index into memory when the server starts; embeds the question and returns the 5 passages with the highest cosine similarity, each with title, page and a `/docs/<file>.pdf#page=N` link |
| Tool | `lib/copper/assistant/tools.ts` | `search_docs({ query })` |
| Instructions | `lib/copper/assistant/instructions.ts` | Use `search_docs` for setup, troubleshooting, warranty and policy; answer only from the passages and cite document and page |
| Component | `components/copper/ask-copper.tsx` | The `search_docs` tool card lists the 5 passages as links that open the PDF at that page, with their scores |
| AI calls | `callEmbed` in `lib/ai/call.ts`, `{ module: 3, feature: "search-docs" }` | `gemini-embedding-001`, one short embedding per question (a fraction of a cent) |
| Try it | `npm run try-search -- "reset Wi-Fi"` | Prints the 5 closest passages for a question, without the chat |

**Data flow:** question → `askCopper` → model calls `search_docs` → embed the
question → compare with every passage in memory → top 5 back to the model →
reply with citations.

**Decisions and trade-offs:** no database: four documents (about 1 MB of
numbers) fit in memory. 768 dimensions instead of 3,072 keeps the file small.
The build script calls Google directly because it's a plain Node script and
can't import `lib/ai/call.ts`; the app's question-time call goes through
`callEmbed`. Re-run `npm run build-index` whenever a PDF changes.

**Risks and open questions:** passages are cut by sentence, so a table row
can be split across two passages (C-47's meaning and its "contact the Copper
Crew" line land in neighbouring passages; both are usually in the top 5).
