import { useEffect } from "react";
import { setAccessToken } from "../lib/token";

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
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <p className="text-center text-sm text-slate-600">Finishing sign-in…</p>
    </main>
  );
}
