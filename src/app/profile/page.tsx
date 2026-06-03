"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import { fetchProfile, profileName, type NostrProfile } from "@/lib/nostr";
import { Button } from "@/components/ui/button";

export default function ProfilePage() {
  const { user, login, loading } = useSession();
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoadingProfile(true);
    fetchProfile(user.pubkey)
      .then(setProfile)
      .finally(() => setLoadingProfile(false));
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Perfil</h1>
        <p className="mt-2 text-zinc-400">Conectá tu Nostr para ver tu perfil.</p>
        <div className="mt-4 flex justify-center">
          <Button onClick={login}>Conectar con Nostr</Button>
        </div>
      </div>
    );
  }

  const name = profileName(profile);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center gap-4">
        {profile?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.picture}
            alt=""
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="h-20 w-20 rounded-full bg-white/10" />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{name ?? "Anónimo"}</h1>
          <p className="break-all font-mono text-xs text-zinc-500">{user.npub}</p>
        </div>
      </div>

      {profile?.about ? (
        <p className="mt-4 whitespace-pre-wrap text-zinc-300">{profile.about}</p>
      ) : null}
      {loadingProfile ? (
        <p className="mt-4 text-sm text-zinc-500">Cargando perfil desde Nostr…</p>
      ) : null}
    </div>
  );
}
