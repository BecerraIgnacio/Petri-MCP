import { publishVariantFiles, type PublishFile } from "./publish.js";
import { setRunMeta } from "./run-store.js";
import type { RunMeta } from "./run-meta.js";
import { injectReporter, isHtmlPath } from "./inject-reporter.js";

export interface StartSplitVariantInput {
  id: string;
  files: Array<{ path: string; content: string; contentType?: string }>;
}

export interface StartSplitInput {
  runId: string;
  championVariantId: string;
  splitRatio: number;
  variants: StartSplitVariantInput[];
  injectReporter?: boolean;
}

export interface StartSplitResult {
  status: "ok";
  runId: string;
  runUrl: string;
  championVariantId: string;
  variantIds: string[];
  splitRatio: number;
  blobBase: string;
  files: Record<string, string[]>;
  reporterInjected: boolean;
}

export interface StartSplitDeps {
  publish?: typeof publishVariantFiles;
  saveMeta?: typeof setRunMeta;
  now?: () => number;
}

export async function runStartSplit(
  input: StartSplitInput,
  publicBase: string,
  deps: StartSplitDeps = {},
): Promise<StartSplitResult> {
  const publish = deps.publish ?? publishVariantFiles;
  const saveMeta = deps.saveMeta ?? setRunMeta;
  const now = deps.now ?? Date.now;

  const variantIds = input.variants.map((v) => v.id);
  if (new Set(variantIds).size !== variantIds.length) {
    throw new Error("start_split: variant ids must be unique");
  }
  if (!variantIds.includes(input.championVariantId)) {
    throw new Error(
      `start_split: championVariantId "${input.championVariantId}" not found in variants[].id (${variantIds.join(", ")})`,
    );
  }

  const trimmedBase = publicBase.replace(/\/+$/, "");
  const reporterEnabled = input.injectReporter !== false;
  const reporterEndpoint = `${trimmedBase}/api/events`;

  let blobBase = "";
  const files: Record<string, string[]> = {};
  for (const variant of input.variants) {
    const publishFiles: PublishFile[] = variant.files.map((f) => {
      const content =
        reporterEnabled && isHtmlPath(f.path)
          ? injectReporter({
              html: f.content,
              runId: input.runId,
              variantId: variant.id,
              endpoint: reporterEndpoint,
            })
          : f.content;
      return {
        path: f.path,
        content,
        ...(f.contentType ? { contentType: f.contentType } : {}),
      };
    });
    const result = await publish({
      runId: input.runId,
      variantId: variant.id,
      files: publishFiles,
    });
    if (!blobBase) blobBase = result.blobBase;
    files[variant.id] = variant.files.map((f) => f.path.replace(/^\/+/, ""));
  }

  const meta: RunMeta = {
    runId: input.runId,
    championVariantId: input.championVariantId,
    variantIds,
    splitRatio: input.splitRatio,
    blobBase,
    files,
    createdAt: now(),
  };
  await saveMeta(meta);

  return {
    status: "ok",
    runId: input.runId,
    runUrl: `${trimmedBase}/p/${input.runId}/`,
    championVariantId: input.championVariantId,
    variantIds,
    splitRatio: input.splitRatio,
    blobBase,
    files,
    reporterInjected: reporterEnabled,
  };
}
