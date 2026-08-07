import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/http.js";
import { postJsonWithRetry } from "./aiFetch.js";

// Anthropic has no embeddings API, so embeddings get their own provider switch
// independent of AI_PROVIDER. Mock returns a deterministic hashed bag-of-words
// projection that produces genuine lexical similarity — good enough for offline
// demos and network-free tests. OpenAI uses text-embedding-3-small (1536 dims).

/**
 * Simple bag-of-words hash → projection. Deterministic, no API key needed, and
 * produces cosine similarity that mirrors term overlap. This is not a toy — a
 * lexical baseline like this would be the first thing you'd build to validate
 * that RAG retrieval is working before you pay for real embeddings.
 */
function mockEmbed(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // 1536-dim vector, all zeros initially.
  const vec = new Float32Array(1536);

  // Each word hashes to a dimension and adds a small value there.
  for (const word of words) {
    const hash = crypto.createHash("sha256").update(word).digest();
    const idx = hash.readUInt16BE(0) % 1536;
    vec[idx] += 1.0;
  }

  // L2 normalize so cosine similarity is just the dot product.
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i += 1) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

async function openaiEmbed(text) {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(
      400,
      "OPENAI_KEY_MISSING",
      "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai",
    );
  }

  const model = env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const data = await postJsonWithRetry({
    url: "https://api.openai.com/v1/embeddings",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: { model, input: text },
    errorCode: "OPENAI_EMBEDDING_ERROR",
    label: "OpenAI embeddings",
  });

  return data.data?.[0]?.embedding ?? [];
}

/**
 * Returns a 1536-dim embedding vector as a plain number array. Both paths
 * return the same shape, so the caller (and the `vector(1536)` column type)
 * never change between mock and openai.
 */
export async function generateEmbedding(text) {
  if (env.EMBEDDING_PROVIDER === "openai") {
    return openaiEmbed(text);
  }
  return mockEmbed(text);
}
