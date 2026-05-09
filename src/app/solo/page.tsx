import { redirect } from "next/navigation";
import { SoloSetup } from "./_components/solo-setup";

export const dynamic = "force-dynamic";

export default async function SoloPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!process.env.OPENROUTER_API_KEY) {
    redirect("/");
  }

  const params = await searchParams;
  const category =
    typeof params.category === "string" ? params.category : "";
  const timer =
    typeof params.timer === "string" ? Number(params.timer) : undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-white px-4 py-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)] [padding-top:calc(env(safe-area-inset-top)+2rem)]">
      <SoloSetup initialCategory={category} initialTimer={timer} />
    </main>
  );
}
