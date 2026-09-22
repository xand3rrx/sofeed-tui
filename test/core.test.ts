import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError, SofeedApi } from '../src/api'
import { editingShortcuts, globalShortcuts, screenShortcuts } from '../src/app'
import { parseArgs } from '../src/cli'
import { clampSelection, isAsciiArtPost, terminalSafeText, tokenizeRichText } from '../src/components'
import { configDir, configPath, loadConfig, normalizeBaseUrl, saveConfig } from '../src/config'
import { normalizeShiftInput } from '../src/input'
import { initialState, isEditingScreen, reducer } from '../src/state'
import { palette, themeScheme, THEME_NAMES, THEMES } from '../src/theme'
import type { EntryJSON, Screen, ThreadPage, UserJSON } from '../src/types'
import { buildThread, codePointLength, displayName, ensureStatus, entryUrl, redact, relativeTime,
  validatePost } from '../src/utils'

const user = (username: string): UserJSON => ({
  username,
  full_name: `${username} Example`,
  first_name: username,
  last_name: 'Example',
  created_at: 1_700_000_000,
  emoji: '',
  link: '',
  description: '',
  social: {},
})

const entry = (id: number, parent_id: number | null = null): EntryJSON => ({
  id,
  content: `entry ${id}`,
  created_by: user('david'),
  saved: false,
  timestamp: '2m',
  reply_count: 0,
  parent: parent_id ? entry(parent_id) : null,
})

describe('configuration', () => {
  test('normalizes and validates instance URLs', () => {
    expect(normalizeBaseUrl('https://sofeed.cc/')).toBe('https://sofeed.cc')
    expect(() => normalizeBaseUrl('file:///tmp/no')).toThrow('HTTP')
    expect(() => normalizeBaseUrl('wat')).toThrow('valid')
  })
  test('environment overrides stored values without changing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sofeed-test-'))
    const env = { SOFEED_CONFIG_DIR: root }
    expect(configDir(env)).toBe(root)
    expect(configPath(env)).toBe(join(root, 'config.json'))
    await saveConfig({ baseUrl: 'https://stored.example', theme: 'plum', token: 'stored', user: user('lucian'),
      lastTab: 'mentions' }, env)
    const loaded = await loadConfig({ ...env, SOFEED_URL: 'https://override.example', SOFEED_TOKEN: 'env' })
    expect(loaded.baseUrl).toBe('https://override.example')
    expect(loaded.token).toBe('env')
    expect(loaded.user?.username).toBe('lucian')
    expect(loaded.lastTab).toBe('mentions')
    expect(JSON.parse(await readFile(configPath(env), 'utf8')).token).toBe('stored')
    if (process.platform !== 'win32') expect((await stat(configPath(env))).mode & 0o777).toBe(0o600)
  })
})

describe('API client', () => {
  test('signs in with a urlencoded username and password', async () => {
    let seen: [string, RequestInit] | undefined
    const api = new SofeedApi('https://sofeed.cc', undefined, (async (url: any, init: any) => {
      seen = [String(url), init]
      return Response.json({ token: 'fernet-token', user: user('lucian') })
    }) as typeof fetch)
    const session = await api.login('lucian', 'Testpass1')
    expect(seen?.[0]).toBe('https://sofeed.cc/api/login')
    expect(new Headers(seen?.[1].headers).get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(seen?.[1].body).toBe('username=lucian&password=Testpass1')
    expect(session.token).toBe('fernet-token')
    expect(session.user.username).toBe('lucian')
  })
  test('constructs page-numbered public and authenticated reads', async () => {
    const seen: [string, RequestInit][] = []
    const api = new SofeedApi('https://sofeed.cc', 'secret', (async (url: any, init: any) => {
      seen.push([String(url), init])
      return Response.json({ page: 1, entries: [] })
    }) as typeof fetch)
    await api.trending(2)
    await api.discover('quiet thoughts', 3)
    await api.member('a/b', 1)
    await api.thread(12)
    await api.people('david')
    await api.feed()
    expect(seen.map(([url]) => url)).toEqual([
      'https://sofeed.cc/api/trending?p=2',
      'https://sofeed.cc/api/discover?q=quiet+thoughts&p=3',
      'https://sofeed.cc/api/a%2Fb?p=1',
      'https://sofeed.cc/api/reply/12',
      'https://sofeed.cc/api/people?q=david&p=1',
      'https://sofeed.cc/api/feed?p=1',
    ])
    expect(new Headers(seen[3][1].headers).get('authorization')).toBe('Bearer secret')
  })
  test('maps post actions to their endpoints', async () => {
    const seen: string[] = []
    const api = new SofeedApi('https://sofeed.cc', 'secret', (async (url: any) => {
      seen.push(String(url))
      return Response.json({ status: 'unsave' })
    }) as typeof fetch)
    await api.createThread('hello')
    await api.createReply(4, 'hi')
    await api.editPost(4, 'edited')
    await api.deletePost(4)
    await api.savePost(4)
    await api.unsavePost(4)
    await api.follow('david')
    await api.unfollow('david')
    expect(seen).toEqual([
      'https://sofeed.cc/api/thread',
      'https://sofeed.cc/api/reply/4',
      'https://sofeed.cc/api/edit/4',
      'https://sofeed.cc/api/delete/4',
      'https://sofeed.cc/api/save/4',
      'https://sofeed.cc/api/unsave/4',
      'https://sofeed.cc/api/follow/david',
      'https://sofeed.cc/api/unfollow/david',
    ])
  })
  test('surfaces field errors returned on a 200 response', async () => {
    const api = new SofeedApi('https://sofeed.cc', 'secret',
      (async () => Response.json({ errors: { content: 'Share something' } })) as unknown as typeof fetch)
    let error!: ApiError
    try {
      await api.createThread('')
    }
    catch (caught) {
      error = caught as ApiError
    }
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(200)
    expect(error.firstError).toBe('Share something')
  })
  test('reports HTTP failures with the server title', async () => {
    const api = new SofeedApi('https://sofeed.cc', undefined,
      (async () => Response.json({ title: '401 Unauthorized', description: 'Login required' },
        { status: 401 })) as unknown as typeof fetch)
    let error!: ApiError
    try {
      await api.feed()
    }
    catch (caught) {
      error = caught as ApiError
    }
    expect(error.status).toBe(401)
    expect(error.message).toBe('401 Unauthorized: Login required')
  })
})

describe('domain helpers', () => {
  test('validates length, and leaves non-ASCII to the server', () => {
    expect(codePointLength('🌱')).toBe(1)
    expect(validatePost('')).toBeTruthy()
    expect(validatePost('x'.repeat(641))).toContain('640')
    expect(validatePost('héllo')).toBeNull()
    expect(validatePost('hello 🌱')).toBeNull()
    expect(validatePost('hello')).toBeNull()
  })
  test('formats dates, redacts tokens, and navigates', () => {
    expect(relativeTime(1_700_000_000, 1_700_000_120)).toBe('2m')
    expect(redact('Bearer secret', 'secret')).toBe('Bearer [redacted]')
    const pushed = reducer(initialState, { type: 'push', screen: { kind: 'help' } })
    expect(initialState.stack[0]).toEqual({ kind: 'feed', feed: 'trending' })
    expect(reducer(pushed, { type: 'back' }).stack).toHaveLength(1)
  })
  test('parses CLI flags', () => {
    expect(parseArgs(['--url', 'https://x.test/', '--theme', 'paper'])).toEqual({ url: 'https://x.test',
      theme: 'paper' })
    expect(() => parseArgs(['--wat'])).toThrow('Unknown')
    expect(() => parseArgs(['--theme', 'light'])).toThrow('--theme must be one of')
  })
  test('treats a refused write as a failure despite its 200', () => {
    expect(() => ensureStatus('deleted', ['deleted'], 'Cannot delete: the post has replies')).not.toThrow()
    expect(() => ensureStatus('not valid', ['deleted'], 'Cannot delete: the post has replies'))
      .toThrow('the post has replies')
    expect(() => ensureStatus('not found', ['unsave'], 'Could not change the saved state'))
      .toThrow('already gone')
  })
  test('falls back to the username when there is no display name', () => {
    expect(displayName(user('lucian'))).toBe('lucian Example')
    expect(displayName({ ...user('lucian'), full_name: '' })).toBe('lucian')
  })
  test('links entries by whether they are a reply', () => {
    expect(entryUrl('https://sofeed.cc', entry(1))).toBe('https://sofeed.cc/post/1')
    expect(entryUrl('https://sofeed.cc', entry(2, 1))).toBe('https://sofeed.cc/reply/2')
  })
  test('flattens a thread page into ancestors, the entry, and nested kids', () => {
    const page: ThreadPage = {
      ancestors: [entry(1)],
      entry: entry(2, 1),
      kids: [
        { ...entry(3, 2), kids: [entry(4, 3)] },
        entry(5, 2),
      ],
    }
    expect(buildThread(page).map(row => [row.entry.id, row.depth])).toEqual([[1, 0], [2, 0], [3, 1], [4, 2], [5, 1]])
  })
})

describe('rendering helpers', () => {
  test('linkifies markdown, URLs, and domains without touching inline code', () => {
    const tokens = tokenizeRichText(
      'See [small PRs](getsmall.xyz/post/one), https://sofeed.cc and `example.com` with @david #ascii.',
    )
    expect(tokens.filter(token => token.kind === 'link')).toEqual([
      { kind: 'link', text: 'small PRs', url: 'https://getsmall.xyz/post/one' },
      { kind: 'link', text: 'https://sofeed.cc', url: 'https://sofeed.cc' },
    ])
    expect(tokens.some(token => token.kind === 'code' && token.text === '`example.com`')).toBeTrue()
    expect(tokens.some(token => token.kind === 'reference' && token.text === '@david')).toBeTrue()
    expect(tokens.some(token => token.kind === 'reference' && token.text === '#ascii')).toBeTrue()
  })
  test('renders emoji modifiers safely without changing adjacent text', () => {
    expect(terminalSafeText('yes 🙌🏻!')).toBe('yes 🙌!')
    expect(terminalSafeText('👍🏽 link.example')).toBe('👍 link.example')
  })
  test('normalizes terminal whitespace without disturbing ASCII art', () => {
    expect(terminalSafeText('A\tB\r\n  /\\\r |  |')).toBe('A   B\n  /\\\n |  |')
    expect(terminalSafeText('123\tX\n1234\tX')).toBe('123 X\n1234    X')
  })
  test('recognizes ASCII-art mode from the hashtag in the content', () => {
    expect(isAsciiArtPost({ content: '`literal` example.com #ascii' })).toBeTrue()
    expect(isAsciiArtPost({ content: 'art\n#ascii_art' })).toBeTrue()
    expect(isAsciiArtPost({ content: 'art #ASCII' })).toBeTrue()
    expect(isAsciiArtPost({ content: 'ordinary text with #design' })).toBeFalse()
  })
  test('folds a shifted lowercase letter back to uppercase', () => {
    expect(normalizeShiftInput('u', { shift: true })).toBe('U')
    expect(normalizeShiftInput('g', { shift: true })).toBe('G')
    expect(normalizeShiftInput('U', { shift: true })).toBe('U')
    expect(normalizeShiftInput('u', {})).toBe('u')
    expect(normalizeShiftInput('u', { shift: false })).toBe('u')
    expect(normalizeShiftInput('?', { shift: true })).toBe('?')
    expect(normalizeShiftInput('1', { shift: true })).toBe('1')
  })
  test('a prompt that has been answered stops owning the keyboard', () => {
    expect(isEditingScreen({ kind: 'search' })).toBeTrue()
    expect(isEditingScreen({ kind: 'people' })).toBeTrue()
    expect(isEditingScreen({ kind: 'search', query: 'orchid' })).toBeFalse()
    expect(isEditingScreen({ kind: 'people', query: '' })).toBeFalse()
    expect(isEditingScreen({ kind: 'compose' })).toBeTrue()
    expect(isEditingScreen({ kind: 'feed', feed: 'trending' })).toBeFalse()
    expect(isEditingScreen({ kind: 'post', id: 3 })).toBeFalse()
    expect(isEditingScreen({ kind: 'live' })).toBeFalse()
  })
  test('offers the site schemes and paints their palettes', () => {
    expect(THEME_NAMES).toEqual(['auto', 'mono', 'paper', 'sepia', 'rose', 'midnight', 'forest', 'plum'])
    expect(THEMES.map(theme => theme.name)).toEqual(['Auto', 'Mono', 'Paper', 'Sepia', 'Rosé', 'Midnight', 'Forest',
      'Plum'])
    expect(palette('paper').bg).toBe('#f6efe0')
    expect(palette('paper').ink).toBe('#2e2620')
    expect(palette('plum').bg).toBe('#150f1e')
    expect(palette('forest').accent).toBe('#57c98a')
    expect(palette('midnight').danger).toBe('#f85149')
    expect(palette('mono').accentDark).not.toBe(palette('mono').accent)
  })
  test('auto follows the terminal and NO_COLOR drops every color', () => {
    const colorfgbg = process.env.COLORFGBG
    const noColor = process.env.NO_COLOR
    try {
      delete process.env.NO_COLOR
      process.env.COLORFGBG = '15;0'
      expect(themeScheme('auto').bg).toBe('#000000')
      process.env.COLORFGBG = '0;15'
      expect(themeScheme('auto').bg).toBe('#ffffff')
      process.env.NO_COLOR = '1'
      expect(palette('midnight').ink).toBeUndefined()
      expect(palette('midnight').bg).toBeUndefined()
    }
    finally {
      colorfgbg === undefined ? delete process.env.COLORFGBG : process.env.COLORFGBG = colorfgbg
      noColor === undefined ? delete process.env.NO_COLOR : process.env.NO_COLOR = noColor
    }
  })
  test('the footer names the keys that matter, including settings', () => {
    const signedIn = globalShortcuts(true)
    expect(signedIn).toContain('m people')
    expect(signedIn).toContain('0 profile')
    expect(signedIn).toContain(', settings')
    expect(signedIn).not.toContain('U people')
    expect(globalShortcuts(false)).not.toContain('0 profile')
    const screens: Screen[] = [
      { kind: 'feed', feed: 'trending' }, { kind: 'search', query: 'x' }, { kind: 'people', query: '' },
      { kind: 'post', id: 1 }, { kind: 'profile', handle: 'x' }, { kind: 'live' }, { kind: 'help' },
    ]
    for (const screen of screens) expect(screenShortcuts(screen).length).toBeGreaterThan(10)
    expect(screenShortcuts({ kind: 'post', id: 1 })).toContain('T top')
    expect(editingShortcuts({ kind: 'search' })).toContain('Enter searches posts')
  })
  test('clamps selection to the list bounds', () => {
    expect(clampSelection(-1, 3)).toBe(0)
    expect(clampSelection(9, 3)).toBe(2)
    expect(clampSelection(0, 0)).toBe(0)
  })
})
