import { redirect } from "next/navigation";
import { env } from "~/env";
import { SoloSetup } from "./_components/solo-setup";

export default async function SoloPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!env.OPENROUTER_API_KEY) {
    redirect("/");
  }

  const params = await searchParams;
  const category =
    typeof params.category === "string" ? params.category : "";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <SoloSetup initialCategory={category} />
    </main>
  );
}
