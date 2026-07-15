import { describe, expect, it, vi } from "vitest";
import {
  BalGameClient,
  BalLauncher,
  MemoryBalAuthorizationStore,
  type BalLauncherPersistedSession,
  type BalLauncherSessionStore,
  type BalMessage,
  type BalNip46RelayFactory,
  type BalTransport,
  type BalTransportEnvelope,
} from "nostr-game-protocol/bal";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event,
  type Filter,
} from "nostr-tools";

type Peer = { id: string };

class MessageHub {
  private readonly endpoints = new Map<Peer, MessageEndpoint>();

  add(peer: Peer, origin: string): MessageEndpoint {
    const endpoint = new MessageEndpoint(this, peer, origin);
    this.endpoints.set(peer, endpoint);
    return endpoint;
  }

  deliver(sender: MessageEndpoint, target: Peer, targetOrigin: string, data: BalMessage): void {
    const endpoint = this.endpoints.get(target);
    if (!endpoint || endpoint.origin !== targetOrigin) throw new Error("targetOrigin mismatch");
    queueMicrotask(() => endpoint.receive({ data, origin: sender.origin, peer: sender.peer }));
  }
}

class MessageEndpoint implements BalTransport<Peer> {
  private readonly handlers = new Set<(event: BalTransportEnvelope<Peer>) => void>();

  constructor(
    private readonly hub: MessageHub,
    readonly peer: Peer,
    readonly origin: string,
  ) {}

  send(peer: Peer, targetOrigin: string, message: BalMessage): void {
    this.hub.deliver(this, peer, targetOrigin, message);
  }

  subscribe(handler: (event: BalTransportEnvelope<Peer>) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  receive(event: BalTransportEnvelope<Peer>): void {
    for (const handler of this.handlers) handler(event);
  }
}

function matches(filter: Filter, event: Event): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  const recipients = event.tags
    .filter((tag) => tag[0] === "p")
    .map((tag) => tag[1]);
  return !filter["#p"] || filter["#p"].some((pubkey) => recipients.includes(pubkey));
}

function relayFactory(): BalNip46RelayFactory {
  const listeners = new Set<{ filter: Filter; handler: (event: Event) => void }>();
  return () => {
    const own = new Set<() => void>();
    return {
      publish: async (event: Event) => queueMicrotask(() => {
        for (const listener of listeners) {
          if (matches(listener.filter, event)) listener.handler(event);
        }
      }),
      subscribe: (filter: Filter, handler: (event: Event) => void) => {
        const listener = { filter, handler };
        listeners.add(listener);
        const stop = () => listeners.delete(listener);
        own.add(stop);
        return stop;
      },
      close: () => { for (const stop of own) stop(); },
    };
  };
}

class MemorySessionStore implements BalLauncherSessionStore {
  readonly records = new Map<string, BalLauncherPersistedSession>();

  list(): BalLauncherPersistedSession[] {
    return [...this.records.values()];
  }

  save(session: BalLauncherPersistedSession): void {
    this.records.set(session.requestId, structuredClone(session));
  }

  remove(requestId: string): void {
    this.records.delete(requestId);
  }
}

describe("BAL launcher reload", () => {
  it("resumes the same NIP-46 remote and serves the already connected game", async () => {
    const hub = new MessageHub();
    const launcherPeer = { id: "launcher" };
    const gamePeer = { id: "game" };
    const launcherOrigin = "https://luna.example";
    const gameOrigin = "https://chess.example";
    const launcherTransport = hub.add(launcherPeer, launcherOrigin);
    const gameTransport = hub.add(gamePeer, gameOrigin);
    const relays = relayFactory();
    const identitySecret = generateSecretKey();
    const identityPubkey = getPublicKey(identitySecret);
    const authorizations = new MemoryBalAuthorizationStore();
    const sessions = new MemorySessionStore();
    const restored = vi.fn();

    const options = {
      transport: launcherTransport,
      registry: {
        resolve(envelope: BalTransportEnvelope<Peer>, gameId: string) {
          return envelope.peer === gamePeer && envelope.origin === gameOrigin && gameId === "ajedrez"
            ? { gameId, gameName: "Ajedrez", origin: gameOrigin, peer: gamePeer }
            : null;
        },
      },
      authorizationStore: authorizations,
      sessionStore: sessions,
      relays: ["wss://relay.example"],
      relayFactory: relays,
      getIdentity: () => ({
        identityId: "user-1",
        pubkey: identityPubkey,
        source: "nsec" as const,
        signer: {
          getPublicKey: async () => identityPubkey,
          signEvent: async (event: Parameters<typeof finalizeEvent>[0]) => (
            finalizeEvent(event, identitySecret)
          ),
        },
      }),
      requestConsent: async () => "remember" as const,
    };

    const firstLauncher = new BalLauncher(options);
    firstLauncher.start();
    const client = new BalGameClient({
      gameId: "ajedrez",
      requestedPermissions: ["get_public_key", "sign_event:1"],
      launcherOrigin,
      launcherPeer,
      transport: gameTransport,
      nip46: { relayFactory: relays, rpcTimeoutMs: 1_000 },
      timeoutMs: 2_000,
    });
    const login = await client.login();
    await vi.waitFor(() => expect(sessions.records.size).toBe(1));

    firstLauncher.stop({ preserveSessions: true });
    expect(sessions.records.size).toBe(1);

    const secondLauncher = new BalLauncher({ ...options, onSessionRestored: restored });
    secondLauncher.start();
    await vi.waitFor(() => expect(restored).toHaveBeenCalledOnce());

    await expect(login.signer.getPublicKey()).resolves.toBe(identityPubkey);
    await expect(login.signer.signEvent({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "después del reload",
    })).resolves.toMatchObject({ pubkey: identityPubkey, kind: 1 });

    await login.signer.close();
    await vi.waitFor(() => expect(sessions.records.size).toBe(0));
    secondLauncher.stop();
  });
});
