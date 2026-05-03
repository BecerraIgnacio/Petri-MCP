import { ConnectRecord, OriginSource } from "./run-meta.js";
import { setConnectRecord } from "./run-store.js";

export interface ConnectSiteInput {
  projectRoot?: string;
  repoUrl?: string;
  repoRef?: string;
  liveUrl?: string;
  // Optional caller-supplied slug. If absent, an auto slug like `petri-a3k9pw`
  // is generated. Must match the runId pattern when supplied.
  name?: string;
}

export interface ConnectSiteResult {
  status: "connected";
  runId: string;
  displayName: string;
  controlPanelUrl: string;
  originSource: OriginSource;
  createdAt: number;
}

const RUN_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const AUTO_SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l/o/0/1
const AUTO_SLUG_LEN = 6;

export function generateRunId(rng: () => number = Math.random): string {
  let slug = "";
  for (let i = 0; i < AUTO_SLUG_LEN; i++) {
    const idx = Math.floor(rng() * AUTO_SLUG_ALPHABET.length);
    slug += AUTO_SLUG_ALPHABET[Math.min(idx, AUTO_SLUG_ALPHABET.length - 1)];
  }
  return `petri-${slug}`;
}

function deriveOriginAndDisplay(
  input: ConnectSiteInput,
): { originSource: OriginSource; displayName: string } {
  const provided =
    (input.projectRoot ? 1 : 0) +
    (input.repoUrl ? 1 : 0) +
    (input.liveUrl ? 1 : 0);
  if (provided !== 1) {
    throw new Error("connect_site: provide exactly one of liveUrl, projectRoot, or repoUrl");
  }
  if (input.liveUrl) {
    return {
      originSource: { kind: "live", liveUrl: input.liveUrl },
      displayName: input.liveUrl,
    };
  }
  if (input.repoUrl) {
    const originSource: OriginSource = input.repoRef
      ? { kind: "github", repoUrl: input.repoUrl, repoRef: input.repoRef }
      : { kind: "github", repoUrl: input.repoUrl };
    return { originSource, displayName: input.repoUrl };
  }
  // input.projectRoot is set (provided === 1 ensures this)
  const projectRoot = input.projectRoot as string;
  return {
    originSource: { kind: "local", projectRoot },
    displayName: projectRoot,
  };
}

export interface ConnectSiteDeps {
  save?: (record: ConnectRecord) => Promise<void>;
  generateId?: () => string;
  now?: () => number;
}

export async function runConnectSite(
  input: ConnectSiteInput,
  publicBase: string,
  deps: ConnectSiteDeps = {},
): Promise<ConnectSiteResult> {
  const save = deps.save ?? setConnectRecord;
  const genId = deps.generateId ?? generateRunId;
  const now = deps.now ?? Date.now;
  const runId = input.name ?? genId();
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(
      `connect_site: name "${runId}" must match ${RUN_ID_RE} (kebab-case, ≤60 chars, starts with a-z0-9)`,
    );
  }
  const { originSource, displayName } = deriveOriginAndDisplay(input);
  const createdAt = now();
  const record: ConnectRecord = { runId, displayName, originSource, createdAt };
  await save(record);
  const base = publicBase.replace(/\/+$/, "");
  return {
    status: "connected",
    runId,
    displayName,
    controlPanelUrl: `${base}/r/${runId}`,
    originSource,
    createdAt,
  };
}
