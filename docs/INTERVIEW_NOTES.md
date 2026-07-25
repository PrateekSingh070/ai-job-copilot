# Interview notes

Your script for explaining this project. Read [ARCHITECTURE.md](ARCHITECTURE.md) for the diagrams and [AI_LAYER.md](AI_LAYER.md) for the AI deep-dive.

## The 60-second pitch

> It's a job application tracker with one AI feature. You sign up, add the roles you've applied to, and drag them across a Kanban board as you move through interview stages. The dashboard shows your conversion rates. The AI part takes your resume and a job description and rewrites your bullet points for that specific role, with a match score.
>
> It's React with Vite on the front, Express and Prisma against PostgreSQL on the back, all plain JavaScript. About 3,000 lines.
>
> The two things I'd point at: the auth uses short-lived access tokens with rotating refresh tokens, so a stolen refresh token is detectable. And the AI endpoint validates the model's output against a Zod schema, because an LLM returns text, not a contract, and I didn't want a malformed response to reach the browser.

Stop there. The last paragraph is bait, and a good interviewer will pull on one of the two threads.

## The 5-minute walkthrough

Go in this order. It follows the data, which is easier to follow than a file tree.

1. **The product, in the UI.** Log in as the demo user, add a job, drag a card, open the Resume Tailor tab. Thirty seconds. Now they know what the nouns mean.
2. **The data model.** Three tables. `User`, `JobApplication`, and `RefreshToken`. Explain why refresh tokens have a table at all: JWTs can't be revoked, so anything long-lived needs a row you can mark dead.
3. **One request end to end.** Use the `PATCH /jobs/:id` trace below. It touches every layer in one story.
4. **The auth design.** Two tokens, two lifetimes, two storage locations, and why. Then the refresh queue if they seem interested in the frontend.
5. **The AI endpoint.** Not the prompt. The wrapper: sanitize, call, extract JSON, validate against a schema, and a mock provider so the whole thing runs offline.

## Tracing one request: dragging a card

This is the strongest single answer you have, because it hits auth, validation, ownership, the ORM, and optimistic UI in about ninety seconds.

**The user drags "Acme" from Applied to Interview.**

1. `KanbanBoard.jsx` tracks the dragged card id in `useState`. The drop handler on the target column calls `onMove(jobId, status)`.
2. `DashboardPage.jsx` has `moveJob`, which first checks the card isn't being dropped back into the column it came from, then fires the `patchJob` mutation.
3. **Optimistic update.** `onMutate` runs before the request. It calls `cancelQueries` so an in-flight response can't overwrite what we're about to write, snapshots the current cache, then rewrites the job's status locally. The card moves immediately — no spinner.
4. **The request.** The axios instance attaches `Authorization: Bearer <token>` in a request interceptor. `PATCH /jobs/j1` with `{ status: "INTERVIEW" }`.
5. **Middleware.** helmet, CORS, request id, logging, body parse, cookies, global rate limit. Then the jobs router, which runs `requireAuth` on every route in it — that verifies the JWT signature and puts the payload on `req.user`.
6. **Validation.** `validateBody(jobPatchSchema)` parses the body. `jobPatchSchema` is `jobCreateSchema.partial()`, so every field is optional but any field present must still be the right type. A bad status throws a `ZodError`.
7. **Ownership.** `loadOwnedJob(req.user.sub, req.params.id)` fetches the row and compares `userId`. Not found and not-yours both return 404, so we don't confirm that someone else's id exists.
8. **Write.** `buildJobData` copies only the fields the client actually sent, running free text through `sanitizeText` to strip HTML. Then `prisma.jobApplication.update`.
9. **Response.** `sendSuccess` wraps it in the standard envelope.
10. **Back on the client.** `onSuccess` invalidates the `jobs` and `metrics` query keys, so both refetch and the server's version becomes the truth. If it had failed, `onError` would restore the snapshot from step 3 and the card would snap back.

If you only remember one thing: **steps 3 and 10 are the same feature.** Optimistic update and rollback are a pair.

## Questions you should expect

**"Why JWT instead of sessions?"**

The API is stateless and the client is a separate deployment, so there's no shared session store to reach for. But I didn't go pure-stateless: refresh tokens are database rows precisely because I wanted revocation. So it's a hybrid — stateless for the 15-minute access token, stateful for the 7-day refresh token. That's the trade-off I actually made and I'd defend it.

**"Why rotate refresh tokens?"**

Without rotation, a stolen refresh token works silently for seven days. With it, each refresh retires the old row and records `replacedBy` pointing at the successor's hash. If a thief uses the stolen token, the real user's next refresh presents an already-revoked token and gets rejected. Someone gets logged out, which is a signal. Honest gap: I detect and reject reuse, but nothing alerts on it or revokes the whole token family. That's the next thing I'd add.

**"Why store a hash of the refresh token instead of the token?"**

Same reasoning as passwords. If the database leaks, the attacker has SHA-256 digests, not usable tokens. There's no need to ever read the original back — I only ever need to answer "have I seen this exact token", which a hash lookup answers.

**"Why 404 instead of 403 for a job that isn't yours?"**

A 403 confirms the id is real. Over enough requests you could enumerate which record ids exist. A 404 makes "doesn't exist" and "not yours" indistinguishable, which leaks nothing.

**"Why Prisma?"**

Typed query results and real migration files. `prisma migrate` produces SQL I can read and check into git, which matters more to me than the query builder. The honest cost is that it's a heavy dependency and it hides the SQL, so you can write an accidental N+1 without noticing. I keep an eye on that by checking what queries the metrics endpoint actually runs.

**"Isn't the metrics endpoint an N+1?"**

No, and that's deliberate. It's two queries run through `Promise.all`: a `count`, and a `groupBy` on status that returns one row per stage. The rates are computed in JavaScript from those results. The alternative — fetching every job and counting in memory — would be O(n) rows over the wire for a number that Postgres can produce directly.

**"How do you test this without a database?"**

`server/src/test/prismaMock.js` is an in-memory fake with the same interface, injected with `vi.mock`. So the tests run real routing, real middleware, real Zod validation and real JWT signing — only the storage is swapped. 30 tests, no Docker, no Postgres, and they run in a couple of seconds. The trade-off is that the mock can drift from Prisma's real behavior, so it wouldn't catch a broken query. Integration tests against a real database in CI would be the next layer.

**"What happens when the access token expires mid-session?"**

The axios response interceptor catches the 401 and refreshes transparently, then retries the original request — the user sees nothing. The subtle part is concurrency: the dashboard fires several requests at once, so several 401s arrive together. Only the first triggers a refresh; the rest wait on a promise queue and replay after it resolves. Without that, each would refresh independently, and since rotation revokes the previous token, all but one would fail and log the user out.

**"Why is the access token in a variable instead of localStorage?"**

Anything in localStorage is readable by any script on the page, so one XSS gets your token. A module variable isn't reachable that way. The cost is that a page reload loses it, which is why `AuthProvider` silently calls `/auth/refresh` on boot to trade the httpOnly cookie for a new access token. Slightly slower first paint, meaningfully smaller attack surface.

That boot-time refresh has a race in it that's worth mentioning if you want to show you thought it through: the user can land on the login page and sign in while the silent refresh is still in flight. When it then fails, its error handler would clear the session that was just created. `AuthProvider` guards every await boundary with a `supersededRef` that sign-in and sign-out set, so a late result gets discarded rather than applied. It's the same principle as `cancelQueries` in the optimistic update — a stale response must never overwrite newer truth.

**"How would you scale this?"**

The first real bottleneck is the rate limiter — it's an in-memory store, so with two instances behind a load balancer the effective limit doubles and resets on every deploy. That moves to Redis. After that: the AI call is synchronous and holds a connection for several seconds, so it becomes a queued job with a status endpoint. Then pagination goes from offset to cursor, because `OFFSET 10000` makes Postgres scan and discard.

**"Tell me about a bug you found and fixed."**

Use this one — it's small, specific, and the diagnosis is the interesting part.

Reloading the dashboard twice quickly returned a 500. The log showed a unique constraint violation on `RefreshToken.tokenHash` inside `rotateRefreshToken`. The cause is that a refresh token was signed from `{ sub, email }` and nothing else, and JWT's `iat` claim is measured in whole seconds. Two refreshes for the same user inside the same second therefore produced a byte-identical token, which hashed to an identical value, which the unique index correctly rejected. The fix is one line: add a random `jti` claim so every token is unique regardless of timing.

The part worth drawing out is why the test suite didn't catch it. The tests mock Prisma with an in-memory fake, and the fake didn't enforce the unique index — so the collision only existed against real Postgres. That's exactly the class of bug a mocked database hides, and it's the concrete argument for adding integration tests against a real database rather than a general preference for them. There's now a regression test that refreshes four times in a row and asserts every token differs.

**"What would you do differently if you started over?"**

TypeScript. The Zod schemas already describe every request and response shape, and `z.infer` would give me those types for free instead of re-describing them in JSDoc. Right now the validation and the types are the same information written once.

**"What are you least happy with?"**

The AI service only has tests on the mock path. The real provider branches — parsing OpenAI's envelope, parsing Anthropic's content blocks, handling a schema violation — aren't covered. I'd mock `fetch` and test three cases: clean JSON, JSON wrapped in a code fence, and a response that fails the schema.

## Known limitations, say these before you're asked

Volunteering these makes you look like you've thought about production. Getting caught by them makes you look like you haven't.

- **The rate limiter is in-memory.** Per-instance, and it resets on deploy. Needs Redis to be real.
- **Refresh token reuse is rejected but not alarmed.** The chain is there in `replacedBy`; nothing acts on it.
- **Pagination is offset-based.** Fine at this size, degrades on large tables.
- **No test coverage on the real AI provider paths.**
- **The Prisma mock doesn't enforce constraints.** It has already hidden one real bug (see the refresh-token question above). Integration tests against a real database are the missing layer.
- **No timeout or retry on the AI `fetch` call.** A hanging provider hangs the request.
- **Prompt injection is mitigated, not solved.** Sanitizing strips HTML, control characters and homoglyphs, but a plain-ASCII instruction inside a resume survives. What limits the damage is that the output is schema-validated and the model has no tools and no database access.
- **The client bundle isn't code-split.** One chunk. It's small enough not to matter yet.

## Things not to say

- Don't call the AI feature "AI-powered" and leave it there. Say what it does mechanically: sanitize, prompt, parse, validate.
- Don't claim the app is production-ready. Say what would need to change first, using the list above.
- Don't oversell the test suite. It's 30 tests with a mocked database and a mocked AI provider. That's a reasonable place to be for a project this size, and saying so is stronger than implying more.
