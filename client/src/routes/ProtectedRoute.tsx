import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../providers/AuthProvider";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

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

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
