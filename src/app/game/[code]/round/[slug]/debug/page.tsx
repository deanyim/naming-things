import { DebugClient } from "../../../_components/debug-client";

export default async function DebugPage({
  params,
}: {
  params: Promise<{ code: string; slug: string }>;
}) {
  const { code, slug } = await params;
  return <DebugClient code={code.toUpperCase()} slug={slug} />;
}
