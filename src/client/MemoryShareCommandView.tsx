/** Redacted transcript row for private browser share operations. */

import type { CommandRowProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './MemoryShareCommandView.module.css'

function PrivateMemoryCommandView({
  node,
  label,
  working,
  failed,
}: CommandRowProps & {
  label: string
  working: string
  failed: string
}) {
  const state = node.outcome === null ? 'working' : node.outcome.kind
  if (state === 'success') return null
  return (
    <div className={css.row} data-state={state} role="status">
      <span className={css.dot} />
      <span>{label}</span>
      <span className={css.summary}>
        {state === 'working' ? working : failed}
      </span>
    </div>
  )
}

/** Keep encoded share request/results out of the visible transcript while preserving operation status. */
export function MemoryShareCommandView(props: CommandRowProps) {
  return <PrivateMemoryCommandView {...props} label="memory share" working="正在处理安全分享…" failed="分享操作失败" />
}

/** Keep encoded governance request/results out of the visible transcript while preserving operation status. */
export function MemorySpaceUiCommandView(props: CommandRowProps) {
  return <PrivateMemoryCommandView {...props} label="memory space" working="正在处理记忆空间操作…" failed="记忆空间操作失败" />
}
