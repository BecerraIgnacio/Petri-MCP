import type { Mutation, Variant } from "./schema.js";
import { z } from "zod";
import { VibeIdentifierOk } from "../vibe-identifier/schema.js";

type LockManifest = z.infer<typeof VibeIdentifierOk>;
type LockEntry = LockManifest["locked_selectors"][number];

export type LockTuple = {
  scope: string;       // file path the mutation acts in (or "*")
  selector: string;
  property: string;
};

export type Overlap = {
  variantId: string;
  mutationIndex: number;
  mutation: Mutation;
  lockEntry: LockEntry;
};

/**
 * Derive the (scope, selector, property) tuple a mutation would touch.
 * Returns null when the mutation has no locking semantics in v1 (e.g. add_node).
 */
export function tupleFor(mutation: Mutation): LockTuple | null {
  switch (mutation.kind) {
    case "css_property":
      return { scope: mutation.file, selector: mutation.selector, property: mutation.property };
    case "text_content":
      return { scope: mutation.file, selector: mutation.selector, property: "text-content" };
    case "attribute":
      return { scope: mutation.file, selector: mutation.selector, property: `attr:${mutation.attribute}` };
    case "css_variable":
      return { scope: mutation.file, selector: ":root", property: mutation.variable };
    case "remove_node":
      return { scope: mutation.file, selector: mutation.selector, property: "element" };
    case "add_node":
      // v1: add_node never overlaps. Locking a parent element does NOT prevent adding children;
      // future: introduce an explicit "element-children" lock token if needed.
      return null;
  }
}

function scopeMatches(lockScope: string, mutationScope: string): boolean {
  return lockScope === "*" || lockScope === mutationScope;
}

/**
 * Check an Evolver output against a lock manifest. Returns the list of overlaps; empty array means valid.
 */
export function findOverlaps(
  variants: Variant[],
  manifest: LockManifest,
): Overlap[] {
  const out: Overlap[] = [];
  const locks = manifest.locked_selectors;
  for (const variant of variants) {
    for (let i = 0; i < variant.mutations.length; i++) {
      const m = variant.mutations[i];
      if (!m) continue;
      const t = tupleFor(m);
      if (!t) continue;
      for (const lock of locks) {
        if (
          scopeMatches(lock.scope, t.scope) &&
          lock.selector === t.selector &&
          lock.property === t.property
        ) {
          out.push({ variantId: variant.id, mutationIndex: i, mutation: m, lockEntry: lock });
        }
      }
    }
  }
  return out;
}
