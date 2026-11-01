import type { Drama, Episode, HistoryItem, Page, PlaybackResult, User } from './types'
import { getApiBase, isNativeApp } from './apiConfig'

// Native bundles load their assets from a separate origin; API poster URLs stay on the API host.
function resolveAssets(value: unknown, base: string): unknown {
  if (!base || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => resolveAssets(item, base))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'cover' && typeof item === 'string' && item.startsWith('/api/') ? `${base}${item}` : resolveAssets(item, base),
  ]))
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfterMs = 0) { super(message) }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase()
  if (isNativeApp() && !base) throw new ApiError('请先设置 HTTPS 服务地址', 0, 'API_NOT_CONFIGURED')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(`${base}/api${path}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const wait = Number(body.error?.retryAfterMs) || Number(response.headers.get('Retry-After')) * 1000 || 0
      throw new ApiError(body.error?.message || body.message || '请求失败，请稍后重试', response.status, body.error?.code || body.code, Math.max(0, wait))
    }
    return resolveAssets(body, base) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (options.signal?.aborted) throw new ApiError('播放请求已取消', 499, 'REQUEST_ABORTED')
    throw new ApiError(error instanceof Error && error.name === 'AbortError' ? '片源响应超时，请稍后重试' : '暂时无法连接服务器，请检查后端是否已启动', 0)
  } finally { window.clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel) }
}
export const api = {
  me: () => request<{ user: User | null }>('/auth/me'),
  auth: (mode: 'login' | 'register', username: string, password: string) => request<{user: User}>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  feed: (tab: string, cursor = '') => request<Page>(`/feed?tab=${encodeURIComponent(tab)}&cursor=${encodeURIComponent(cursor)}`),
  search: (query: string, cursor = '') => request<Page>(`/search?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`),
  drama: (id: string) => request<{ drama: Drama; episodes: Episode[]; episodesHasMore?: boolean; episodesCursor?: string }>(`/dramas/${encodeURIComponent(id)}`),
  episodes: (id: string, cursor: string) => request<{ items: Episode[]; cursor: string; hasMore: boolean }>(`/dramas/${encodeURIComponent(id)}/episodes?cursor=${encodeURIComponent(cursor)}`),
  play: async (id: string, signal?: AbortSignal, quality?: string, start = 0) => {
    const base = getApiBase()
    const params = new URLSearchParams()
    if (quality) params.set('quality', quality)
    if (start > 0) params.set('start', String(start))
    const result = await request<PlaybackResult>(`/episodes/${encodeURIComponent(id)}/play${params.size ? `?${params}` : ''}`, { signal })
    return { ...result, url: result.url.startsWith('/') && base ? `${base}${result.url}` : result.url }
  },
  favorites: () => request<{ items: Drama[] }>('/favorites'),
  favorite: (drama: Drama) => request('/favorites', { method: 'POST', body: JSON.stringify({ drama }) }),
  unfavorite: (id: string) => request(`/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  history: () => request<{ items: HistoryItem[] }>('/history'),
  saveHistory: (entry: Omit<HistoryItem, 'updatedAt'>) => request('/history', { method: 'POST', body: JSON.stringify(entry) }),
}
