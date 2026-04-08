import { HistoryClient } from "../_components/history-client";

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <HistoryClient code={code.toUpperCase()} />;
}
