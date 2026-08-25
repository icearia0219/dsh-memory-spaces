import { memo } from 'react'
import { MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MemoryCommandInputData } from './memory-command-input.ts'
import css from './MemoryCommandInputView.module.css'

type MemoryCommandInputViewProps =
  PropsRuntime<'conversation.chat.node', 'memory-command-input'>
  & PropsLocale<'memorySpaces'>

/** Right-aligned `/memory` input bubble without ordinary message actions. */
export const MemoryCommandInputView = memo(function MemoryCommandInputView({
  node, t,
}: MemoryCommandInputViewProps) {
  const data: MemoryCommandInputData = node.data
  return (
    <div
      className={css.row}
      data-memory-command-input=""
      role="group"
      aria-label={t('commandInput.aria')}
    >
      <div className={css.stack}>
        <div className={css.bubble}>
          <MessageText text={data.text} />
        </div>
      </div>
    </div>
  )
})
