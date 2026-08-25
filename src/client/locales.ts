/** Simplified Chinese dictionary for the memory command transcript. */
export const zh = {
  'commandInput.aria': '记忆命令输入',
} satisfies Record<string, string>

/** Locale key union for the memory command transcript. */
export type MemorySpacesKey = keyof typeof zh

/** English dictionary checked against the Simplified Chinese key set. */
export const en = {
  'commandInput.aria': 'Memory command input',
} satisfies Record<MemorySpacesKey, string>
