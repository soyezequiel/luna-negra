"use client";

import { useFriendsDrawer } from "@/providers/friends-drawer";

/**
 * Panel social de la ficha de juego: "Jugá con amigos". El flujo real de crear
 * sala + invitar vive en la barra de amigos (que ya muestra el botón "Invitar a
 * jugar" por amigo cuando esta ficha registró el juego en el contexto). Acá solo
 * lo señalizamos: en móvil abrimos el drawer; en desktop apuntamos al aside.
 */
export function GameSocialPanel() {
  const { setOpen } = useFriendsDrawer();

  return (
    <div className="rounded-ln-lg border border-ln-aurora/30 bg-ln-aurora/[0.06] p-4">
      <p className="text-sm font-semibold text-ln-aurora-bright">
        Jugá con amigos
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-ln-soft">
        Creá una sala e invitá a tus contactos de Nostr. Cuando entren, abrís el
        juego para todos.
      </p>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-aurora mt-3 w-full ln:hidden"
      >
        ⚇ Invitar amigos
      </button>
      <p className="mt-3 hidden text-center text-[11px] text-ln-faint ln:block">
        Invitalos desde la barra de amigos, a la derecha →
      </p>
    </div>
  );
}
