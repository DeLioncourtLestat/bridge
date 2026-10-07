/** App shortcuts. Stored as Electron accelerators ("CmdOrCtrl+Shift+F"); the main process puts them on the menu. */
export const COMMANDS = [
  { id: 'find-in-files', label: 'Find in files', group: 'Search', def: 'CmdOrCtrl+Shift+F' },
  { id: 'go-to-file', label: 'Go to file', group: 'Search', def: 'CmdOrCtrl+Shift+O' },
  { id: 'new-fork', label: 'New fork or ghost', group: 'Project', def: 'CmdOrCtrl+N' },
  { id: 'open-project', label: 'Open project', group: 'Project', def: 'CmdOrCtrl+O' },
  { id: 'tasks', label: 'Show tasks', group: 'View', def: 'CmdOrCtrl+1' },
  { id: 'notes', label: 'Show notes', group: 'View', def: 'CmdOrCtrl+2' },
  { id: 'instructions', label: 'Show instructions', group: 'View', def: 'CmdOrCtrl+3' },
  { id: 'settings', label: 'Settings', group: 'View', def: 'CmdOrCtrl+,' },
] as const

export type CommandId = (typeof COMMANDS)[number]['id']

/** The shortcut in use: the user's override ('' = none) or the default. */
export const shortcut = (keys: Partial<Record<string, string>> | undefined, id: CommandId) =>
  keys?.[id] ?? COMMANDS.find((c) => c.id === id)!.def

/** "CmdOrCtrl+Shift+F" → "⌘⇧F" on a Mac, "Ctrl+Shift+F" elsewhere. */
export function formatShortcut(acc: string, mac: boolean) {
  if (!acc) return ''
  const parts = acc.split('+').filter(Boolean)
  if (acc.endsWith('++')) parts.push('+')
  const sym: Record<string, string> = mac
    ? { CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' }
    : { CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl', Ctrl: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }
  const names: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵', Backspace: '⌫', Delete: '⌦', Escape: 'Esc', Space: 'Space', Tab: '⇥' }
  const out = parts.map((p) => sym[p] ?? names[p] ?? p)
  return mac ? out.join('') : out.join('+')
}

const KEY_CODES: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
}

/** A key press as an accelerator, or null while only modifiers are held or no modifier is used. */
export function shortcutFromEvent(e: { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean) {
  let key: string | undefined
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code
  else key = KEY_CODES[e.code]
  if (!key) return null
  const primary = mac ? e.metaKey : e.ctrlKey
  const fkey = /^F\d/.test(key)
  if (!primary && !e.altKey && !(mac && e.ctrlKey) && !fkey) return null // plain letters stay for typing
  const mods = [primary && 'CmdOrCtrl', mac && e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean)
  return [...mods, key].join('+')
}
