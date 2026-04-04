/**
 * When the workspace has embedded documents but the primary similarity search
 * returns no chunks (all scores below workspace.similarityThreshold), the LLM
 * still receives no document text in Context. Retry with similarityThreshold 0
 * so the top-N nearest chunks are always included (best-effort).
 *
 * Disable via env: RAG_PERMISSIVE_FALLBACK=false
 */

async function appendPermissiveRagIfEmpty({
  VectorDb,
  workspace,
  input,
  LLMConnector,
  pinnedDocIdentifiers,
  embeddingsCount,
  contextTexts,
  sources,
}) {
  if (
    String(process.env.RAG_PERMISSIVE_FALLBACK || "true").toLowerCase() ===
    "false"
  ) {
    return { contextTexts, sources };
  }

  if (
    !embeddingsCount ||
    !Array.isArray(contextTexts) ||
    contextTexts.length > 0
  ) {
    return { contextTexts, sources };
  }

  const safeInput = String(input ?? "").trim() || " ";
  const topN = Math.max((workspace?.topN || 15) * 3, 16);

  const res = await VectorDb.performSimilaritySearch({
    namespace: workspace.slug,
    input: safeInput,
    LLMConnector,
    similarityThreshold: 0,
    topN,
    filterIdentifiers: pinnedDocIdentifiers,
    rerank: workspace?.vectorSearchMode === "rerank",
  });

  if (res.message || !res.contextTexts?.length) {
    return { contextTexts, sources };
  }

  return {
    contextTexts: [...contextTexts, ...res.contextTexts],
    sources: [...sources, ...res.sources],
  };
}

module.exports = { appendPermissiveRagIfEmpty };
