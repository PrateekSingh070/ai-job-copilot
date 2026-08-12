import { nanoid } from "nanoid";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { sanitizeForAiPrompt } from "../../utils/aiPromptSanitize.js";

function chunkText(raw: string, maxChunk = 900): string[] {
  const text = sanitizeForAiPrompt(raw, 100_000);
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length > maxChunk && buf) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push(buf);
  if (chunks.length === 0 && text.trim()) {
    for (let i = 0; i < text.length; i += maxChunk) {
      chunks.push(text.slice(i, i + maxChunk));
    }
  }
  return chunks;
}

export async function embedOpenAITexts(texts: string[]): Promise<number[][]> {
  if (!env.OPENAI_API_KEY) {
    throw new ApiError(
      400,
      "OPENAI_KEY_MISSING",
      "OPENAI_API_KEY is required for embeddings and RAG.",
    );
  }
  const res = await fetch("https://api.openai.com/v1/embeddings", {
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
  if (!res.ok) {
    throw new ApiError(
      502,
      "OPENAI_EMBED_ERROR",
      "Embedding request failed",
      await res.text(),
    );
  }
  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data.map((d) => d.embedding);
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function replaceMasterResumeEmbeddings(input: {
  userId: string;
  title: string;
  content: string;
}): Promise<{ profileId: string; chunks: number }> {
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
    const id = nanoid();
    const vecLiteral = toVectorLiteral(embeddings[i]!);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ResumeEmbedding" ("id","userId","profileId","chunkText","chunkIndex",embedding)
       VALUES ($1,$2,$3,$4,$5,$6::vector)`,
      id,
      input.userId,
      profile.id,
      chunks[i],
      i,
      vecLiteral,
    );
  }

  return { profileId: profile.id, chunks: chunks.length };
}

export async function retrieveRelevantResumeContext(input: {
  userId: string;
  query: string;
  topK: number;
}): Promise<string> {
  const safeQuery = sanitizeForAiPrompt(input.query, env.AI_MAX_INPUT_CHARS);
  const [qEmb] = await embedOpenAITexts([safeQuery]);
  const vecLiteral = toVectorLiteral(qEmb!);

  const rows = await prisma.$queryRawUnsafe<Array<{ chunkText: string }>>(
    `SELECT "chunkText" FROM "ResumeEmbedding"
     WHERE "userId" = $1
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    input.userId,
    vecLiteral,
    input.topK,
  );

  return rows.map((r) => r.chunkText).join("\n\n---\n\n");
}
