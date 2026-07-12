import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'
import { NEWS } from '@/lib/news-data'

export default function sitemap(): MetadataRoute.Sitemap {
  const newestNews = NEWS[0]?.date ? new Date(`${NEWS[0].date}T12:00:00Z`) : new Date()

  return [
    {
      url: `${SITE_URL}/`,
      lastModified: newestNews,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${SITE_URL}/features`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/open-source`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/news`,
      lastModified: newestNews,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/contributors`,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
  ]
}
