import { GameClient } from "../../_components/game-client";

export default async function GameRoundPage({
  params,
}: {
  params: Promise<{ code: string; slug: string }>;
}) {
  const { code, slug } = await params;
  return <GameClient code={code.toUpperCase()} slug={slug} />;
}
