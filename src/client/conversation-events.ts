/** Compatibility registration for the legacy and current Conversation event services. */

/** DSH service that owns a Conversation event registry. */
export type ConversationEventRegistrySource = 'conversationEvents' | 'uiConversation'

/** Structural face shared by the legacy registry and `uiConversation.events`. */
export interface ConversationEventRegistryLike<Definition> {
  /**
   * Register one Conversation event definition.
   * @param definition - definition owned by the caller.
   * @returns idempotent registration disposer.
   */
  register(definition: Definition): () => void
}

/**
 * Keep one definition registered while either DSH Conversation service exists.
 * The current `uiConversation` service takes precedence when both are present.
 */
export class ConversationEventRegistryBridge<Definition> {
  private readonly registries: Partial<Record<ConversationEventRegistrySource, ConversationEventRegistryLike<Definition>>> = {}
  private active: ConversationEventRegistryLike<Definition> | undefined
  private disposeActive: () => void = () => {}

  /** @param definition - Conversation event definition to register. */
  constructor(private readonly definition: Definition) {}

  /**
   * Attach one available DSH registry and reconcile the active registration.
   * @param source - service that exposed the registry.
   * @param registry - registry associated with the service activation.
   * @returns idempotent attachment disposer.
   */
  attach(
    source: ConversationEventRegistrySource,
    registry: ConversationEventRegistryLike<Definition>,
  ): () => void {
    this.registries[source] = registry
    this.reconcile()
    let attached = true
    return () => {
      if (!attached) return
      attached = false
      if (this.registries[source] !== registry) return
      delete this.registries[source]
      this.reconcile()
    }
  }

  /** Move the definition to the highest-priority available registry. */
  private reconcile(): void {
    const next = this.registries.uiConversation ?? this.registries.conversationEvents
    if (next === this.active) return
    this.disposeActive()
    this.active = undefined
    this.disposeActive = () => {}
    if (next === undefined) return
    const dispose = next.register(this.definition)
    this.active = next
    this.disposeActive = dispose
  }
}
