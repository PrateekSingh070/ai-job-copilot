import { useEffect } from "react";
import { setAccessToken } from "../lib/token";
import { authBackdropClass, authPageClass } from "../ui/theme";

export function OAuthCallbackPage() {
  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    if (!accessToken) {
      window.location.replace("/login");
      return;
    }
    setAccessToken(accessToken);
    window.location.replace("/dashboard");
  }, []);

  return (
    <main className={authPageClass}>
      <div className={authBackdropClass} aria-hidden />
      <div className="relative flex flex-col items-center gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/70 px-10 py-12 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div
          className="h-9 w-9 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-400"
          aria-hidden
        />
        <p className="text-sm text-zinc-400">Finishing sign-in…</p>
      </div>
    </main>
  );
}
