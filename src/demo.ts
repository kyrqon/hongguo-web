import type { Drama, Episode } from './types'

export const demos: Drama[] = [
  { id: 'demo-1', title: '晚风与你皆心动', description: '一场意外重逢，让错过七年的两个人再次相遇。这一次，他决定不再放手。', cover: '/images/hero.jpg', episodeCount: 64, tags: ['都市爱情', '久别重逢', '甜宠'], playCount: 12860000, source: 'demo' },
  { id: 'demo-2', title: '他从夜色中走来', description: '当平静的生活被一封匿名信打破，所有的相遇都有了另一种答案。', cover: '/images/suspense.jpg', episodeCount: 80, tags: ['悬疑', '都市', '逆袭'], playCount: 9600000, source: 'demo' },
  { id: 'demo-3', title: '偏偏喜欢你', description: '从欢喜冤家到彼此心动，原来最好的爱情一直在身边。', cover: '/images/love.jpg', episodeCount: 72, tags: ['甜宠', '都市爱情'], playCount: 8200000, source: 'demo' },
  { id: 'demo-4', title: '长安十二时辰后', description: '一纸旧约，一次归来。她在长安灯火中，找到了自己的归途。', cover: '/images/costume.jpg', episodeCount: 60, tags: ['古装', '大女主'], playCount: 7100000, source: 'demo' },
  { id: 'demo-5', title: '逆光而来的你', description: '离开熟悉的小城，她用自己的勇气，在繁华都市里写下新的故事。', cover: '/images/city.jpg', episodeCount: 88, tags: ['逆袭', '都市', '大女主'], playCount: 6500000, source: 'demo' },
  { id: 'demo-6', title: '小日子有光', description: '三餐四季，烟火人间。平凡的一家人，也有不平凡的温暖。', cover: '/images/family.jpg', episodeCount: 56, tags: ['家庭', '治愈'], playCount: 5800000, source: 'demo' },
]
export function demoEpisodes(drama: Drama): Episode[] {
  return Array.from({ length: drama.episodeCount }, (_, index) => ({ id: `${drama.id}-ep-${index + 1}`, index: index + 1, title: `第 ${index + 1} 集` }))
}
// Generated locally with FFmpeg; no third-party film or drama footage.
// See scripts/generate-demo.mjs for the reproducible source.
export const demoVideo = '/videos/demo.mp4'
