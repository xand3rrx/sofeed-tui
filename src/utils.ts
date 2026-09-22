import type { EntryJSON, ThreadPage, UserJSON } from './types'

export function codePointLength(value: string) {
  return Array.from(value).length
}

export function validatePost(value: string): string | null {
  if (!value.trim()) return 'Share something'
  if (value.length > 640) return 'Share fewer than 640 characters'
  return null
}

export function relativeTime(value: number | string, now = Date.now() / 1000) {
  const seconds = Math.max(0, Math.floor(now - new Date(typeof value === 'string' ? value : value * 1000).getTime() / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`
  return new Date((typeof value === 'string' ? Date.parse(value) / 1000 : value) * 1000).toISOString().slice(0, 10)
}

export function ensureStatus(status: string, expected: string[], invalidMessage: string) {
  if (!expected.includes(status)) {
    throw new Error(status === 'not found' ? 'That is already gone' : invalidMessage)
  }
}

export function displayName(user: UserJSON) {
  return user.full_name?.trim() || user.username
}

export function redact(value: string, token?: string) {
  return token ? value.split(token).join('[redacted]') : value
}

export async function openBrowser(url: string) {
  const command = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32'
    ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url]
  Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }).unref()
}

export type ThreadRow = { entry: EntryJSON; depth: number }

export function buildThread(page: ThreadPage): ThreadRow[] {
  const rows: ThreadRow[] = [
    ...page.ancestors.map(entry => ({ entry, depth: 0 })),
    { entry: page.entry, depth: 0 },
  ]
  const visit = (kids: EntryJSON[] | undefined, depth: number) => {
    for (const kid of kids ?? []) {
      rows.push({ entry: kid, depth })
      visit(kid.kids, depth + 1)
    }
  }
  visit(page.kids, 1)
  return rows
}

export function entryUrl(baseUrl: string, entry: EntryJSON) {
  return `${baseUrl}${entry.parent ? '/reply/' : '/post/'}${entry.id}`
}

export function profileUrl(baseUrl: string, username: string) {
  return `${baseUrl}/${encodeURIComponent(username)}`
}
