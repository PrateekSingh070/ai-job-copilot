# Frontend interview notes

For a frontend-focused conversation about this project. The backend answers live in
[INTERVIEW_NOTES.md](INTERVIEW_NOTES.md); this file is only about `client/`.

The single most important thing: **you wrote this code, so answer from it.** A generic
answer about React is worth much less than "here's how I did it in my dashboard, and
here's what I'd change." Every section below is tied to a real file.

---

## The 60-second version

> It's a React single-page app for tracking job applications. You sign in, add the jobs
> you've applied to, and drag cards between four pipeline columns — Applied, Interview,
> Offer, Rejected. There's a metrics strip on top and a second tab where you paste a
> resume and a job description and get rewritten bullets back from an AI endpoint.
>
> React 19 with Vite, React Router for routing, TanStack Query for all server data, and
> Tailwind for styling. Plain JavaScript, no TypeScript. The two parts I'd point at are
> the auth layer — the access token is deliberately kept out of `localStorage` — and the
> drag-and-drop, which updates optimistically and rolls back if the request fails.

Then stop talking and let them pick a thread.

---

## The file map

Know this well enough to say it without looking. Interviewers often open with
"walk me through your folder structure."

```
client/src
  main.jsx                  Mounts React, wraps the app in Router + Query + Auth providers
  App.jsx                   Four routes; /dashboard is wrapped in ProtectedRoute
  providers/AuthProvider    Context holding user + login/register/logout
  routes/ProtectedRoute     Redirects to /login when there's no user
  lib/api.js                axios instance, access token, refresh-on-401 interceptor
  lib/dashboardHelpers.js   Pure constants + one helper, no React
  pages/LoginPage           Controlled email/password form
  pages/RegisterPage        Same shape as login, plus name
  pages/DashboardPage       Queries, mutations, filters, pagination, tabs
  components/KanbanBoard    Four columns, HTML5 drag-and-drop
  components/ResumeTailor   The AI tab
  components/MetricCard     One presentational stat card
  ui/theme.js, ui/icons     Shared Tailwind class strings and inline SVG icons
```

The framing to offer: **pages own state and data, components render what they're given.**
`MetricCard` and `KanbanBoard` take props and render — `KanbanBoard` holds one piece of
local UI state (`draggedId`) and nothing else. All the server state lives in
`DashboardPage`. That's the separation, and it's worth saying out loud.

---

## The five things you must be able to explain cold

### 1. Why TanStack Query instead of `useEffect` + `useState`

This is the highest-probability question in the whole interview, because it's the biggest
library choice in the app.

The honest answer is that fetching in a `useEffect` means hand-writing the same four
things every single time: a loading flag, an error flag, the data itself, and a cleanup
guard so a slow response from an old request doesn't overwrite a newer one. Query gives
you all of that from one hook, plus a cache.

Point at the concrete win in `DashboardPage`:

```44:57:client/src/pages/DashboardPage.jsx
  const jobsQuery = useQuery({
    queryKey: ["jobs", companyFilter, statusFilter, page],
    queryFn: async () => {
      const res = await api.get("/jobs", {
```

The filters and page number are **part of the query key**. So when you change a filter,
the key changes, and Query refetches automatically — there is no `useEffect` watching
those variables. And because the old key's result stays cached, going back to a previous
page or filter is instant.

The second win is invalidation. After any write, one function marks both queries stale:

```66:69:client/src/pages/DashboardPage.jsx
  const refreshJobs = () => {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["metrics"] });
  };
```

Note that `["jobs"]` is a **prefix** match — it invalidates every cached filter/page
combination at once, not just the one on screen. That's why adding a job updates the list
no matter which filter you had applied.

If they push on when you *wouldn't* reach for it: for a single fetch that never needs
caching, refetching or sharing, `useEffect` is fine and one less dependency.

### 2. How auth works on the client

Three pieces, and the interesting part is the trade-off in the middle one.

**Where the token lives.** In a module variable in `lib/api.js`, not `localStorage`:

```36:44:client/src/lib/api.js
let accessToken = null;

export function getAccessToken() {
  return accessToken;
}
```

Why: anything in `localStorage` is readable by any script on the page, so a single XSS
gets the token. A module variable isn't reachable that way. The cost is real and you
should volunteer it — **a page reload wipes it.** That's paid for by the refresh token,
which sits in an httpOnly cookie the JavaScript can't read, and `AuthProvider` trades it
for a new access token on boot:

```29:39:client/src/providers/AuthProvider.jsx
  useEffect(() => {
    const bootstrap = async () => {
      try {
        if (!getAccessToken()) {
          const refreshed = await api.post("/auth/refresh");
```

**Why `ProtectedRoute` has a loading state.** This is a good detail to raise unprompted,
because it's a bug people actually hit. While that boot refresh is in flight there's no
user yet — if the route redirected immediately, every signed-in user would get bounced to
`/login` on every page refresh. So it renders a spinner until `loading` is false, and only
then decides.

**Refreshing an expired token mid-session.** The axios response interceptor catches a 401,
refreshes, and retries the original request, so the user sees nothing. The subtle part is
concurrency — the dashboard fires several requests at once, so several 401s can arrive
together:

```85:88:client/src/lib/api.js
    if (refreshing) {
      await new Promise((resolve, reject) => queue.push({ resolve, reject }));
      return api(error.config);
    }
```

Only the first 401 triggers a refresh; the rest park on a promise queue and replay once
it resolves. Without that, each would refresh independently, and because the server
rotates and revokes the old refresh token on every use, all but one would fail and the
user would be logged out. The `_retry` flag on the config prevents an infinite loop if the
retried request 401s again.

### 3. The optimistic update

If they ask about anything "advanced" you've done, this is the answer. Three callbacks:

```82:99:client/src/pages/DashboardPage.jsx
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: ["jobs"] });
      const previous = qc.getQueriesData({ queryKey: ["jobs"] });
```

- **`onMutate`** runs before the request. It cancels in-flight `jobs` queries, snapshots
  the current cache, then writes the new status straight into it — so the card moves the
  instant you drop it, with no network wait.
- **`onError`** restores the snapshot, so a failed request visibly snaps the card back.
- **`onSuccess`** invalidates, so the cache re-syncs with what the server actually stored.

The line worth explaining is `cancelQueries`. Without it, a refetch that was already in
flight could land *after* your optimistic write and overwrite it with stale data — the
card would jump back to the old column for no visible reason. Cancelling first is what
makes the update safe.

Being able to say "a stale response must never overwrite newer truth" and point at two
places you handle it — here, and the `supersededRef` in `AuthProvider` — is a genuinely
strong moment.

### 4. Drag and drop

Native HTML5 drag-and-drop, no library. Three handlers total:

- The card is `draggable` and sets `draggedId` in `onDragStart`.
- The column calls `e.preventDefault()` in `onDragOver` — **this is the non-obvious bit.**
  An element is not a valid drop target by default, and preventing the default on dragover
  is what makes it one. Without that line, `onDrop` never fires.
- `onDrop` calls `onMove(draggedId, status)`, which the dashboard turns into a PATCH.

The dashboard ignores a drop onto the column the card is already in, so you don't fire a
pointless request:

```112:116:client/src/pages/DashboardPage.jsx
  function moveJob(jobId, targetStatus) {
    const current = jobs.find((job) => job.id === jobId);
    if (!current || current.status === targetStatus) return;
```

Why no `dnd-kit` or `react-beautiful-dnd`: four columns and simple cards didn't justify a
dependency. Be ready for the follow-up — see the accessibility note in the weak spots.

### 5. Forms and controlled components

Every input in the app is controlled: the value comes from state, and `onChange` writes
back. Know the definition — **React state is the single source of truth, not the DOM node.**

The add-job form keeps all three fields in one state object and updates with a functional
setter:

```233:236:client/src/pages/DashboardPage.jsx
                onChange={(e) =>
                  setNewJob((p) => ({ ...p, company: e.target.value }))
                }
```

Two things to be able to justify: the spread, because state must be replaced rather than
mutated for React to see the change; and the `(p) => ...` callback form, which reads the
latest state rather than a value captured when the render closed over it.

Validation is layered: `required` and `type="email"` in the browser, Zod on the server.
The client-side check is a convenience, and the server's is the one that counts because
anyone can bypass the browser.

---

## Likely questions, answered from your code

**"What is a key and why does React need it?"**

It tells React which item in a list is which between renders, so it can move or reuse DOM
nodes instead of rebuilding them. You use `job.id` in `KanbanBoard`, which is the right
choice — a stable id tied to the data.

Be ready for "why not the array index?" With an index, deleting the first card shifts
every key by one, so React thinks every item changed. Any state living inside those items
(focus, an open menu, input text) attaches to the wrong row. Index keys are only safe for
a list that never reorders, never filters and never deletes — and this one does all three.

**"Controlled vs uncontrolled?"**

Controlled means React state drives the value, as above. Uncontrolled means the DOM holds
it and you read it with a ref on submit. Controlled is what lets you disable the submit
button while `isPending`, reset the form after a successful post, and drive the filters
off the same state the query key reads.

**"Why Context for auth instead of passing props?"**

The user object is needed by `ProtectedRoute`, the dashboard header, and the login and
register pages — different depths of the tree with no useful common parent below the root.
Threading props through would be prop drilling. Context is for exactly this: low-frequency,
widely-read values.

The limit is worth stating: Context is not a state manager and it has no selector, so every
consumer re-renders when the value changes. That's fine for a user object that changes at
sign-in and sign-out. It would not be fine for something changing every keystroke.

**"Why is the context value wrapped in `useMemo`?"**

Because the value is an object literal. Without memoizing, every `AuthProvider` render
creates a new object, which changes the context value by reference, which re-renders every
consumer even when the user hasn't changed. The dependency array is `[loading, user]` — the
only things that should actually cause that.

**"Explain your `useEffect` calls."**

There are three in the whole app and you should know all of them:

1. The bootstrap in `AuthProvider`, `[]` — runs once on mount to restore the session.
2. The `auth:session-expired` listener, `[]` — subscribes on mount and **returns a cleanup
   function that removes the listener**. Say that part out loud; forgetting cleanup is the
   classic `useEffect` bug and showing you handle it is worth a lot.
3. Resetting `page` to 1 when a filter changes, in `DashboardPage`.

Worth flagging the third yourself: it's the one effect that isn't really necessary. The
React docs have a page called "You Might Not Need an Effect," and adjusting state in
response to other state is their main example. Resetting the page inside the filter
`onChange` handlers would avoid the extra render. Naming this before they do reads as
someone who keeps up with the ecosystem rather than someone who copied a pattern.

**"How do you handle loading and error states?"**

Query gives booleans per request. The list has both, the buttons disable on `isPending`
and swap their label, and mutation errors render an inline message through
`extractApiErrorMessage`, which digs the server's message out of the axios error shape and
falls back to friendly text when there isn't one. Worth adding honestly: there's no error
boundary, so a render-time crash would blank the page rather than show a fallback.

**"What happens when I type in the search box?"**

Answer this one carefully — it's the sharpest question they can ask about this code, and
the honest answer is better than a defensive one.

Every keystroke sets `companyFilter`, which is part of the query key, so every keystroke
fires a request. Typing "acme" is four requests. TanStack dedupes and caches, so it isn't
as bad as it sounds, and at this data size you don't notice — but it's wasteful and it
would be a real problem on a large table.

The fix is to debounce: keep the input responsive off local state, and only feed the query
key a value that's settled for ~300ms. On React 19 the cheapest version is
`useDeferredValue`, which lets the input update immediately while the expensive dependent
work uses a lagging value. A `setTimeout` in a `useEffect` with a clear-on-cleanup does the
same thing manually.

**"How would you improve performance?"**

Resist naming `React.memo` reflexively. The measured answer:

- **Pagination flashes a loading state** on every page change because a new query key
  starts empty. `placeholderData: keepPreviousData` keeps the previous page rendered while
  the next loads. That is the single most visible improvement available here.
- **Debounce the search**, as above.
- **The bundle is one 331 kB chunk** (about 105 kB gzipped). Route-level `React.lazy` would
  split the dashboard out of the login path.
- **`React.memo` on `KanbanBoard` last**, and only after measuring — every render of
  `DashboardPage` currently recreates `moveJob`, so memoizing the board without
  `useCallback` on the handler would do nothing at all. Knowing *why* it wouldn't work is
  the point.

**"How is the styling organized?"**

Tailwind utility classes, with repeated combinations pulled into named constants in
`ui/theme.js` — `inputClass`, `buttonPrimaryClass`, `panelClass` — so a button style is
defined once and imported. Icons are inline SVG components rather than an icon package,
which keeps the dependency list short and means they inherit `currentColor`.

The layout is mobile-first: base classes target small screens and `sm:` / `md:` / `xl:`
prefixes widen it, so the Kanban board goes one column, then two, then four.

**"What have you tested?"**

Four tests in `App.test.jsx` with Vitest and Testing Library, running against jsdom. They
render the real app with axios mocked and drive it the way a user would: sign in, land on
the dashboard, add a job, delete a card, switch to the AI tab and submit.

Say what you're querying by, because it shows you know the philosophy: `getByRole` and
accessible names where possible — `getByRole("button", { name: /delete acme/i })` works
because that button has an `aria-label`. The `data-testid` attributes are the fallback for
inputs that don't have accessible labels yet.

Then be honest about the ceiling: four tests, mocked network, and no test for the
drag-and-drop, because jsdom doesn't implement HTML5 drag events. That last one is a real
gap and it's better to name it than be caught by it.

---

## Weak spots: where they'll poke, and what to say

Volunteering these makes you look like you've read your own code critically. Getting caught
by them makes you look like you haven't.

**The login form ships with the demo credentials pre-filled.**

```21:22:client/src/pages/LoginPage.jsx
  const [email, setEmail] = useState("demo@copilot.local");
  const [password, setPassword] = useState("DemoPass123!");
```

This is the first thing a reviewer notices and it looks careless in a screenshot. It's
there so the demo is one click, and the account is a seeded local one, but a hardcoded
password in source is a bad habit in general. Better: leave the fields empty and add a
"Use demo account" button, or read them from a Vite env var. Have this answer ready — you
will be asked.

**The Vite dev proxy is configured but never used.** `vite.config.js` proxies `/auth`,
`/jobs` and `/ai` to port 4000, but `lib/api.js` builds an *absolute* `baseURL` pointing at
`http://localhost:4000`, so requests bypass the proxy entirely and go cross-origin — which
is the only reason the server needs CORS in development. Two mechanisms solving the same
problem, one of them dead code.

There's a second layer to this that's worth knowing if they dig. Vite reads `.env` from the
directory holding `vite.config.js` — `client/` — and no `envDir` is configured. There is no
`client/.env`, so the `VITE_API_URL` sitting in the repo-root `.env` never reaches the
browser at all. In dev the base URL is the hardcoded fallback on the last line of
`resolveApiBaseUrl`; the variable only takes effect in Docker, where `client/Dockerfile`
passes it as a build arg. So a root-level env var that looks like it configures the client
doesn't. Either move it to `client/.env`, or set `envDir` to the repo root.

The clean fix for both: make the baseURL relative in dev so the proxy handles it, which
removes the need for dev CORS entirely. Knowing which of your own two mechanisms is
actually running is a good look.

**Drag-and-drop is mouse-only.** There's no keyboard path to move a card, so the primary
interaction of the app is unusable without a pointer. The honest framing: native HTML5 DnD
has no keyboard story at all, which is the main reason libraries like `dnd-kit` exist. The
minimum fix is a status dropdown on each card that calls the same `onMove`, giving keyboard
and screen-reader users an equivalent path to the same mutation.

**Some inputs have no real label.** The login and register forms wrap every field in a
`<label>`, but the add-job form and the filters rely on `placeholder` alone. A placeholder
isn't a label — it vanishes when you type and screen readers don't reliably announce it.
Fix is a `<label>` or an `aria-label` on each.

**`draggedId` is never cleared.** There's no `onDragEnd`, so the id of the last dragged
card sticks around in state after the drop. It's harmless today because a drop always
overwrites it first, but it's a loose end.

**`ResumeTailor` keys list items by their content**, `key={bullet}`. If the model ever
returns two identical bullets, React warns about duplicate keys and may reuse the wrong
node. Content is not an id.

**No error boundary**, so a render-time exception unmounts the tree and leaves a blank
page instead of a fallback.

---

## If they ask you to write code live

Most likely asks for a fresher, all small and all adjacent to what's already here:

- **A debounced search input.** Practice it: local state for the input, `useEffect` with a
  `setTimeout`, and a cleanup that clears the timer. Being able to explain *why the cleanup
  is what makes it a debounce* is the whole question.
- **A counter or toggle with `useState`.** Use the functional updater and be able to say
  why.
- **Fetch and render a list with loading and error states**, in plain `useEffect`. Don't
  reach for Query — they want to see you can do it by hand.
- **`useEffect` cleanup.** Add a listener, remove it on unmount. You already have this
  exact pattern in `AuthProvider`, so cite it.

---

## Things not to say

- Don't say "I used TanStack Query because it's best practice." Say what it removed:
  four pieces of hand-written state per fetch, plus the cache.
- Don't call the drag-and-drop "real-time." It's an optimistic local update followed by a
  PATCH. There are no sockets.
- Don't claim the app is accessible. It has some good habits — `aria-label` on the delete
  button, `aria-hidden` on decorative elements, labels on the auth forms — and two real
  gaps, in the drag-and-drop and the unlabelled inputs. Saying that precisely is stronger
  than a vague claim either way.
- Don't oversell the tests. Four, with the network mocked.
- If you don't know something, say so and then say how you'd find out. For a fresher role
  that lands better than a confident wrong answer, and interviewers are specifically
  listening for it.
