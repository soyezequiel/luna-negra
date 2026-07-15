import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Dockerfile", () => {
  it("copia los parches antes de npm ci para que postinstall los aplique", () => {
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    const copyPatches = dockerfile.indexOf("COPY patches ./patches");
    const installDependencies = dockerfile.indexOf("RUN npm ci");

    expect(copyPatches).toBeGreaterThan(-1);
    expect(installDependencies).toBeGreaterThan(copyPatches);
  });
});
