/** Client services required before memory sharing can register UI or execute commands. */
export const MEMORY_SPACES_CLIENT_INJECT = [
  'slots',
  'locale',
  'conversationEvents',
  'remote',
  'remote.commands',
] as const
