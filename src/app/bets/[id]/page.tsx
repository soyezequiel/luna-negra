import { BetView } from "@/components/bet-view";

export default async function BetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BetView betId={id} />;
}
