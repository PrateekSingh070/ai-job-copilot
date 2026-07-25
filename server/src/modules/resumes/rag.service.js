import { nanoid } from "nanoid";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { sanitizeForAiPrompt } from "../../utils/aiPromptSanitize.js";

// Split resume text into chunks of at most `maxChunk` characters, keeping whole
// paragraphs together where possible so each embedding covers coherent context.
function chunkText(raw, maxChunk = 900) {
  const text = sanitizeForAiPrompt(raw, 100_000);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const wouldOverflow = (current + "\n\n" + paragraph).length > maxChunk;
    if (wouldOverflow && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  // Fallback: a single paragraph longer than maxChunk gets hard-split by length.
  if (chunks.length === 0 && text.trim()) {
    for (let i = 0; i < text.length; i += maxChunk) {
      chunks.push(text.slice(i, i + maxChunk));
    }
  }
  return chunks;
}

export async function embedOpenAITexts(texts) {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(
      400,
      "OPENAI_KEY_MISSING",
      "OPENAI_API_KEY is required for embeddings and RAG.",
    );
  }
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: texts,
    }),
  });
  if (!response.ok) {
    throw new ApiError(
      502,
      "OPENAI_EMBED_ERROR",
      "Embedding request failed",
      await response.text(),
    );
  }
  const data = await response.json();
  return data.data.map((item) => item.embedding);
}

// pgvector expects a bracketed, comma-separated literal, e.g. "[0.1,0.2,...]".
function toVectorLiteral(vector) {
  return `[${vector.join(",")}]`;
}

export async function replaceMasterResumeEmbeddings(input) {
  const safeTitle = sanitizeForAiPrompt(input.title, 200);
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    throw new ApiError(
      400,
      "RESUME_EMPTY",
      "Resume content is empty after sanitization",
    );
  }

  const embeddings = await embedOpenAITexts(chunks);

  const existing = await prisma.resumeProfile.findFirst({
    where: { userId: input.userId, isMaster: true },
  });
  if (existing) {
    await prisma.resumeEmbedding.deleteMany({
      where: { profileId: existing.id },
    });
    await prisma.resumeProfile.delete({ where: { id: existing.id } });
  }

  const profile = await prisma.resumeProfile.create({
    data: {
      userId: input.userId,
      title: safeTitle,
      content: sanitizeForAiPrompt(input.content, 100_000),
      isMaster: true,
    },
  });

  for (let i = 0; i < chunks.length; i++) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ResumeEmbedding" ("id","userId","profileId","chunkText","chunkIndex",embedding)
       VALUES ($1,$2,$3,$4,$5,$6::vector)`,
      nanoid(),
      input.userId,
      profile.id,
      chunks[i],
      i,
      toVectorLiteral(embeddings[i]),
    );
  }

  return { profileId: profile.id, chunks: chunks.length };
}

export async function retrieveRelevantResumeContext(input) {
  const safeQuery = sanitizeForAiPrompt(input.query, env.AI_MAX_INPUT_CHARS);
  const [queryEmbedding] = await embedOpenAITexts([safeQuery]);

  // `<=>` is pgvector's cosine-distance operator, so the nearest chunks (most
  // relevant to the query) come first.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "chunkText" FROM "ResumeEmbedding"
     WHERE "userId" = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    input.userId,
    toVectorLiteral(queryEmbedding),
    input.topK,
  );

  return rows.map((row) => row.chunkText).join("\n\n---\n\n");
}
