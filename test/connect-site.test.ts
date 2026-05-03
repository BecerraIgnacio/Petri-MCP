import { describe, it, expect } from "vitest";
import {
  generateRunId,
  runConnectSite,
  type ConnectSiteDeps,
} from "../src/shared/connect-site.js";
import type { ConnectRecord } from "../src/shared/run-meta.js";

function makeSaveStub(): { calls: ConnectRecord[]; deps: ConnectSiteDeps } {
  const calls: ConnectRecord[] = [];
  const deps: ConnectSiteDeps = {
    save: async (record) => {
      calls.push(record);
    },
  };
  return { calls, deps };
}

describe("generateRunId", () => {
  it("produces a slug matching the runId regex", () => {
    const id = generateRunId();
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,59}$/);
    expect(id.startsWith("petri-")).toBe(true);
  });

  it("uses the supplied rng deterministically", () => {
    const rng = (() => {
      const seq = [0, 0, 0, 0, 0, 0];
      let i = 0;
      return () => {
        const v = seq[i % seq.length] ?? 0;
        i++;
        return v;
      };
    })();
    expect(generateRunId(rng)).toBe("petri-aaaaaa");
  });
});

describe("runConnectSite", () => {
  it("mints an auto runId, writes a ConnectRecord, returns the control panel URL", async () => {
    const { calls, deps } = makeSaveStub();
    const result = await runConnectSite(
      { repoUrl: "https://github.com/foo/bar" },
      "https://petri-mcp.vercel.app",
      { ...deps, generateId: () => "petri-abc123", now: () => 1_700_000_000_000 },
    );
    expect(result.runId).toBe("petri-abc123");
    expect(result.displayName).toBe("https://github.com/foo/bar");
    expect(result.controlPanelUrl).toBe("https://petri-mcp.vercel.app/r/petri-abc123");
    expect(result.originSource).toEqual({ kind: "github", repoUrl: "https://github.com/foo/bar" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      runId: "petri-abc123",
      displayName: "https://github.com/foo/bar",
      createdAt: 1_700_000_000_000,
    });
  });

  it("respects a caller-supplied name as the runId", async () => {
    const { calls, deps } = makeSaveStub();
    const result = await runConnectSite(
      { repoUrl: "https://github.com/foo/bar", name: "my-site" },
      "https://petri-mcp.vercel.app",
      deps,
    );
    expect(result.runId).toBe("my-site");
    expect(result.controlPanelUrl).toBe("https://petri-mcp.vercel.app/r/my-site");
    expect(calls[0]?.runId).toBe("my-site");
  });

  it("rejects a name that doesn't match the runId regex", async () => {
    const { deps } = makeSaveStub();
    await expect(
      runConnectSite(
        { repoUrl: "https://github.com/foo/bar", name: "Bad_Name" },
        "https://petri-mcp.vercel.app",
        deps,
      ),
    ).rejects.toThrow(/must match/);
  });

  it("requires exactly one source", async () => {
    const { deps } = makeSaveStub();
    await expect(
      runConnectSite({}, "https://petri-mcp.vercel.app", deps),
    ).rejects.toThrow(/exactly one/);
    await expect(
      runConnectSite(
        { repoUrl: "https://github.com/foo/bar", liveUrl: "https://example.com" },
        "https://petri-mcp.vercel.app",
        deps,
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("preserves repoRef on the github originSource when supplied", async () => {
    const { calls, deps } = makeSaveStub();
    await runConnectSite(
      { repoUrl: "https://github.com/foo/bar", repoRef: "main" },
      "https://petri-mcp.vercel.app",
      deps,
    );
    expect(calls[0]?.originSource).toEqual({
      kind: "github",
      repoUrl: "https://github.com/foo/bar",
      repoRef: "main",
    });
  });

  it("encodes a liveUrl as a `live` originSource", async () => {
    const { calls, deps } = makeSaveStub();
    const result = await runConnectSite(
      { liveUrl: "https://my-v0-site.vercel.app" },
      "https://petri-mcp.vercel.app",
      { ...deps, generateId: () => "petri-live01" },
    );
    expect(result.originSource).toEqual({
      kind: "live",
      liveUrl: "https://my-v0-site.vercel.app",
    });
    expect(calls[0]?.displayName).toBe("https://my-v0-site.vercel.app");
  });

  it("encodes a projectRoot as a `local` originSource", async () => {
    const { calls, deps } = makeSaveStub();
    await runConnectSite(
      { projectRoot: "/tmp/my-project" },
      "https://petri-mcp.vercel.app",
      { ...deps, generateId: () => "petri-local1" },
    );
    expect(calls[0]?.originSource).toEqual({
      kind: "local",
      projectRoot: "/tmp/my-project",
    });
  });

  it("strips trailing slashes from publicBase", async () => {
    const { deps } = makeSaveStub();
    const result = await runConnectSite(
      { repoUrl: "https://github.com/foo/bar", name: "my-site" },
      "https://petri-mcp.vercel.app///",
      deps,
    );
    expect(result.controlPanelUrl).toBe("https://petri-mcp.vercel.app/r/my-site");
  });
});
