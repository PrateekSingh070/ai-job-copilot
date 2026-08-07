import { ApiError } from "../../utils/http.js";
import { env } from "../../config/env.js";

// One HTTP helper for every outbound AI call (chat completions and embeddings,
// OpenAI and Anthropic alike). Bare `fetch` has no timeout, so a provider that
// accepts the connection and then stalls would hold the Express request open
// until the platform kills it — the failure mode that hurts most in production.

/**
 * Statuses worth trying again. 429 and 5xx are transient by definition; 408 is
 * the server telling us it timed out first. Everything else in the 4xx range is
 * our fault (bad key, bad model, malformed body) and retrying it just burns
 * quota to get the same answer three times.
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const BASE_BACKOFF_MS = 250;
/** Ceiling for a provider-supplied `Retry-After`, so it can't pin a request open. */
const MAX_RETRY_AFTER_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** AbortSignal.timeout rejects with a TimeoutError; an explicit abort gives AbortError. */
function isAbortError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

/**
 * `Retry-After` is either a seconds count or an HTTP date. Honour it when the
 * provider sends one — it knows its own rate window better than our backoff
 * curve does — but never wait longer than MAX_RETRY_AFTER_MS.
 */
function retryAfterMs(response, fallbackMs) {
  const header = response.headers.get("retry-after");
  if (!header) return fallbackMs;

  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();

  if (!Number.isFinite(ms) || ms <= 0) return fallbackMs;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

/**
 * POST JSON to an AI provider and return the parsed JSON body.
 *
 * Throws `ApiError` and nothing else, so callers never have to tell a network
 * failure apart from an HTTP failure:
 *  - 504 `AI_TIMEOUT` when every attempt timed out
 *  - 502 `<errorCode>` for provider errors and unparseable responses
 */
export async function postJsonWithRetry({
  url,
  headers,
  body,
  errorCode,
  label,
  timeoutMs = env.AI_REQUEST_TIMEOUT_MS,
  retries = env.AI_MAX_RETRIES,
}) {
  let lastAbort = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const isLastAttempt = attempt === retries;
    const backoffMs = BASE_BACKOFF_MS * 2 ** attempt;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        lastAbort = error;
        if (isLastAttempt) break;
        await sleep(backoffMs);
        continue;
      }
      // Anything else out of fetch is a transport failure (DNS, TLS, socket).
      // Worth one more try, but don't leak the underlying message to the client.
      if (isLastAttempt) {
        throw new ApiError(502, errorCode, `${label} request failed`);
      }
      await sleep(backoffMs);
      continue;
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        // A 200 whose body isn't JSON means the provider is misbehaving; a
        // retry won't fix it, so fail now rather than burning the attempts.
        throw new ApiError(
          502,
          errorCode,
          `${label} returned a malformed response`,
        );
      }
    }

    if (RETRYABLE_STATUSES.has(response.status) && !isLastAttempt) {
      await sleep(retryAfterMs(response, backoffMs));
      continue;
    }

    throw new ApiError(
      502,
      errorCode,
      `${label} request failed`,
      await response.text(),
    );
  }

  throw new ApiError(
    504,
    "AI_TIMEOUT",
    `${label} did not respond within ${timeoutMs}ms`,
    { attempts: retries + 1, lastError: lastAbort?.name },
  );
}
