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
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <SoloSetup initialCategory={category} initialTimer={timer} />
    </main>
  );
}
