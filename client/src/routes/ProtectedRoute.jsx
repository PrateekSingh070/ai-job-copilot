import { Navigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  // Wait for the session bootstrap to finish before deciding. Redirecting
  // while still loading would bounce authenticated users to /login on refresh.
  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 bg-zinc-950 px-4 text-zinc-400">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-cyan-400"
          aria-hidden
        />

        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  // Not signed in: send them to login instead of rendering the guarded page.
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
