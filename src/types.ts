export type ThemeName = 'auto' | 'mono' | 'paper' | 'sepia' | 'rose' | 'midnight' | 'forest' | 'plum'

export type UserJSON = {
  username: string
  full_name: string
  first_name: string
  last_name: string
  created_at: number
  emoji: string
  link: string
  description: string
  social: Record<string, string>
}

export type EntryJSON = {
  id: number
  content: string
  created_by: UserJSON
  saved: boolean
  timestamp: string
  reply_count: number
  parent?: EntryJSON | null
  kids?: EntryJSON[]
}

export type ChatJSON = {
  id: number
  content: string
  created_by: UserJSON
  to_user: UserJSON
  timestamp: string
}

export type Notifications = {
  followers: number
  mentions: number
  replies: number
  messages: number
}

export type Page<T> = { page: number; entries: T[] }
export type MemberPage = Page<EntryJSON> & { member: UserJSON }
export type ThreadPage = { entry: EntryJSON; ancestors: EntryJSON[]; kids: EntryJSON[] }

export type ActionStatus = 'save' | 'unsave' | 'follow' | 'unfollow' | 'deleted' | 'unsent' | 'not found' | 'not valid'

export type FeedKind = 'feed' | 'mentions' | 'replies' | 'saved' | 'trending' | 'discover'

export type Screen =
  | { kind: 'feed'; feed: FeedKind }
  | { kind: 'search'; query?: string }
  | { kind: 'people'; query?: string }
  | { kind: 'post'; id: number }
  | { kind: 'profile'; handle: string }
  | { kind: 'live' }
  | { kind: 'compose'; parent?: EntryJSON; edit?: EntryJSON }
  | { kind: 'login' }
  | { kind: 'account' }
  | { kind: 'settings' }
  | { kind: 'help' }

export type AppState = { stack: Screen[]; status?: { text: string; error?: boolean } }
export type AppAction =
  | { type: 'push'; screen: Screen }
  | { type: 'replace'; screen: Screen }
  | { type: 'back' }
  | { type: 'status'; text?: string; error?: boolean }
