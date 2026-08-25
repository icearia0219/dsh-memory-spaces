/** Services required by the DSH browser plugin entry. */
export declare const inject: readonly string[]

/**
 * Register the memory-space browser UI in a DSH client context.
 * @param ctx - DSH client context supplied by the browser plugin loader.
 */
export declare function apply(ctx: unknown): void
