/** Browser projection for durable `/memory` input and command outcomes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { memoryCommandInputDefinition } from './memory-command-input.ts'
import { MemoryCommandInputView } from './MemoryCommandInputView.tsx'
import { MemoryShareCommandView, MemorySpaceUiCommandView } from './MemoryShareCommandView.tsx'
import { MEMORY_SPACES_CLIENT_INJECT } from './dependencies.ts'
import {
  MemoryInjectionPreview, MemoryShareHeaderButton, MemorySidebarSelectionTray,
  MemorySidebarSessionLeading, type MemoryShareInjected,
} from './MemoryShareUi.tsx'
import { MemoryShareController } from './share-controller.ts'
import { en, zh, type MemorySpacesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Memory command transcript copy. */
    memorySpaces: MemorySpacesKey
  }
}

const NS = 'memorySpaces'

/** Client services required by the memory command transcript projection. */
export const inject = MEMORY_SPACES_CLIENT_INJECT

/**
 * Register the replayable memory command input node and its renderer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new MemoryShareController()
  const injected = (): MemoryShareInjected => ({ controller, remote: ctx.remote })
  ctx.conversationEvents.register(memoryCommandInputDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'memory-spaces: client dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'memory-command-input',
    locale: NS,
  }, MemoryCommandInputView))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'memory-share', order: 35, inject: injected,
  }, MemoryShareHeaderButton))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'memory-injection-preview', order: 25, inject: injected,
  }, MemoryInjectionPreview))
  ctx.slots.inject('sidebar.workspaces.session.leading', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.leading', id: 'memory-spaces-session-select', order: 15, inject: injected,
  }, MemorySidebarSessionLeading))
  ctx.slots.inject('sidebar.workspaces.overlay', () => ctx.slots.register({
    name: 'sidebar.workspaces.overlay', id: 'memory-spaces-selection-tray', order: 15, inject: injected,
  }, MemorySidebarSelectionTray))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'memory-share', inject: injected,
  }, MemoryShareCommandView))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview', key: 'memory-space-ui', inject: injected,
  }, MemorySpaceUiCommandView))
}
