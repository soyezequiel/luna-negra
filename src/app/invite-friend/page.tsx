import { InviteFriendPopup } from "@/components/invite-friend-popup";

type SearchParams = Promise<{
  gameId?: string | string[];
  roomId?: string | string[];
}>;

export default async function InviteFriendPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  return (
    <InviteFriendPopup
      gameId={firstParam(params.gameId)}
      roomId={firstParam(params.roomId)}
    />
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
