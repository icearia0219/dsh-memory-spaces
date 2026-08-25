/** Redacted transcript row for private browser share operations. */

import type { CommandRowProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './MemoryShareCommandView.module.css'

function PrivateMemoryCommandView({
  node,
  label,
  working,
  failed,
  completed,
}: CommandRowProps & {
  label: string
  working: string
  failed: string
  completed: string
}) {
  const state = node.outcome === null ? 'working' : node.outcome.kind
  return (
    <div className={css.row} data-state={state} role="status">
      <span className={css.dot} />
      <span>{label}</span>
      <span className={css.summary}>
        {state === 'working' ? working : state === 'error' ? failed : completed}
      </span>
    </div>
  )
}

/** Keep encoded share request/results out of the visible transcript while preserving operation status. */
export function MemoryShareCommandView(props: CommandRowProps) {
  return <PrivateMemoryCommandView {...props} label="memory share" working="正在处理安全分享…" failed="分享操作失败" completed="分享操作已处理" />
}

/** Keep encoded governance request/results out of the visible transcript while preserving operation status. */
export function MemorySpaceUiCommandView(props: CommandRowProps) {
  return <PrivateMemoryCommandView {...props} label="memory space" working="正在处理记忆空间操作…" failed="记忆空间操作失败" completed="记忆空间操作已处理" />
}
