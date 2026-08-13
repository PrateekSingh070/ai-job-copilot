import { Component } from "react";

/**
 * Last-resort catch for render errors. Without this, one thrown render
 * anywhere in the tree unmounts the entire app to a white screen; with it,
 * the user gets an explanation and a reload button. Must be a class —
 * React has no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <div className="max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-400">
            The app hit an unexpected error. Your data is safe on the server —
            reloading usually fixes it.
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </main>
    );
  }
}
