import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { THEME_NAMES } from './theme'
import type { FeedKind, ThemeName, UserJSON } from './types'

export const DEFAULT_URL = 'https://sofeed.cc'
export const FEED_KINDS: FeedKind[] = ['feed', 'mentions', 'replies', 'saved', 'trending', 'discover']

export type Config = { baseUrl: string; theme: ThemeName; token?: string; user?: UserJSON; lastTab?: FeedKind }

export function normalizeBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('Sofeed URL must be a valid HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Sofeed URL must use HTTP or HTTPS')
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (url.search || url.hash) throw new Error('Sofeed URL cannot include a query or fragment')
  return url.toString().replace(/\/$/, '')
}

export function configDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SOFEED_CONFIG_DIR) return env.SOFEED_CONFIG_DIR
  if (process.platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'sofeed')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'sofeed')
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sofeed')
}

export function configPath(env: Record<string, string | undefined> = process.env): string {
  return join(configDir(env), 'config.json')
}

export async function loadConfig(env: Record<string, string | undefined> = process.env): Promise<Config> {
  let stored: Partial<Config> = {}
  try {
    stored = JSON.parse(await readFile(configPath(env), 'utf8')) as Partial<Config>
  }
  catch {}
  const theme = env.SOFEED_THEME || stored.theme || 'auto'
  return {
    baseUrl: normalizeBaseUrl(env.SOFEED_URL || stored.baseUrl || DEFAULT_URL),
    theme: THEME_NAMES.includes(theme as ThemeName) ? theme as ThemeName : 'auto',
    token: env.SOFEED_TOKEN || stored.token,
    user: stored.user,
    lastTab: FEED_KINDS.includes(stored.lastTab as FeedKind) ? stored.lastTab : undefined,
  }
}

export async function saveConfig(config: Config, env: Record<string, string | undefined> = process.env) {
  const path = configPath(env)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
  await chmod(path, 0o600)
}
