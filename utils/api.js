/**
 * 新闻 API 工具模块（中国可用版 v2）
 *
 * 搜索策略：
 *   1. 云函数搜索（支持天行数据精准搜索 + RSS聚合）
 *   2. 本地RSS直连（云函数不可用时兜底）
 *
 * 实测可用源：
 *   ✅ 人民网 RSS     — politics.xml (100条)
 *   ✅ 新浪新闻 RSS   — ddt.xml
 *   ✅ 36氪 RSS       — /feed
 *   ✅ 天行数据API    — 精准关键词搜索（需配key, 100次/天免费）
 */

const FEEDS = [
  {
    key: 'people',
    name: '人民网',
    icon: '🏛',
    url: 'http://www.people.com.cn/rss/politics.xml',
    desc: '时政要闻'
  },
  {
    key: 'people_finance',
    name: '人民网财经',
    icon: '💰',
    url: 'http://finance.people.com.cn/rss/finance.xml',
    desc: '财经频道'
  },
  {
    key: 'sina',
    name: '新浪新闻',
    icon: '📢',
    url: 'https://rss.sina.com.cn/news/marquee/ddt.xml',
    desc: '新闻要闻'
  },
  {
    key: 'sina_finance',
    name: '新浪财经',
    icon: '📈',
    url: 'https://rss.sina.com.cn/finance/stock/usstk.xml',
    desc: '财经资讯'
  },
  {
    key: '36kr',
    name: '36氪',
    icon: '🚀',
    url: 'https://36kr.com/feed',
    desc: '科技商业'
  },
  {
    key: 'google',
    name: 'Google News',
    icon: '🌐',
    url: null,  // 动态拼接
    desc: '境外可用',
    enabled: false  // 国内默认关
  }
]

const TIMEOUT = 15000

// ============================================================
// 云函数搜索（精准关键词 + RSS 聚合）
// ============================================================

/**
 * 通过云函数搜索（支持天行数据精准搜索）
 * 需先在 uniCloud 控制台配置环境变量 TIANAPI_KEY
 */
export async function fetchViaCloud(keyword) {
  return new Promise((resolve, reject) => {
    try {
      uniCloud.callFunction({
        name: 'news-api',
        data: { action: 'search', keyword, pageSize: 50 },
        success: (res) => {
          if (res.result?.code === 0 && res.result.data) {
            const articles = res.result.data.articles.map(a => ({
              title: a.title,
              link: a.link,
              pubDate: a.pubDate,
              source: a.source,
              description: a.description,
              sourceKey: 'cloud',
              sourceName: a.sourceName || a.source || '搜索结果'
            }))
            resolve({
              articles,
              sources: ['cloud'],
              source: res.result.data.source || '云函数搜索'
            })
          } else {
            reject(new Error(res.result?.message || '云函数返回异常'))
          }
        },
        fail: reject
      })
    } catch (e) {
      reject(e)
    }
  })
}

// ============================================================
// 主入口：多源聚合
// ============================================================

/**
 * @param {string} keyword      搜索关键词
 * @param {string[]} sourceKeys 指定源 key 列表
 */
export async function fetchAllSources(keyword, sourceKeys = null) {
  const active = FEEDS.filter(f => {
    if (sourceKeys && sourceKeys.length > 0) {
      return sourceKeys.includes(f.key)
    }
    return f.enabled !== false
  })

  const all = []
  const usedSources = []

  const results = await Promise.allSettled(
    active.map(async (feed) => {
      const articles = await fetchFeed(feed, keyword)
      if (articles.length > 0) {
        articles.forEach(a => {
          a.sourceKey = feed.key
          a.sourceName = feed.name
        })
        return { key: feed.key, name: feed.name, articles }
      }
      return { key: feed.key, name: feed.name, articles: [] }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.articles.length > 0) {
      all.push(...r.value.articles)
      usedSources.push(r.value.key)
    }
  }

  // 链接去重 + 时间排序
  const seen = new Set()
  const unique = all.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })
  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))

  return { articles: unique, sources: usedSources }
}

// ============================================================
// 抓取单个源
// ============================================================

async function fetchFeed(feed, keyword) {
  let url = feed.url

  // Google News 特殊处理
  if (feed.key === 'google') {
    url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
  }

  if (!url) return []

  return new Promise((resolve) => {
    uni.request({
      url,
      timeout: TIMEOUT,
      dataType: 'text',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const allArticles = parseRSS(res.data, keyword)
          // 按关键词过滤（标题或摘要包含关键词）
          if (keyword && feed.key !== 'google') {
            const kw = keyword.toLowerCase()
            const filtered = allArticles.filter(a =>
              (a.title || '').toLowerCase().includes(kw) ||
              (a.description || '').toLowerCase().includes(kw)
            )
            resolve(filtered.slice(0, 30))
          } else {
            resolve(allArticles.slice(0, 30))
          }
        } else {
          resolve([])
        }
      },
      fail: () => resolve([])
    })
  })
}

// ============================================================
// RSS 解析
// ============================================================

function parseRSS(xmlStr, keyword) {
  const items = []
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let match

  while ((match = itemRegex.exec(xmlStr)) !== null) {
    const block = match[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const pubDate = extractTag(block, 'pubDate')
    const source = extractTag(block, 'source') || extractTag(block, 'author')
    const description = extractTag(block, 'description')

    if (title && link) {
      items.push({
        title: cleanHTML(title),
        link: cleanHTML(link),
        pubDate: pubDate || new Date().toISOString(),
        source: cleanHTML(source) || extractSourceFromTitle(title),
        description: cleanHTML(description || '').substring(0, 200),
        keyword
      })
    }
  }
  return items
}

function extractTag(block, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'i')
  ]
  for (const p of patterns) {
    const m = p.exec(block)
    if (m) return m[1].trim()
  }
  return ''
}

function cleanHTML(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function extractSourceFromTitle(title) {
  const match = title.match(/\s*[-—|]\s*([^\-—|]+)$/)
  return match ? match[1].trim() : ''
}

// ============================================================
// 对外接口
// ============================================================

export function getSources() {
  const map = {}
  FEEDS.forEach(f => {
    map[f.key] = {
      name: f.name,
      label: f.name,
      icon: f.icon,
      desc: f.desc,
      enabled: f.enabled !== false
    }
  })
  return map
}

export function getEnabledSources() {
  return FEEDS.filter(f => f.enabled !== false).map(f => f.key)
}

export function formatPubTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function cleanTitle(title) {
  if (!title) return ''
  return title.replace(/\s*[-—|]\s*[^\-—|]+$/, '').trim()
}

export default { fetchAllSources, getSources, getEnabledSources, formatPubTime, cleanTitle }
