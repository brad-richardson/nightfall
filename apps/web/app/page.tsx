export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-100 via-orange-50 to-stone-100">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-700">Nightfall</p>
        <h1 className="mt-4 text-4xl font-semibold text-stone-900 sm:text-5xl">
          The city endures. The nights get longer.
        </h1>
        <p className="mt-6 text-lg text-stone-700">
          This is the web client for Nightfall. Map UI, world state, and real-time updates
          will live here.
        </p>
      </div>
    </main>
  );
}
