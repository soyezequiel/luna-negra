import { describe, expect, it } from "vitest";
import { clampContacts, contactsFromLatest } from "@/lib/nostr-social";

describe("contactsFromLatest", () => {
  it("elige el kind:3 más nuevo entre las respuestas de varios relays", () => {
    const viejo = {
      created_at: 100,
      tags: [
        ["p", "a"],
        ["p", "b"],
      ],
    };
    const nuevo = {
      created_at: 200,
      tags: [
        ["p", "a"],
        ["p", "b"],
        ["p", "c-recien-seguido"],
      ],
    };
    // El relay desactualizado responde primero: igual gana el más nuevo.
    expect(contactsFromLatest([viejo, nuevo])).toEqual([
      "a",
      "b",
      "c-recien-seguido",
    ]);
    expect(contactsFromLatest([nuevo, viejo])).toEqual([
      "a",
      "b",
      "c-recien-seguido",
    ]);
  });

  it("ignora tags que no son p o sin valor", () => {
    expect(
      contactsFromLatest([
        { created_at: 1, tags: [["p", "a"], ["e", "x"], ["p"]] },
      ]),
    ).toEqual(["a"]);
  });

  it("devuelve vacío sin eventos", () => {
    expect(contactsFromLatest([])).toEqual([]);
  });
});

describe("clampContacts", () => {
  it("conserva la cola (los follows nuevos van al final del kind:3)", () => {
    const contacts = Array.from({ length: 200 }, (_, i) => `pk${i}`);
    const out = clampContacts(contacts, 150);
    expect(out).toHaveLength(150);
    expect(out[0]).toBe("pk50");
    expect(out[out.length - 1]).toBe("pk199");
  });

  it("no recorta listas chicas y mantiene el orden", () => {
    expect(clampContacts(["a", "b", "c"], 150)).toEqual(["a", "b", "c"]);
  });

  it("deduplica conservando la última aparición", () => {
    expect(clampContacts(["a", "b", "a", "c"], 150)).toEqual(["b", "a", "c"]);
  });
});
