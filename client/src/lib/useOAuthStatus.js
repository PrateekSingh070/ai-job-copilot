import { useEffect, useState } from "react";
import { api } from "./api";

// Asks the API which social-login providers are enabled. Defaults to "none"
// so the sign-in UI stays hidden if the status check fails or hasn't loaded.
export function useOAuthStatus() {
  const [oauthStatus, setOauthStatus] = useState({
    googleConfigured: false,
    githubConfigured: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get("/auth/oauth/status");
        setOauthStatus(res.data.data);
      } catch {
        // Keep OAuth disabled when the status check fails.
      }
    })();
  }, []);

  return oauthStatus;
}
