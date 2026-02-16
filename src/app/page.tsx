export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-10">
        <h1 className="text-4xl font-bold text-gray-900">naming things</h1>

        <p className="text-center text-gray-600">
          compete with your friends to see who can name the most things
        </p>

        <div className="flex w-full flex-col gap-6">
          <button className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition hover:bg-gray-800">
            create game
          </button>

          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="enter game code"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-gray-900 placeholder-gray-400 outline-none focus:border-gray-900"
            />
            <button className="w-full rounded-lg border border-gray-900 px-4 py-3 font-medium text-gray-900 transition hover:bg-gray-100">
              join game
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
