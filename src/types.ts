export interface Drama {
  id: string
  title: string
  description: string
  cover: string
  episodeCount: number
  tags: string[]
  playCount: number
  source: 'hongguo' | 'demo'
  payType?: number
  contentType?: number
}
export interface Episode { id: string; index: number; title: string; duration?: number; playable?: boolean }
export interface PlaybackQuality { id: string; label: string; definition?: string; width?: number; height?: number }
export interface PlaybackResult { url: string; duration?: number; converted?: boolean; timeOffset?: number; qualities?: PlaybackQuality[]; selectedQuality?: string }
export interface Page { items: Drama[]; cursor?: string; hasMore: boolean; catalogMode?: string }
export interface HistoryItem { drama: Drama; episodeId: string; episodeIndex: number; position: number; updatedAt: string }
export interface User { id: string; username: string }
export type Section = 'recommend' | 'discover' | 'favorites' | 'history'
