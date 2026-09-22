import type { ActionStatus, ChatJSON, EntryJSON, MemberPage, Notifications, Page, ThreadPage, UserJSON } from './types'

export const PAGE_SIZE = 16
export const USER_PAGE_SIZE = 24

export class ApiError extends Error {
  constructor(public status: number, message: string, public errors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
  }

  get firstError(): string {
    return Object.values(this.errors)[0] ?? this.message
  }
}

type Query = Record<string, string | number | undefined>

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  form?: Record<string, string>
  query?: Query
  signal?: AbortSignal
}

export class SofeedApi {
  constructor(public baseUrl: string, public token?: string, private fetcher: typeof fetch = fetch) {}

  url(path: string, query?: Query) {
    const url = new URL(path, this.baseUrl)
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', form, query, signal } = options
    const headers = new Headers({ accept: 'application/json' })
    if (this.token) headers.set('authorization', `Bearer ${this.token}`)
    let body: string | undefined
    if (form) {
      headers.set('content-type', 'application/x-www-form-urlencoded')
      body = new URLSearchParams(form).toString()
    }
    let response: Response
    try {
      response = await this.fetcher(this.url(path, query), { method, headers, body, signal, redirect: 'follow' })
    }
    catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error
      throw new ApiError(0, `Can't reach ${this.baseUrl}. Check the connection and the instance URL.`)
    }
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      }
      catch {
        throw new ApiError(response.status, `Unexpected response from ${path}`)
      }
    }
    const payload = (parsed ?? {}) as Record<string, unknown>
    const errors = payload.errors as Record<string, string> | undefined
    if (errors && Object.keys(errors).length) throw new ApiError(response.status, 'Validation failed', errors)
    if (!response.ok) {
      const title = typeof payload.title === 'string' ? payload.title : `HTTP ${response.status}`
      const description = typeof payload.description === 'string' ? `: ${payload.description}` : ''
      throw new ApiError(response.status, `${title}${description}`)
    }
    return payload as T
  }

  login(username: string, password: string) {
    return this.request<{ token: string; user: UserJSON }>('/api/login', {
      method: 'POST',
      form: { username, password },
    })
  }

  updateProfile(fields: Record<string, string>) {
    return this.request<{ user: UserJSON }>('/api/profile', { method: 'PATCH', form: fields })
  }

  createThread(content: string) {
    return this.request<EntryJSON>('/api/thread', { method: 'POST', form: { content } })
  }
  createReply(id: number, content: string) {
    return this.request<EntryJSON>(`/api/reply/${id}`, { method: 'POST', form: { content } })
  }
  editPost(id: number, content: string) {
    return this.request<EntryJSON>(`/api/edit/${id}`, { method: 'PATCH', form: { content } })
  }
  deletePost(id: number) {
    return this.request<{ status: ActionStatus }>(`/api/delete/${id}`, { method: 'POST' })
  }
  savePost(id: number) {
    return this.request<{ status: ActionStatus }>(`/api/save/${id}`, { method: 'POST' })
  }
  unsavePost(id: number) {
    return this.request<{ status: ActionStatus }>(`/api/unsave/${id}`, { method: 'POST' })
  }

  follow(username: string) {
    return this.request<{ status: ActionStatus }>(`/api/follow/${encodeURIComponent(username)}`, { method: 'POST' })
  }
  unfollow(username: string) {
    return this.request<{ status: ActionStatus }>(`/api/unfollow/${encodeURIComponent(username)}`, { method: 'POST' })
  }

  feed(page = 1, signal?: AbortSignal) {
    return this.request<Page<EntryJSON>>('/api/feed', { query: { p: page }, signal })
  }
  saved(page = 1, signal?: AbortSignal) {
    return this.request<Page<EntryJSON>>('/api/saved', { query: { p: page }, signal })
  }
  mentions(page = 1, signal?: AbortSignal) {
    return this.request<Page<EntryJSON>>('/api/mentions', { query: { p: page }, signal })
  }
  replies(page = 1, signal?: AbortSignal) {
    return this.request<Page<EntryJSON>>('/api/replies', { query: { p: page }, signal })
  }
  following(page = 1, signal?: AbortSignal) {
    return this.request<Page<UserJSON>>('/api/following', { query: { p: page }, signal })
  }
  followers(page = 1, signal?: AbortSignal) {
    return this.request<Page<UserJSON>>('/api/followers', { query: { p: page }, signal })
  }
  discover(q: string, page = 1, signal?: AbortSignal) {
    return this.request<Page<EntryJSON>>('/api/discover', { query: { q, p: page }, signal })
  }
  trending(page = 1, signal?: AbortSignal) {
    return this.request<Page<EntryJSON>>('/api/trending', { query: { p: page }, signal })
  }
  people(q: string, page = 1, signal?: AbortSignal) {
    return this.request<Page<UserJSON>>('/api/people', { query: { q, p: page }, signal })
  }
  member(username: string, page = 1, signal?: AbortSignal) {
    return this.request<MemberPage>(`/api/${encodeURIComponent(username)}`, { query: { p: page }, signal })
  }
  thread(id: number, signal?: AbortSignal) {
    return this.request<ThreadPage>(`/api/reply/${id}`, { signal })
  }
  notifications(signal?: AbortSignal) {
    return this.request<Notifications>('/api/notifications', { signal })
  }

  messages(page = 1, signal?: AbortSignal) {
    return this.request<Page<ChatJSON>>('/api/messages', { query: { p: page }, signal })
  }
  conversation(username: string, page = 1, signal?: AbortSignal) {
    return this.request<Page<ChatJSON>>(`/api/${encodeURIComponent(username)}/message`, {
      query: { p: page },
      signal,
    })
  }
  sendMessage(username: string, content: string) {
    return this.request<ChatJSON>(`/api/${encodeURIComponent(username)}/send`, {
      method: 'POST',
      form: { content },
    })
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.firstError
  return error instanceof Error ? error.message : 'Something went wrong'
}
