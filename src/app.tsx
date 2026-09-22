import { Box, measureElement, Text, useApp, useInput, useStdout } from 'ink'
import type { DOMElement } from 'ink'
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import wrapAnsi from 'wrap-ansi'
import { ApiError, errorMessage, PAGE_SIZE, SofeedApi } from './api'
import { clampSelection, Editor, Footer, Header, isAsciiArtPost, Menu, Message, Note, ProfileHeader, Spinner,
  terminalSafeText, tokenizeRichText } from './components'
import type { Config } from './config'
import { saveConfig } from './config'
import { useRemote } from './hooks'
import { normalizeShiftInput, ScreenInputBoundary, useScreenActive, useScreenInput } from './input'
import { initialState, isEditingScreen, reducer } from './state'
import { palette, THEMES } from './theme'
import type { EntryJSON, FeedKind, Page, Screen, UserJSON } from './types'
import { buildThread, displayName, ensureStatus, entryUrl, openBrowser, profileUrl, validatePost } from './utils'

type Shared = {
  api: SofeedApi
  config: Config
  setConfig(config: Config): Promise<void>
  me?: UserJSON
  refreshMe(): void
  push(screen: Screen): void
  replace(screen: Screen): void
  back(): void
  status(text?: string, error?: boolean): void
  setOverlay(open: boolean): void
  p: ReturnType<typeof palette>
}

export function App({ initialConfig }: { initialConfig: Config }) {
  const [config, setConfigState] = useState(initialConfig)
  const api = useMemo(() => new SofeedApi(config.baseUrl, config.token), [config.baseUrl, config.token])
  const startingTab: FeedKind = config.token ? config.lastTab || 'feed' : 'trending'
  const [state, dispatch] = useReducer(reducer, { ...initialState, stack: [{ kind: 'feed', feed: startingTab }] })
  const { exit } = useApp()
  const { stdout } = useStdout()
  const me = config.user
  const screen = state.stack.at(-1)!
  const [overlay, setOverlay] = useState(false)

  const setConfig = useCallback(async (next: Config) => {
    setConfigState(next)
    await saveConfig(next)
  }, [])

  const refreshMe = useCallback(() => {
    const username = config.user?.username
    if (!config.token || !username) return
    const clear = () => setConfigState(current => {
      const next = { ...current, token: undefined, user: undefined }
      void saveConfig(next)
      return next
    })
    void api.member(username, 1).then(page => setConfigState(current => {
      const next = { ...current, user: page.member }
      void saveConfig(next)
      return next
    })).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) clear()
    })
  }, [api, config.token, config.user?.username])

  useEffect(() => { refreshMe() }, [api])

  const openFeed = (feed: FeedKind) => {
    dispatch({ type: 'replace', screen: { kind: 'feed', feed } })
    if (config.token && config.lastTab !== feed) void setConfig({ ...config, lastTab: feed })
  }
  const editing = isEditingScreen(screen)

  useInput((rawInput, key) => {
    const input = normalizeShiftInput(rawInput, key)
    if (editing || overlay) return
    if (input === 'q' || key.escape || key.leftArrow || input === 'h') {
      state.stack.length > 1
        ? dispatch({ type: 'back' })
        : exit()
    }
    else if (input === '?') dispatch({ type: 'push', screen: { kind: 'help' } })
    else if (input === '/') dispatch({ type: 'push', screen: { kind: 'search' } })
    else if (input === 'm' || input === 'M') dispatch({ type: 'push', screen: { kind: 'people' } })
    else if (input === 'w') dispatch({ type: 'push', screen: me ? { kind: 'compose' } : { kind: 'login' } })
    else if (input === 'L') dispatch({ type: 'push', screen: { kind: 'live' } })
    else if (input === ',') dispatch({ type: 'push', screen: { kind: 'settings' } })
    else if (input === '0' && me) dispatch({ type: 'push', screen: { kind: 'profile', handle: me.username } })
    else if (input === 'a') dispatch({ type: 'push', screen: me ? { kind: 'account' } : { kind: 'login' } })
    else if (input === '1') openFeed(me ? 'feed' : 'trending')
    else if (input === '2') openFeed(me ? 'mentions' : 'discover')
    else if (input === '3' && me) openFeed('replies')
    else if (input === '4' && me) openFeed('saved')
    else if (input === '5') openFeed('trending')
    else if (input === '6') openFeed('discover')
  })

  const footerLines = editing ? [editingShortcuts(screen)] : [globalShortcuts(!!me), screenShortcuts(screen)]

  const shared: Shared = { api, config, setConfig, me, refreshMe, setOverlay,
    push: next => dispatch({ type: 'push', screen: next }),
    replace: next => dispatch({ type: 'replace', screen: next }),
    back: () => dispatch({ type: 'back' }),
    status: (text, error) => dispatch({ type: 'status', text, error }), p: palette(config.theme) }
  return (
    <Box flexDirection="column" height={stdout?.rows || 24} overflowY="hidden" backgroundColor={shared.p.bg}>
      <Header active={screenTitle(screen)} handle={me?.username} authenticated={!!config.token} p={shared.p} />
      {state.status && <Message {...state.status} p={shared.p} />}
      <Box flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} flexDirection="column" overflowY="hidden">
        {state.stack.map((stackScreen, index) => {
          const active = index === state.stack.length - 1
          return (
            <Box key={index} display={active ? 'flex' : 'none'} flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0}
              flexDirection="column" overflowY="hidden"
            >
              <ScreenInputBoundary active={active}>
                <ScreenView screen={stackScreen} shared={shared} />
              </ScreenInputBoundary>
            </Box>
          )
        })}
      </Box>
      <Footer p={shared.p} lines={footerLines} />
    </Box>
  )
}

export function globalShortcuts(signedIn: boolean) {
  const feed = signedIn ? '1-6 feeds  ' : ''
  const profile = signedIn ? '0 profile  ' : ''
  const account = signedIn ? 'a account  ' : ''
  return `${feed}/ search  m people  ${profile}w write  L live  ${account}, settings  ? help  q back`
}

export function screenShortcuts(screen: Screen) {
  switch (screen.kind) {
    case 'feed':
    case 'search':
      return '↑↓/jk move · enter open · u author · r reply · s save · o browser · n/p page · R refresh'
    case 'people':
      return '↑↓/jk move · enter opens a profile · o browser · n/p page · R refresh'
    case 'post':
      return 'Tab target · enter open · T top · P parent · u author · r reply · s save · f/F follow · e edit · d delete · o browser'
    case 'profile':
      return '↑↓ tabs then the list · enter open · f/F follow · o browser'
    case 'live':
      return '↑↓/jk move · enter open · u author · r reply · s save · space pause'
    case 'help':
      return 'q back · / search · m people · , settings'
    default:
      return 'Enter continue · Esc cancel'
  }
}

export function editingShortcuts(screen: Screen) {
  if (screen.kind === 'search') return 'Type a query · Enter searches posts · Esc back'
  if (screen.kind === 'people') return 'Type a name, @username or a word from a profile · Esc back'
  if (screen.kind === 'compose') return 'Enter newline · Ctrl+Enter/Ctrl+S preview · Esc back'
  if (screen.kind === 'login') return 'Enter continue · Esc back'
  if (screen.kind === 'settings') return 'Enter select · Esc back to settings'
  return 'Enter select · Esc back'
}

function screenTitle(screen: Screen) {
  if (screen.kind === 'feed') return screen.feed
  if (screen.kind === 'post') return `post #${screen.id}`
  if (screen.kind === 'profile') return `@${screen.handle}`
  return screen.kind
}

function ScreenView({ screen, shared }: { screen: Screen; shared: Shared }) {
  switch (screen.kind) {
    case 'feed':
      return <FeedScreen key={screen.feed} kind={screen.feed} s={shared} />
    case 'search':
      return <SearchScreen query={screen.query} s={shared} />
    case 'people':
      return <PeopleScreen query={screen.query} s={shared} />
    case 'post':
      return <PostScreen id={screen.id} s={shared} />
    case 'profile':
      return <ProfileScreen handle={screen.handle} s={shared} />
    case 'live':
      return <LiveScreen s={shared} />
    case 'compose':
      return <ComposeScreen parent={screen.parent} edit={screen.edit} s={shared} />
    case 'login':
      return <LoginScreen s={shared} />
    case 'account':
      return <AccountScreen s={shared} />
    case 'settings':
      return <SettingsScreen s={shared} />
    case 'help':
      return <HelpScreen s={shared} />
  }
}

function PostList({ entries, selected, s, empty = 'Nothing here yet.', focusedTarget = -1, depths, metaContexts }: {
  entries: EntryJSON[]; selected: number; s: Shared; empty?: string; focusedTarget?: number; depths?: number[];
  metaContexts?: (string | undefined)[]
}) {
  const screenActive = useScreenActive()
  const viewportRef = useRef<DOMElement | null>(null)
  const [viewport, setViewport] = useState({ width: 80, height: 12, hasMeasured: false })
  useEffect(() => {
    if (!screenActive || !viewportRef.current) return
    const { width, height } = measureElement(viewportRef.current)
    setViewport(current =>
      current.hasMeasured && current.width === width && current.height === height
        ? current
        : { width, height, hasMeasured: true }
    )
  })
  if (!entries.length) {
    return (
      <Box padding={1}>
        <Text color={s.p.muted}>{empty}</Text>
      </Box>
    )
  }
  const availableRows = Math.max(1, viewport.hasMeasured ? viewport.height : 12)
  const replyIndent = 2
  const depth = (index: number) => Math.max(0, depths?.[index] || 0)
  const contentWidth = (index: number) =>
    Math.max(1, (viewport.hasMeasured ? viewport.width : 80) - 4 - depth(index) * replyIndent)
  const wrappedBodyLines = (entry: EntryJSON, width: number) => {
    const literal = isAsciiArtPost(entry)
    const safeBody = terminalSafeText(entry.content)
    const body = literal ? safeBody : tokenizeRichText(safeBody).map(token => token.text).join('')
    return wrapAnsi(body || ' ', Math.max(1, width), { trim: !literal, hard: true }).split('\n')
  }
  const heightOf = (index: number) =>
    Math.min(availableRows,
      wrappedBodyLines(entries[index], contentWidth(index)).length + 3 + (entries[index].parent ? 1 : 0))
  let start = selected
  let used = heightOf(selected)
  while (start > 0) {
    const height = heightOf(start - 1)
    if (used + height > availableRows) break
    used += height
    start--
  }
  let end = selected + 1
  while (end < entries.length) {
    const height = heightOf(end)
    if (used + height > availableRows) break
    used += height
    end++
  }
  const visible = entries.slice(start, end)
  return (
    <Box ref={viewportRef} flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} overflowY="hidden"
      flexDirection="column"
    >
      {visible.map((entry, offset) => {
        const index = start + offset
        const content = (
          <Note height={heightOf(index)} post={entry} parent={entry.parent} selected={index === selected}
            focusedTarget={index === selected ? focusedTarget : -1} p={s.p}
            bodyLines={wrappedBodyLines(entry, contentWidth(index))} metaContext={metaContexts?.[index]} />
        )
        if (depth(index) === 0) return <React.Fragment key={entry.id}>{content}</React.Fragment>
        return (
          <Box key={entry.id} height={heightOf(index)} flexShrink={0} flexDirection="row">
            {Array.from({ length: depth(index) }, (_, level) => (
              <Box key={level} width={replyIndent} height={heightOf(index)} flexShrink={0} borderStyle="single"
                borderTop={false} borderRight={false} borderBottom={false} borderColor={s.p.soft} />
            ))}
            <Box flexGrow={1} flexDirection="column">{content}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

type Target = { kind: 'author' | 'thread' | 'reply' | 'save' | 'link' | 'reference'; text: string; url?: string }

function targetsForEntry(entry?: EntryJSON): Target[] {
  if (!entry) return []
  return [
    { kind: 'author', text: `@${entry.created_by.username}` },
    { kind: 'thread', text: 'thread' },
    { kind: 'reply', text: 'reply' },
    { kind: 'save', text: entry.saved ? 'unsave' : 'save' },
    ...tokenizeRichText(entry.content)
      .filter(token => token.kind === 'link' || token.kind === 'reference')
      .map(token => ({ kind: token.kind as 'link' | 'reference', text: token.text, url: token.url })),
  ]
}

function useEntryNavigation(
  entries: EntryJSON[],
  selected: number,
  setSelected: React.Dispatch<React.SetStateAction<number>>,
  s: Shared,
  nextPage?: () => void,
  reload?: () => void,
  previousPage?: () => void,
  enabled = true,
  onUpFromFirst?: () => void,
  selfHandle?: string,
) {
  const [target, setTarget] = useState(-1)
  const focused = entries[selected]
  const targets = targetsForEntry(focused)
  const openPost = (id: number) => s.push(s.me ? { kind: 'post', id } : { kind: 'login' })
  const openProfile = (handle: string) => {
    if (selfHandle && handle.toLowerCase() === selfHandle.toLowerCase()) return
    s.push(s.me ? { kind: 'profile', handle } : { kind: 'login' })
  }
  const openCompose = (entry: EntryJSON) => s.push(s.me ? { kind: 'compose', parent: entry } : { kind: 'login' })
  const toggleSave = (entry: EntryJSON) => {
    if (!s.me) return s.push({ kind: 'login' })
    void act(async () => {
      const { status } = entry.saved ? await s.api.unsavePost(entry.id) : await s.api.savePost(entry.id)
      ensureStatus(status, entry.saved ? ['save'] : ['unsave'], 'Could not change the saved state')
    }, s, entry.saved ? 'Removed from saved' : 'Saved').then(() => reload?.())
  }
  const activate = () => {
    const item = targets[target]
    if (!focused || !item) return focused && openPost(focused.id)
    if (item.kind === 'author') return openProfile(focused.created_by.username)
    if (item.kind === 'thread') return openPost(focused.id)
    if (item.kind === 'reply') return openCompose(focused)
    if (item.kind === 'save') return toggleSave(focused)
    if (item.kind === 'link' && item.url) return void openBrowser(item.url)
    if (item.text.startsWith('#')) return s.push({ kind: 'search', query: item.text })
    if (item.text.startsWith('@')) return openProfile(item.text.slice(1))
  }
  useScreenInput((input, key) => {
    if (!enabled) return
    if (key.downArrow || input === 'j') setSelected(current => clampSelection(current + 1, entries.length))
    if (key.upArrow || input === 'k') {
      selected === 0 && onUpFromFirst
        ? onUpFromFirst()
        : setSelected(current => clampSelection(current - 1, entries.length))
    }
    if (input === 'g') setSelected(0)
    if (input === 'G') setSelected(Math.max(0, entries.length - 1))
    if (key.return || key.rightArrow || input === 'l') {
      if (focused) activate()
    }
    if (input === 'u' && focused) openProfile(focused.created_by.username)
    if (input === 'r' && focused) openCompose(focused)
    if (input === 's' && focused) toggleSave(focused)
    if (input === 'o' && focused) void openBrowser(entryUrl(s.config.baseUrl, focused))
    if (input === 'n') nextPage?.()
    if (input === 'p') previousPage?.()
    if (input === 'R') reload?.()
  })
  useScreenInput((_input, key) => {
    if (!enabled || !key.tab || !targets.length) return
    setTarget(current => key.shift ? (current <= 0 ? targets.length - 1 : current - 1) : (current + 1) % targets.length)
  })
  useEffect(() => { setTarget(-1) }, [selected])
  return target
}

function Pagination(
  { page, previous, next, loading, s }: { page: number; previous: boolean; next: boolean; loading: boolean; s: Shared },
) {
  return (
    <Box paddingX={1}>
      <Text color={s.p.muted}>
        {previous ? 'p previous · ' : ''}page {page}
        {loading ? ' · loading…' : next ? ' · n next' : ''}
      </Text>
    </Box>
  )
}

function EntryPager({ load, deps, s, empty }: {
  load: (page: number, signal: AbortSignal) => Promise<Page<EntryJSON>>; deps: unknown[]; s: Shared; empty?: string
}) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(0)
  const remote = useRemote(signal => load(page, signal), [...deps, page])
  const entries = remote.data?.entries || []
  const hasNext = entries.length >= PAGE_SIZE
  const next = () => {
    if (!hasNext || remote.loading) return
    setPage(current => current + 1)
    setSelected(0)
  }
  const previous = () => {
    if (page <= 1 || remote.loading) return
    setPage(current => current - 1)
    setSelected(0)
  }
  const target = useEntryNavigation(entries, selected, setSelected, s, next, remote.reload, previous)
  return (
    <>
      {remote.loading && !entries.length
        ? <Spinner p={s.p} />
        : remote.error
        ? <Message text={remote.error} error p={s.p} />
        : <PostList entries={entries} selected={selected} focusedTarget={target} s={s} empty={empty} />}
      <Pagination page={page} previous={page > 1} next={hasNext} loading={remote.loading} s={s} />
    </>
  )
}

function feedLoader(kind: FeedKind, s: Shared) {
  switch (kind) {
    case 'feed':
      return (page: number, signal: AbortSignal) => s.api.feed(page, signal)
    case 'mentions':
      return (page: number, signal: AbortSignal) => s.api.mentions(page, signal)
    case 'replies':
      return (page: number, signal: AbortSignal) => s.api.replies(page, signal)
    case 'saved':
      return (page: number, signal: AbortSignal) => s.api.saved(page, signal)
    case 'trending':
      return (page: number, signal: AbortSignal) => s.api.trending(page, signal)
    case 'discover':
      return (page: number, signal: AbortSignal) => s.api.discover('', page, signal)
  }
}

function FeedScreen({ kind, s }: { kind: FeedKind; s: Shared }) {
  return <EntryPager load={feedLoader(kind, s)} deps={[s.api, kind]} s={s} empty="Nothing here yet." />
}

function SearchScreen({ query, s }: { query?: string; s: Shared }) {
  const [draft, setDraft] = useState(query || '')
  if (query === undefined) {
    return (
      <Editor label="search posts" value={draft} onChange={setDraft} onCancel={s.back} p={s.p}
        onSubmit={() => draft.trim() ? s.replace({ kind: 'search', query: draft.trim() }) : undefined} />
    )
  }
  return (
    <>
      <Box paddingX={1}>
        <Text color={s.p.muted}>results for “{query}”</Text>
      </Box>
      <EntryPager load={(page, signal) => s.api.discover(query, page, signal)} deps={[s.api, query]} s={s}
        empty="No matching posts." />
    </>
  )
}

function PeopleScreen({ query, s }: { query?: string; s: Shared }) {
  const [draft, setDraft] = useState(query || '')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(0)
  const remote = useRemote(
    signal => query === undefined ? Promise.resolve(undefined) : s.api.people(query, page, signal),
    [s.api, query, page],
  )
  if (query === undefined) {
    return (
      <Editor label="find people" value={draft} onChange={setDraft} onCancel={s.back} p={s.p}
        onSubmit={() => s.replace({ kind: 'people', query: draft.trim() })} />
    )
  }
  const results = remote.data?.entries || []
  const people = results.filter(user => user.username.toLowerCase() !== s.me?.username.toLowerCase())
  const hasMore = results.length >= PAGE_SIZE
  return (
    <>
      <Box paddingX={1}>
        <Text color={s.p.muted}>
          find people · “{query || 'everyone'}” · {people.length} shown · enter opens a profile
        </Text>
      </Box>
      {remote.loading && !results.length
        ? <Spinner p={s.p} />
        : remote.error
        ? <Message text={remote.error} error p={s.p} />
        : (
          <UserList users={people} selected={selected} setSelected={setSelected} s={s} enabled
            onUpFromFirst={() => undefined} />
        )}
      <Pagination page={page} previous={page > 1} next={hasMore} loading={remote.loading} s={s} />
      <PageKeys page={page} setPage={setPage} setSelected={setSelected} hasNext={hasMore}
        loading={remote.loading} reload={remote.reload} />
    </>
  )
}

function PageKeys({ page, setPage, setSelected, hasNext, loading, reload }: {
  page: number; setPage: React.Dispatch<React.SetStateAction<number>>;
  setSelected: React.Dispatch<React.SetStateAction<number>>; hasNext: boolean; loading: boolean; reload(): void
}) {
  useScreenInput((input) => {
    if (input === 'n' && hasNext && !loading) {
      setPage(current => current + 1)
      setSelected(0)
    }
    if (input === 'p' && page > 1 && !loading) {
      setPage(current => current - 1)
      setSelected(0)
    }
    if (input === 'R') reload()
  })
  return null
}

function UserList({ users, selected, setSelected, s, enabled, onUpFromFirst }: {
  users: UserJSON[]; selected: number; setSelected: React.Dispatch<React.SetStateAction<number>>; s: Shared;
  enabled: boolean; onUpFromFirst(): void
}) {
  useScreenInput((input, key) => {
    if (!enabled) return
    if (key.downArrow || input === 'j') setSelected(current => clampSelection(current + 1, users.length))
    if (key.upArrow || input === 'k') {
      selected === 0
        ? onUpFromFirst()
        : setSelected(current => clampSelection(current - 1, users.length))
    }
    if (input === 'g') setSelected(0)
    if (input === 'G') setSelected(Math.max(0, users.length - 1))
    const user = users[selected]
    if (!user) return
    if (key.return || key.rightArrow || input === 'l') s.push(s.me ? { kind: 'profile', handle: user.username } : { kind: 'login' })
    if (input === 'o') void openBrowser(profileUrl(s.config.baseUrl, user.username))
  })
  if (!users.length) {
    return (
      <Box padding={1}>
        <Text color={s.p.muted}>Nobody here yet.</Text>
      </Box>
    )
  }
  const start = Math.max(0, Math.min(selected - 5, users.length - 12))
  return (
    <Box flexDirection="column" paddingX={1} overflowY="hidden">
      {users.slice(start, start + 12).map((user, offset) => {
        const index = start + offset
        return (
          <Text key={user.username} color={index === selected ? s.p.accentDark : s.p.ink} inverse={index === selected}>
            {displayName(user)} <Text color={s.p.muted}>@{user.username}</Text>
            {user.description ? ` · ${terminalSafeText(user.description).replace(/\s+/g, ' ')}` : ''}
          </Text>
        )
      })}
    </Box>
  )
}

function PostScreen({ id, s }: { id: number; s: Shared }) {
  const remote = useRemote(signal => s.api.thread(id, signal), [s.api, id])
  const rows = remote.data ? buildThread(remote.data) : []
  const entries = rows.map(row => row.entry)
  const [selected, setSelected] = useState(0)
  const [menu, setMenu] = useState(false)
  const [menuSelected, setMenuSelected] = useState(0)
  const initialized = useRef(false)
  useEffect(() => {
    if (!remote.data || initialized.current) return
    initialized.current = true
    setSelected(remote.data.ancestors.length)
  }, [remote.data])
  const focused = entries[selected]
  const target = useEntryNavigation(entries, selected, setSelected, s, undefined, remote.reload, undefined, !menu)
  useEffect(() => {
    s.setOverlay(menu)
    return () => s.setOverlay(false)
  }, [menu])
  useScreenInput(input => {
    if (menu) return
    if (input === 'T' && rows.length) s.push({ kind: 'post', id: rows[0].entry.id })
    if (input === 'P' && selected > 0) s.push({ kind: 'post', id: entries[selected - 1].id })
    if (!focused) return
    const own = s.me?.username.toLowerCase() === focused.created_by.username.toLowerCase()
    if (input === 'e' && own) s.push({ kind: 'compose', edit: focused })
    if (input === 'd' && own) setMenu(true)
    if (input === 'f' && s.me) void act(() => followAction(s, focused.created_by.username, true), s, `Following @${focused.created_by.username}`)
    if (input === 'F' && s.me) void act(() => followAction(s, focused.created_by.username, false), s, `Unfollowed @${focused.created_by.username}`)
  })
  if (remote.loading) return <Spinner p={s.p} />
  if (remote.error) return <Message text={remote.error} error p={s.p} />
  if (menu && focused) {
    return (
      <Menu title={`Delete post #${focused.id} by ${displayName(focused.created_by)}?`}
        items={['delete post', 'cancel']} selected={menuSelected}
        onChange={setMenuSelected} onCancel={() => setMenu(false)} p={s.p} onSelect={index => {
        if (index === 0) {
          void act(async () => {
            const { status } = await s.api.deletePost(focused.id)
            ensureStatus(status, ['deleted'], 'Cannot delete: the post has replies')
          }, s, 'Post deleted').then(ok => {
            if (ok) s.back()
          })
        }
        else setMenu(false)
      }} />
    )
  }
  return (
    <>
      <PostList entries={entries} depths={rows.map(row => row.depth)} selected={selected} focusedTarget={target} s={s} />
    </>
  )
}

function ProfileScreen({ handle, s }: { handle: string; s: Shared }) {
  const own = s.me?.username.toLowerCase() === handle.toLowerCase()
  const remote = useRemote(async signal => {
    const [member, following, followers] = await Promise.all([
      s.api.member(handle, 1, signal),
      own ? s.api.following(1, signal) : Promise.resolve(undefined),
      own ? s.api.followers(1, signal) : Promise.resolve(undefined),
    ])
    return { member, following: following?.entries || [], followers: followers?.entries || [] }
  }, [s.api, handle, own])
  const [activeTab, setActiveTab] = useState(0)
  const [focusedTab, setFocusedTab] = useState<number>()
  const [selected, setSelected] = useState(0)
  const tabs = own ? ['posts', 'following', 'followers'] : ['posts']
  const entries = remote.data?.member.entries || []
  const users = activeTab === 1 ? remote.data?.following || [] : activeTab === 2 ? remote.data?.followers || [] : []
  const target = useEntryNavigation(entries, selected, setSelected, s, undefined, remote.reload, undefined,
    focusedTab === undefined && activeTab === 0, () => setFocusedTab(activeTab), handle)
  useScreenInput((input, key) => {
    if (!remote.data) return
    if (focusedTab !== undefined) {
      if (key.upArrow || input === 'k') setFocusedTab(current => Math.max(0, (current ?? 0) - 1))
      if (key.downArrow || input === 'j') {
        setFocusedTab(current => current === tabs.length - 1 ? undefined : (current ?? 0) + 1)
      }
      if (key.return) {
        setActiveTab(focusedTab)
        setSelected(0)
        setFocusedTab(undefined)
      }
      return
    }
    if (input === 'f' && s.me && !own) void act(() => followAction(s, handle, true), s, `Following @${handle}`)
    if (input === 'F' && s.me && !own) void act(() => followAction(s, handle, false), s, `Unfollowed @${handle}`)
    if (input === 'o') void openBrowser(profileUrl(s.config.baseUrl, handle))
  })
  if (remote.loading) return <Spinner p={s.p} />
  if (remote.error || !remote.data) return <Message text={remote.error || 'Member not found'} error p={s.p} />
  return (
    <>
      <ProfileHeader profile={remote.data.member.member} tabs={tabs} p={s.p} activeTab={activeTab}
        focusedTab={focusedTab} />
      {activeTab === 0
        ? (
          <PostList entries={entries} selected={selected} focusedTarget={target} s={s} />
        )
        : (
          <UserList users={users} selected={selected} setSelected={setSelected} s={s}
            enabled={focusedTab === undefined} onUpFromFirst={() => setFocusedTab(activeTab)} />
        )}
    </>
  )
}

function LiveScreen({ s }: { s: Shared }) {
  const [entries, setEntries] = useState<EntryJSON[]>([])
  const [state, setState] = useState('polling')
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState(0)
  useEffect(() => {
    if (paused) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const page = await s.api.discover('', 1)
        if (cancelled) return
        setEntries(current => unique([...page.entries, ...current]).slice(0, 100))
        setState('live · refreshing every 15s')
      }
      catch {
        if (!cancelled) setState('disconnected · retrying')
      }
      if (!cancelled) timer = setTimeout(poll, 15000)
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [s.api, paused])
  const target = useEntryNavigation(entries, selected, setSelected, s)
  useScreenInput(input => {
    if (input === ' ') {
      setPaused(current => !current)
      setState(paused ? 'polling' : 'paused')
    }
  })
  return (
    <>
      <Box paddingX={1}>
        <Text color={state.startsWith('live') ? s.p.success : s.p.muted}>● {state} · Space pause/resume</Text>
      </Box>
      <PostList entries={entries} selected={selected} focusedTarget={target} s={s}
        empty="Waiting for the next public post…" />
    </>
  )
}

function ComposeScreen({ parent, edit, s }: { parent?: EntryJSON; edit?: EntryJSON; s: Shared }) {
  const [body, setBody] = useState(edit?.content || '')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState(0)
  const submit = async () => {
    const problem = validatePost(body)
    if (problem) return s.status(problem, true)
    if (preview) {
      setBusy(true)
      try {
        const result = edit
          ? await s.api.editPost(edit.id, body)
          : parent
          ? await s.api.createReply(parent.id, body)
          : await s.api.createThread(body)
        s.status(edit ? 'Post updated' : 'Posted')
        s.back()
        if (!edit) s.push({ kind: 'post', id: result.id })
      }
      catch (error) {
        s.status(errorMessage(error), true)
      }
      finally {
        setBusy(false)
      }
    }
    else setPreview(true)
  }
  if (busy) return <Spinner label="publishing" p={s.p} />
  if (preview) {
    const draft: EntryJSON = {
      id: edit?.id ?? 0,
      content: body,
      created_by: edit?.created_by ?? parent?.created_by ?? s.me!,
      saved: false,
      timestamp: 'now',
      reply_count: edit?.reply_count ?? 0,
      parent: parent ?? edit?.parent ?? null,
    }
    return (
      <Box flexDirection="column">
        <Box padding={1}>
          <Text bold>
            {edit
              ? 'edit preview'
              : parent
              ? `replying to ${displayName(parent.created_by)}`
              : `What's on your mind, ${s.me ? displayName(s.me) : ''}?`}
          </Text>
        </Box>
        <Note post={draft} p={s.p} selected />
        <Menu title="Publish this post?" items={['publish', 'keep editing', 'cancel']} selected={choice}
          onChange={setChoice} onCancel={() => setPreview(false)} p={s.p} onSelect={index =>
          index === 0 ? void submit() : index === 1 ? setPreview(false) : s.back()} />
      </Box>
    )
  }
  return (
    <Editor
      label={edit
        ? 'edit post'
        : parent
        ? `reply to ${displayName(parent.created_by)}`
        : `What's on your mind, ${s.me ? displayName(s.me) : ''}?`}
      value={body}
      onChange={setBody}
      onCancel={s.back}
      onSubmit={submit}
      p={s.p}
      multiline
      maxLength={640}
    />
  )
}

function LoginScreen({ s }: { s: Shared }) {
  const [phase, setPhase] = useState<'username' | 'password'>('username')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const verify = async () => {
    setBusy(true)
    try {
      const session = await s.api.login(username.trim().toLowerCase(), password)
      s.api.token = session.token
      await s.setConfig({ ...s.config, token: session.token, user: session.user })
      s.status(`Signed in as @${session.user.username}`)
      s.back()
    }
    catch (error) {
      s.status(errorMessage(error), true)
    }
    finally {
      setBusy(false)
    }
  }
  if (busy) return <Spinner label="signing in" p={s.p} />
  return phase === 'username'
    ? (
      <Editor label="username" value={username} onChange={setUsername} onCancel={s.back} p={s.p} onSubmit={() =>
        username.trim() ? setPhase('password') : s.status('Enter your username', true)} />
    )
    : (
      <Editor label={`password for @${username.trim().toLowerCase()}`} value={password} onChange={setPassword}
        onCancel={() => setPhase('username')} onSubmit={() => password ? void verify() : s.status('Enter your password', true)}
        p={s.p} secret />
    )
}

function AccountScreen({ s }: { s: Shared }) {
  type Phase = 'menu' | 'first_name' | 'emoji' | 'link' | 'description'
  const [phase, setPhase] = useState<Phase>('menu')
  const [value, setValue] = useState('')
  const [selected, setSelected] = useState(0)
  const me = s.me
  if (!me) {
    return (
      <Box padding={1} flexDirection="column">
        <Text color={s.p.muted}>You are not signed in.</Text>
        <Text color={s.p.accent}>Press q, then a to sign in.</Text>
      </Box>
    )
  }
  const save = async (patch: Record<string, string>, message: string) => {
    try {
      const fields = {
        username: me.username,
        first_name: me.first_name,
        emoji: me.emoji,
        link: me.link,
        description: me.description,
        ...patch,
      }
      const { user } = await s.api.updateProfile(fields)
      await s.setConfig({ ...s.config, user })
      setPhase('menu')
      s.status(message)
    }
    catch (error) {
      s.status(errorMessage(error), true)
    }
  }
  if (phase !== 'menu') {
    const labels: Record<Phase, string> = {
      menu: '', first_name: 'display name', emoji: 'emoji shortcode', link: 'link', description: 'description (bio)',
    }
    return (
      <Editor label={labels[phase]} value={value} onChange={setValue} multiline={phase === 'description'}
        maxLength={phase === 'description' ? 640 : undefined} onCancel={() => setPhase('menu')} p={s.p}
        onSubmit={() => save(phase === 'link' ? { link: value.trim().toLowerCase() } : { [phase]: value },
          'Profile updated')} />
    )
  }
  const items = ['edit display name', 'edit emoji', 'edit link', 'edit description', 'open web profile', 'sign out',
    'settings']
  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={s.p.accentDark}>
        {displayName(me)} <Text color={s.p.muted}>@{me.username}</Text>
      </Text>
      <Text>{me.description || 'No description yet.'}</Text>
      <Text color={s.p.muted}>{me.link || 'no link'}</Text>
      <Menu title="account" items={items} selected={selected} onChange={setSelected} onCancel={s.back} p={s.p}
        onSelect={index => {
        if (index < 4) {
          const phases: Phase[] = ['first_name', 'emoji', 'link', 'description']
          const current = [me.first_name, me.emoji, me.link, me.description][index]
          setValue(current)
          setPhase(phases[index])
        }
        else if (index === 4) void openBrowser(profileUrl(s.config.baseUrl, me.username))
        else if (index === 5) void signOut(s)
        else s.push({ kind: 'settings' })
      }} />
    </Box>
  )
}

async function signOut(s: Shared) {
  await s.setConfig({ ...s.config, token: undefined, user: undefined })
  s.api.token = undefined
  s.status('Signed out')
  s.back()
}

function SettingsScreen({ s }: { s: Shared }) {
  const [url, setUrl] = useState(s.config.baseUrl)
  const [phase, setPhase] = useState<'menu' | 'url' | 'theme'>('menu')
  const [selected, setSelected] = useState(0)
  const [themeSelected, setThemeSelected] = useState(Math.max(0, THEMES.findIndex(theme => theme.id === s.config.theme)))
  if (phase === 'theme') {
    return (
      <Menu title="theme" items={THEMES.map(theme =>
        `${theme.id === s.config.theme ? '✓' : ' '} ${theme.name} · ${theme.hint}`)}
        selected={themeSelected} onChange={setThemeSelected} onCancel={() => setPhase('menu')} p={s.p}
        onSelect={index => {
          const theme = THEMES[index]
          setPhase('menu')
          void s.setConfig({ ...s.config, theme: theme.id }).then(() => s.status(`Theme: ${theme.name}`))
        }} />
    )
  }
  if (phase === 'url') {
    return (
      <Editor label="Sofeed instance URL" value={url} onChange={setUrl} onCancel={() => setPhase('menu')}
        onSubmit={async () => {
          try {
            const next = new URL(url)
            if (!['http:', 'https:'].includes(next.protocol)) throw new Error()
            await s.setConfig({ ...s.config, baseUrl: url.replace(/\/+$/, '') })
            s.status('Instance updated')
            s.back()
          }
          catch {
            s.status('Enter a valid HTTP(S) URL', true)
          }
        }} p={s.p} />
    )
  }
  return (
    <Menu title={`settings · ${s.config.baseUrl}`}
      items={[`theme: ${s.config.theme}`, 'change instance URL', 'open web app', 'back']} selected={selected}
      onChange={setSelected} onCancel={s.back} p={s.p} onSelect={async index => {
      if (index === 0) setPhase('theme')
      if (index === 1) setPhase('url')
      if (index === 2) void openBrowser(s.config.baseUrl)
      if (index === 3) s.back()
    }} />
  )
}

function HelpScreen({ s }: { s: Shared }) {
  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color={s.p.accentDark}>sofeed · tiny, but mighty</Text>
      <Text>
        {s.config.token
          ? '0 profile  1 feed  2 mentions  3 replies  4 saved  5 trending  6 discover'
          : '1 trending  2 discover'}
        {'  '}
        / search  m people  w write  L live  a account
      </Text>
      <Text color={s.p.muted}>
        0 opens your own profile; m (or M) searches members by name, username or description.
      </Text>
      <Text color={s.p.muted}>L live polls the public feed every 15s and prepends new posts; Space pauses it.</Text>
      <Text>↑↓ j/k move  Enter/l open  h/q back  g/G first/last  p/n page  R refresh  , settings</Text>
      <Text color={s.p.muted}>
        , settings offers the site's schemes: {THEMES.map(theme => theme.id).join(', ')}.
      </Text>
      <Text>In a post: Tab/Shift+Tab cycles the author, thread, save, links and #hashtags; Enter opens the target.</Text>
      <Text>u author  r reply  s save  f/F follow  e edit  d delete  o browser</Text>
      <Text color={s.p.muted}>
        Sign-in is by username and password. Creating an account, messages and account recovery live on the web app.
      </Text>
      <Text color={s.p.accent}>API: {s.config.baseUrl}/api</Text>
    </Box>
  )
}

async function followAction(s: Shared, username: string, following: boolean) {
  const { status } = following ? await s.api.follow(username) : await s.api.unfollow(username)
  ensureStatus(status, following ? ['unfollow'] : ['follow'], 'Could not change who you follow')
}

async function act(action: () => Promise<unknown>, s: Shared, success: string) {
  try {
    await action()
    s.status(success)
    return true
  }
  catch (error) {
    s.status(errorMessage(error), true)
    return false
  }
}

function unique(entries: EntryJSON[]) {
  return [...new Map(entries.map(entry => [entry.id, entry])).values()]
}
