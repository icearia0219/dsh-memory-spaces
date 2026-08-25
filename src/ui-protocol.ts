/** Structured result envelope for the log-redacted memory-space UI command. */

/** Prefix distinguishing memory-space UI results from ordinary command prose. */
export const MEMORY_UI_RESULT_PREFIX = 'DSH_MEMORY_UI_V1:'

/** Success or safe rejection returned to the browser. */
export type MemoryUiResult =
  | { ok: true; operation: string; value: unknown }
  | { ok: false; operation: string; error: { code: string; message: string; labels?: string[] } }
