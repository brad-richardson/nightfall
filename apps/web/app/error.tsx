"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--night-sand)] text-[color:var(--night-ink)]">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 opacity-60">{error.message}</p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-[color:var(--night-teal)] px-4 py-2 text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
