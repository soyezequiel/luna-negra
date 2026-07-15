"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Juego jugable que el usuario tiene abierto (su página, no el juego en sí). */
export type CurrentGame = {
  gameId: string;
  slug: string;
  title: string;
  gameUrl: string;
  /** Coordenada Nostr `30023:<tienda>:<slug>` (Nostr Games Protocol (NGP)). */
  nostrCoord?: string | null;
  /** El juego declaró soporte de "Luna Room Link" (sala hosteada por el juego): la
   * barra de amigos invita con un enlace `?join=` dirigido en vez del flujo de
   * salas hosteadas por Luna. Ver docs/luna-room-link.md. */
  roomLink?: boolean;
  /** El proveedor declaró que integró Bunker Auto Login. */
  balCompatible?: boolean;
};

type GameContextValue = {
  currentGame: CurrentGame | null;
  setCurrentGame: (game: CurrentGame | null) => void;
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentGame, setCurrentGame] = useState<CurrentGame | null>(null);
  const value = useMemo(
    () => ({ currentGame, setCurrentGame }),
    [currentGame],
  );
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx)
    throw new Error("useGameContext debe usarse dentro de <GameContextProvider>");
  return ctx;
}

/**
 * Registra el juego jugable de la página actual en el contexto (y lo limpia al
 * desmontar), para que la FriendsSidebar pueda ofrecer "Invitar a jugar".
 */
export function RegisterGame(props: CurrentGame) {
  const { setCurrentGame } = useGameContext();
  const {
    gameId,
    slug,
    title,
    gameUrl,
    nostrCoord,
    roomLink,
    balCompatible,
  } = props;
  useEffect(() => {
    setCurrentGame({
      gameId,
      slug,
      title,
      gameUrl,
      nostrCoord,
      roomLink,
      balCompatible,
    });
    return () => setCurrentGame(null);
  }, [
    setCurrentGame,
    gameId,
    slug,
    title,
    gameUrl,
    nostrCoord,
    roomLink,
    balCompatible,
  ]);
  return null;
}
