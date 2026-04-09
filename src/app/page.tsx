import { env } from "~/env";
import { HomeClient } from "~/app/_components/home-client";

export default function Home() {
  return <HomeClient soloEnabled={!!env.OPENROUTER_API_KEY} />;
}
