import { Box, Text, useStdout } from 'ink'
import React, { useEffect, useState } from 'react'
import { useScreenInput } from './input'
import type { Palette } from './theme'
import type { EntryJSON, UserJSON } from './types'
import { codePointLength, displayName, relativeTime } from './utils'

export function Header(
  { active, handle, authenticated = false, p }: { active: string; handle?: string; authenticated?: boolean;
    p: Palette },
) {
  const tab = (label: string, feed: string, key: string) => (
    <Text key={feed} bold color={active === feed ? p.accentDark : p.muted}>{key} {label}</Text>
  )
  return (
    <Box flexShrink={0} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false}
      borderColor={p.soft} paddingX={1} justifyContent="space-between"
    >
      <Box gap={2}>
        <Text bold color={p.accent}>&gt;_ sofeed</Text>
        <Box gap={2}>
          {authenticated
            ? [
              tab('feed', 'feed', '1'),
              tab('mentions', 'mentions', '2'),
              tab('replies', 'replies', '3'),
              tab('saved', 'saved', '4'),
              tab('trending', 'trending', '5'),
              tab('discover', 'discover', '6'),
            ]
            : [tab('trending', 'trending', '1'), tab('discover', 'discover', '2')]}
        </Box>
        {!['feed', 'mentions', 'replies', 'saved', 'trending', 'discover', 'live'].includes(active)
          && <Text color={p.muted}>{active}</Text>}
      </Box>
      <Text bold={!!handle} color={handle && active === `@${handle}` ? p.accentDark : p.muted}>
        {handle ? `0 @${handle}` : 'guest'}
      </Text>
    </Box>
  )
}

export function Footer({ p, lines }: { p: Palette; lines: string[] }) {
  return (
    <Box flexShrink={0} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false}
      borderColor={p.soft} paddingX={1} flexDirection="column"
    >
      {lines.map((line, index) => (
        <Text key={index} color={p.muted} wrap="truncate">{line}</Text>
      ))}
    </Box>
  )
}

export type RichToken = { kind: 'text' | 'code' | 'link' | 'reference'; text: string; url?: string }

// Some terminals render emoji skin-tone modifiers as a second wide glyph
// instead of composing them with the preceding emoji. Keep post data intact,
// but omit those modifiers from terminal output so borders remain aligned.
export function terminalSafeText(value: string) {
  const tabWidth = 4
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
    .split('\n')
    .map(line => {
      let column = 0
      let rendered = ''
      for (const character of line) {
        if (character === '\t') {
          const spaces = tabWidth - (column % tabWidth)
          rendered += ' '.repeat(spaces)
          column += spaces
        }
        else {
          rendered += character
          column++
        }
      }
      return rendered
    })
    .join('\n')
}

export function isAsciiArtPost(post: Pick<EntryJSON, 'content'>) {
  return /(?:^|\s)#(?:ascii|ascii_art)\b/i.test(post.content)
}

export function tokenizeRichText(body: string): RichToken[] {
  const tokens: RichToken[] = []
  // Keep inline code ahead of link parsing so examples such as `example.com` remain code.
  const pattern =
    /(`[^`\n]+`|\[(?:\\[^\n]|[^\]\\\n])+\]\((?:https?:\/\/)?[^\s)]+\)|https?:\/\/[^\s]+|(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z]{2,})(?:\/[^\s]*)?|[#@][A-Za-z0-9_]+)/gi
  let offset = 0
  for (const match of body.matchAll(pattern)) {
    const index = match.index
    if (index > offset) tokens.push({ kind: 'text', text: body.slice(offset, index) })
    const value = match[0]
    if (value.startsWith('`')) tokens.push({ kind: 'code', text: value })
    else if (value.startsWith('[')) {
      const parsed = /^\[((?:\\[^\n]|[^\]\\\n])+)\]\(([^)]+)\)$/.exec(value)!
      const label = parsed[1].replace(/\\([\\[\]])/g, '$1')
      tokens.push({ kind: 'link', text: label,
        url: /^https?:\/\//i.test(parsed[2]) ? parsed[2] : `https://${parsed[2]}` })
    }
    else if (/^[#@]/.test(value)) tokens.push({ kind: 'reference', text: value })
    else tokens.push({ kind: 'link', text: value, url: /^https?:\/\//i.test(value) ? value : `https://${value}` })
    offset = index + value.length
  }
  if (offset < body.length) tokens.push({ kind: 'text', text: body.slice(offset) })
  return tokens
}

export function RichText(
  { body, p, muted = false, focusedTarget = -1, color, literal = false, singleLine = false }: { body: string;
    p: Palette; muted?: boolean; focusedTarget?: number; color?: string; literal?: boolean; singleLine?: boolean },
) {
  let targetIndex = -1
  const safeBody = terminalSafeText(body)
  if (literal) return (
    <Text color={color || (muted ? p.muted : p.ink)} wrap={singleLine ? 'truncate' : 'wrap'}>{safeBody}</Text>
  )
  return (
    <Text color={color || (muted ? p.muted : p.ink)} wrap={singleLine ? 'truncate' : 'wrap'}>
      {tokenizeRichText(safeBody).map((token, index) => {
        const interactive = token.kind === 'link' || token.kind === 'reference'
        if (interactive) targetIndex++
        const focused = interactive && targetIndex === focusedTarget
        if (token.kind === 'link') {return (
            <Text key={index} color={muted ? p.muted : p.accent} underline inverse={focused}>{token.text}</Text>
          )}
        if (token.kind === 'reference') {return (
            <Text key={index} color={muted ? p.muted : p.accent} bold inverse={focused}>{token.text}</Text>
          )}
        if (token.kind === 'code') return <Text key={index} color={p.muted}>{token.text}</Text>
        return <React.Fragment key={index}>{token.text}</React.Fragment>
      })}
    </Text>
  )
}

export function ProfileHeader(
  { profile, p, tabs, activeTab = 0, focusedTab }: { profile: UserJSON; p: Palette; tabs?: string[]; activeTab?: number;
    focusedTab?: number },
) {
  const description = profile.description.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="single" borderTop={false} borderLeft={false}
      borderRight={false} borderColor={p.soft}
    >
      <Box>
        <Text bold color={p.accentDark}>{displayName(profile)}</Text>
        <Text color={p.muted}> @{profile.username}</Text>
      </Box>
      {profile.link && <Text color={p.accent} underline wrap="truncate">{profile.link}</Text>}
      <Box marginTop={description ? 1 : 0}>
        {description ? <RichText body={description} p={p} muted /> : <Text color={p.muted} italic>No description yet.</Text>}
      </Box>
      <Text color={p.muted}>joined {relativeTime(profile.created_at)}</Text>
      <Box marginTop={1} gap={2} flexWrap="wrap">
        {(tabs || []).map((tab, index) => (
          <Text key={tab} bold color={activeTab === index ? p.accentDark : p.muted} inverse={focusedTab === index}>
            {tab}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

export function Note({
  post,
  parent,
  selected,
  p,
  context,
  focusedTarget = -1,
  height,
  attachBottom = false,
  bordered = true,
  muted = false,
  bodyColor,
  bodyLines,
  metaContext,
  hideBody = false,
}: { post: EntryJSON; parent?: EntryJSON | null; selected?: boolean; p: Palette; context?: string;
  focusedTarget?: number; height?: number; attachBottom?: boolean; bordered?: boolean; muted?: boolean;
  bodyColor?: string; bodyLines?: string[]; metaContext?: string; hideBody?: boolean })
{
  const replies = `${post.reply_count} ${post.reply_count === 1 ? 'reply' : 'replies'}`
  return (
    <Box height={height} overflowY="hidden" flexDirection="column" flexShrink={0} paddingX={bordered ? 1 : 0}
      borderStyle={bordered ? 'single' : undefined} borderBottom={bordered && !attachBottom}
      borderColor={selected ? p.accent : p.bg}
    >
      <Box>
        <Text color={p.accentDark} inverse={focusedTarget === 0} wrap="truncate-end">
          {displayName(post.created_by)}
        </Text>
        <Text color={p.muted} wrap="truncate-end"> @{post.created_by.username}</Text>
        {metaContext && <Text color={p.muted}> {metaContext}:</Text>}
        <Text>  </Text>
        <Text color={p.accentDark} inverse={focusedTarget === 1} wrap="truncate-end">
          {post.timestamp} · {replies}
        </Text>
        <Text>  </Text>
        <Text color={p.accentDark} inverse={focusedTarget === 2}>reply</Text>
        <Text>  </Text>
        <Text color={post.saved ? p.success : p.accentDark} inverse={focusedTarget === 3}>
          {post.saved ? 'saved' : 'save'}
        </Text>
      </Box>
      {!hideBody && (bodyLines
        ? bodyLines.map((line, index) => (
          <RichText key={index} body={line || ' '} p={p} muted={muted} color={bodyColor} singleLine
            focusedTarget={focusedTarget >= 4 ? focusedTarget - 4 : -1} literal={isAsciiArtPost(post)} />
        ))
        : <RichText body={post.content} p={p} muted={muted} color={bodyColor}
          focusedTarget={focusedTarget >= 4 ? focusedTarget - 4 : -1} literal={isAsciiArtPost(post)} />)}
      {parent && (
        <Text color={p.muted} wrap="truncate">
          ↳ {displayName(parent.created_by)}: {terminalSafeText(parent.content).replace(/\s+/g, ' ')}
        </Text>
      )}
      {context && <Text color={p.muted} wrap="truncate">{context}</Text>}
    </Box>
  )
}

export function PartialNote(
  { post, p, height, bodyLines, edge, metaContext }: { post: EntryJSON; p: Palette; height: number; bodyLines: string[];
    edge: 'top' | 'bottom'; metaContext?: string },
) {
  if (height <= 1) {
    return (
      <Box height={1} flexShrink={0} borderStyle="round" borderTop={edge === 'top' ? false : undefined}
        borderBottom={edge === 'bottom' ? false : undefined} borderColor={p.bg} />
    )
  }
  if (edge === 'bottom') {
    if (height === 2) {
      return (
        <Box height={2} flexShrink={0} paddingX={1} flexDirection="column" borderStyle="round" borderBottom={false}
          borderColor={p.bg}
        >
          <PartialNoteMeta post={post} p={p} metaContext={metaContext} />
        </Box>
      )
    }
    const bodyCapacity = Math.max(0, height - 2)
    return (
      <Box height={height} flexShrink={0} overflowY="hidden" flexDirection="column" paddingX={1} borderStyle="round"
        borderBottom={false} borderColor={p.bg}
      >
        <PartialNoteMeta post={post} p={p} metaContext={metaContext} />
        {bodyLines.slice(0, bodyCapacity).map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
      </Box>
    )
  }
  const contentRows = height - 1 // borderBottom is the only vertical border
  const tail = bodyLines.slice(-contentRows)
  return (
    <Box height={height} flexShrink={0} overflowY="hidden" flexDirection="column" paddingX={1} borderStyle="round"
      borderTop={false} borderColor={p.bg}
    >
      {tail.map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
    </Box>
  )
}

function PartialNoteMeta({ post, p, metaContext }: { post: EntryJSON; p: Palette; metaContext?: string }) {
  const replies = `${post.reply_count} ${post.reply_count === 1 ? 'reply' : 'replies'}`
  return (
    <Text wrap="truncate">
      <Text color={p.accentDark}>{displayName(post.created_by)}</Text>
      {metaContext && <Text color={p.muted}> {metaContext}:</Text>}
      <Text>  </Text>
      <Text color={p.accentDark}>{post.timestamp} · {replies}</Text>
    </Text>
  )
}

export function Spinner({ label = 'loading', p }: { label?: string; p: Palette }) {
  const frames = ['·  ', '·· ', '···']
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setFrame(x => (x + 1) % frames.length), 250)
    return () => clearInterval(timer)
  }, [])
  return (
    <Box padding={1}>
      <Text color={p.muted}>{label}{frames[frame]}</Text>
    </Box>
  )
}

export function Message({ text, error, p }: { text: string; error?: boolean; p: Palette }) {
  return (
    <Box paddingX={1}>
      <Text color={error ? p.danger : p.success}>{text}</Text>
    </Box>
  )
}

export function Editor(
  { value, onChange, onSubmit, onCancel, p, multiline = false, secret = false, label, maxLength }: {
    value: string
    onChange(value: string): void
    onSubmit(): void
    onCancel(): void
    p: Palette
    multiline?: boolean
    secret?: boolean
    label: string
    maxLength?: number
  },
) {
  useScreenInput((input, key) => {
    if (key.escape) return onCancel()
    if (multiline && key.ctrl && input === 's') return onSubmit()
    if (key.return) {
      if (multiline && !key.ctrl) onChange(value + '\n')
      else onSubmit()
      return
    }
    if (key.backspace || key.delete) return onChange(Array.from(value).slice(0, -1).join(''))
    if (input && !key.ctrl && !key.meta && (!maxLength || codePointLength(value + input) <= maxLength)) {
      onChange(value + input)
    }
  })
  const rendered = secret ? '•'.repeat(codePointLength(value)) : value
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={p.accentDark}>{label}</Text>
      <Box borderStyle="round" borderColor={p.accent} paddingX={1} minHeight={multiline ? 5 : 1}>
        <Text>
          {rendered}
          <Text inverse> </Text>
        </Text>
      </Box>
      <Text color={p.muted}>
        {multiline ? 'Enter newline · Ctrl+Enter/Ctrl+S submit · Esc cancel' : 'Enter continue · Esc cancel'}
        {maxLength ? ` · ${codePointLength(value)}/${maxLength}` : ''}
      </Text>
    </Box>
  )
}

export function Menu({ title, items, selected, onChange, onSelect, onCancel, p }: {
  title: string
  items: string[]
  selected: number
  onChange(index: number): void
  onSelect(index: number): void
  onCancel(): void
  p: Palette
}) {
  useScreenInput((input, key) => {
    if (key.upArrow || input === 'k') onChange((selected - 1 + items.length) % items.length)
    if (key.downArrow || input === 'j') onChange((selected + 1) % items.length)
    if (key.return) onSelect(selected)
    if (key.escape || input === 'q') onCancel()
  })
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor={p.soft}>
      <Text bold>{title}</Text>
      {items.map((item, index) => (
        <Text key={item} color={index === selected ? p.accentDark : p.ink}>
          {index === selected ? '› ' : '  '}
          {item}
        </Text>
      ))}
    </Box>
  )
}

export function usePageSize(reserved = 7) {
  const { stdout } = useStdout()
  return Math.max(1, Math.floor(((stdout?.rows || 24) - reserved) / 6))
}

export function clampSelection(current: number, length: number) {
  return Math.max(0, Math.min(current, Math.max(0, length - 1)))
}
