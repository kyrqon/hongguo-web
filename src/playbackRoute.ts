export type PlaybackSource = 'hongguo' | 'demo'
export type PlaybackRoute = { source: PlaybackSource; dramaId: string; episodeId: string }

export function readPlaybackRoute(href: string): PlaybackRoute {
  const params = new URL(href).searchParams
  const source = params.get('source') === 'demo' ? 'demo' : 'hongguo'
  const drama = params.get('drama') || ''
  const episode = params.get('episode') || ''
  const validDrama = source === 'demo' ? /^demo-\d+$/.test(drama) : /^\d{1,30}$/.test(drama)
  const validEpisode = source === 'demo' ? episode.startsWith(`${drama}-ep-`) && /^demo-\d+-ep-\d+$/.test(episode) : /^\d{1,30}$/.test(episode)
  return { source, dramaId: validDrama ? drama : '', episodeId: validDrama && validEpisode ? episode : '' }
}

export function playbackUrl(href: string, route: PlaybackRoute): URL {
  const url = new URL(href)
  for (const key of ['drama', 'episode', 'source']) url.searchParams.delete(key)
  if (route.source === 'demo') url.searchParams.set('source', 'demo')
  if (route.dramaId) url.searchParams.set('drama', route.dramaId)
  if (route.dramaId && route.episodeId) url.searchParams.set('episode', route.episodeId)
  return url
}
