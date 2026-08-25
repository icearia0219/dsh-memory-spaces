/** Client-safe wire records exchanged through the private `/memory-share` command. */

/** Stable prefix that keeps command results distinguishable from ordinary prose. */
export const MEMORY_SHARE_RESULT_PREFIX = 'DSH_MEMORY_SHARE_V1:'

/** Complete JSON result consumed by the browser flow. */
export type MemoryShareResult =
  | { ok: true; operation: string; value: unknown }
  | { ok: false; operation: string; error: { code: string; message: string; labels?: string[] } }
