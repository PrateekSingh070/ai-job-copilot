import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { extractApiErrorMessage } from "../lib/dashboardHelpers.js";
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
  inputClass,
  panelClass,
} from "../ui/theme.js";
import { ChatBubbleIcon } from "../ui/icons";

// Ask questions across every tracked application. The transcript lives here
// rather than on the server — the API is stateless and replays what we send,
// which keeps the backend simpler at the cost of a growing request body (capped
// at ten turns server-side).
const MAX_HISTORY = 10;

export function PipelineChat() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);

  const ask = useMutation({
    mutationFn: async (question) => {
      const history = messages
        .slice(-MAX_HISTORY)
        .map(({ role, content }) => ({ role, content }));
      const res = await api.post("/ai/chat", { message: question, history });
      return res.data.data;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.output.answer,
          citedJobIds: data.output.citedJobIds ?? [],
          retrievedCount: data.retrievedCount,
        },
      ]);
    },
  });

  const reindex = useMutation({
    mutationFn: async () => (await api.post("/ai/reindex")).data.data,
  });

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, ask.isPending]);

  function submit(e) {
    e.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setDraft("");
    ask.mutate(question);
  }

  return (
    <section className={`${panelClass} mt-4 sm:mt-6`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChatBubbleIcon className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-zinc-100">
            Ask your pipeline
          </h3>
        </div>
        <button
          type="button"
          data-testid="chat-reindex"
          className={buttonSecondaryClass}
          onClick={() => reindex.mutate()}
          disabled={reindex.isPending}
        >
          {reindex.isPending ? "Reindexing…" : "Reindex"}
        </button>
      </div>

      {reindex.isSuccess ? (
        <p className="mb-3 rounded-lg border border-emerald-500/35 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
          Reindexed {reindex.data.indexed} of {reindex.data.total} applications
          ({reindex.data.skipped} already current).
        </p>
      ) : null}

      <div
        ref={scrollRef}
        data-testid="chat-transcript"
        className="h-80 space-y-3 overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Ask things like “which roles mention React?”, “what am I
            interviewing for?”, or “which applications are remote?”
          </p>
        ) : (
          messages.map((message, i) => (
            <div
              key={i}
              className={
                message.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-zinc-950"
                    : "border border-zinc-800 bg-zinc-900/70 text-zinc-200"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">
                  {message.content}
                </p>

                {message.role === "assistant" &&
                message.citedJobIds?.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.citedJobIds.map((id) => (
                      <span
                        key={id}
                        className="rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-2 py-0.5 text-[11px] text-cyan-300"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}

        {ask.isPending ? (
          <p className="text-xs text-zinc-500">Searching your applications…</p>
        ) : null}
      </div>

      <form className="mt-3 flex gap-2" onSubmit={submit}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Ask a question about your applications</span>
          <input
            data-testid="chat-input"
            className={inputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Which of my applications mention React?"
          />
        </label>
        <button
          data-testid="chat-submit"
          className={buttonPrimaryClass}
          type="submit"
          disabled={ask.isPending || draft.trim().length === 0}
        >
          Ask
        </button>
      </form>

      {ask.isError ? (
        <p className="mt-3 rounded-lg border border-rose-500/35 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {extractApiErrorMessage(
            ask.error,
            "Could not answer that. Please try again.",
          )}
        </p>
      ) : null}
    </section>
  );
}
