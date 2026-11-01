import { Capacitor } from '@capacitor/core'

const storageKey = 'hongguo.apiBaseUrl'
const buildBase = (import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')

export const isNativeApp = () => Capacitor.isNativePlatform()

export function normalizeApiBase(input: string): string {
  let url: URL
  try { url = new URL(input.trim()) }
  catch { throw new Error('请输入完整的 HTTPS 服务地址') }
  if (url.protocol !== 'https:') throw new Error('服务地址必须使用 HTTPS')
  if (url.username || url.password) throw new Error('地址不能包含用户名或密码')
  if (url.search || url.hash) throw new Error('服务地址不能包含查询参数或 # 片段')
  if (/\/api\/?$/.test(url.pathname)) throw new Error('请填写服务根地址，不要以 /api 结尾')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function getApiBase(): string {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return normalizeApiBase(saved)
  } catch { /* Fall back to the build preset when storage is unavailable or invalid. */ }
  if (!buildBase) return ''
  if (!isNativeApp()) return buildBase
  try { return normalizeApiBase(buildBase) }
  catch { return '' }
}

export function saveApiBase(input: string): void {
  const base = normalizeApiBase(input)
  try { localStorage.setItem(storageKey, base) }
  catch { throw new Error('无法保存服务地址，请允许此 App 使用本地存储') }
}

export function resetApiBase(): void {
  try { localStorage.removeItem(storageKey) }
  catch { throw new Error('无法重置服务地址，请允许此 App 使用本地存储') }
}

export function hasBuildApiBase(): boolean {
  if (!buildBase) return false
  try { normalizeApiBase(buildBase); return true }
  catch { return false }
}
