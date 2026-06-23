/**
 * 新闻 API 工具模块（多源聚合版）
 *
 * 新闻源优先级：
 *   1. Google News RSS   — 主力聚合源（已收录东方财富/腾讯/新浪/网易/人民网等）
 *   2. 东方财富 RSS       — 财经新闻专线
 *   3. 网易新闻 RSS       — 综合新闻
 *   4. 新浪新闻 RSS       — 综合新闻
 *   5. 人民网 RSS         — 官方时政
 *   6. GNews API         — 备用国际源
 */

// ============================================================
// 新闻源注册表
// ============================================================

const NEWS_SOURCES = {
  google: {
    name: 'Google News',
    label: '综合聚合',
    icon: '🌐',
    desc: '聚合全球100+中文媒体',
    enabled: true
  },
  eastmoney: {
    name: '东方财富',
    label: '财经专线',
    icon: '📈',
    desc: '7×24小时财经快讯',
    enabled: true,
    feeds: [
      {
        url: 'https://rss.eastmoney.com/',
        type: 'rss',
        // 东方财富 RSS 需要通过搜索接口
        searchUrl: 'https://search.eastmoney.com/api/News/Search',
        method: 'POST'
      }
    ]
  },
  netease: {
    name: '网易新闻',
    label: '网易新闻',
    icon: '📰',
    desc: '网易新闻综合频道',
    enabled: true,
    feeds: [
      {
        url: 'https://www.163.com/rss/',
        type: 'rss'
      }
    ]
  },
  sina: {
    name: '新浪新闻',
    label: '新浪新闻',
    icon: '📢',
    desc: '新浪新闻中心',
    enabled: true,
    feeds: [
      {
        url: 'https://rss.sina.com.cn/news/',
        type: 'rss'
      }
    ]
  },
  people: {
    name: '人民网',
    label: '人民网',
    icon: '🏛',
    desc: '人民网时政新闻',
    enabled: true,
    feeds: [
      {
        url: 'http://www.people.com.cn/rss/politics.xml',
        type: 'rss'
      }
    ]
  },
  gnews: {
    name: 'GNews',
    label: '国际备用',
    icon: '🌍',
    desc: 'GNews API 备用',
    enabled: false  // 默认不启用，需配置 API key
  }
}

// GNews API key
let GNEWS_API_KEY = ''

// 请求超时
const TIMEOUT = 15000

// ============================================================
// 主入口
// ============================================================

/**
 * 从所有启用的源聚合新闻
 * @param {string} keyword      搜索关键词
 * @param {string[]} sources    指定源列表，空则全部启用源
 * @returns {Promise<{articles: Array, sources: string[]}>}
 */
export async function fetchAllSources(keyword, sources = []) {
  const enabled = sources.length > 0
    ? sources.filter(s => NEWS_SOURCES[s]?.enabled)
    : Object.keys(NEWS_SOURCES).filter(k => NEWS_SOURCES[k].enabled)

  const allArticles = []
  const usedSources = []

  // 并发请求所有源
  const promises = enabled.map(async (sourceKey) => {
    try {
      const articles = await fetchSingleSource(sourceKey, keyword)
      if (articles && articles.length > 0) {
        // 标记来源
        articles.forEach(a => {
          a.sourceKey = sourceKey
          a.sourceName = NEWS_SOURCES[sourceKey]?.name || sourceKey
        })
        allArticles.push(...articles)
        usedSources.push(sourceKey)
      }
    } catch (e) {
      console.warn(`[${sourceKey}] 获取失败:`, e.message)
    }
  })

  await Promise.allSettled(promises)

  // 按链接去重 + 按时间排序
  const deduped = dedupByLink(allArticles)
  deduped.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))

  return {
    articles: deduped,
    sources: usedSources
  }
}

/**
 * 从单个源获取新闻
 */
async function fetchSingleSource(sourceKey, keyword) {
  switch (sourceKey) {
    case 'google':
      return await fetchGoogleRSS(keyword)
    case 'eastmoney':
      return await fetchEastMoney(keyword)
    case 'netease':
      return await fetchNeteaseRSS(keyword)
    case 'sina':
      return await fetchSinaRSS(keyword)
    case 'people':
      return await fetchPeopleRSS(keyword)
    case 'gnews':
      return await fetchGNews(keyword)
    default:
      throw new Error(`未知源: ${sourceKey}`)
  }
}

// ============================================================
// Google News RSS
// ============================================================

function fetchGoogleRSS(keyword) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: 'https://news.google.com/rss/search',
      data: {
        q: keyword,
        hl: 'zh-CN',
        gl: 'CN',
        ceid: 'CN:zh-Hans'
      },
      timeout: TIMEOUT,
      dataType: 'text',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(parseRSS(res.data, keyword))
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}

// ============================================================
// 东方财富 RSS (财经专线)
// ============================================================

function fetchEastMoney(keyword) {
  // 东方财富有两种接入方式：
  // 1. RSS: https://rss.eastmoney.com/（全站）
  // 2. 搜索API: https://search.eastmoney.com/api/News/Search

  // 先用 RSS 获取最新财经快讯，再在客户端过滤
  return new Promise((resolve, reject) => {
    uni.request({
      url: 'https://rss.eastmoney.com/',
      timeout: TIMEOUT,
      dataType: 'text',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const allArticles = parseRSS(res.data, keyword)
          // 用关键词过滤（标题或内容包含关键词）
          const filtered = allArticles.filter(a =>
            a.title.includes(keyword) ||
            (a.description || '').includes(keyword)
          )
          resolve(filtered.length > 0 ? filtered.slice(0, 30) : allArticles.slice(0, 30))
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}

// ============================================================
// 网易新闻 RSS
// ============================================================

function fetchNeteaseRSS(keyword) {
  // 网易 RSS 已停止维护，改用 Google News 限定源的方式
  // 在 Google News 中限定 site:163.com
  return fetchGoogleNewsWithSite(keyword, '163.com')
}

// ============================================================
// 新浪新闻 RSS
// ============================================================

function fetchSinaRSS(keyword) {
  // 新浪 RSS 同样使用 Google News site 限定
  return fetchGoogleNewsWithSite(keyword, 'sina.com.cn')
}

// ============================================================
// 人民网 RSS
// ============================================================

function fetchPeopleRSS(keyword) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: 'http://www.people.com.cn/rss/politics.xml',
      timeout: TIMEOUT,
      dataType: 'text',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          const allArticles = parseRSS(res.data, keyword)
          const filtered = allArticles.filter(a =>
            a.title.includes(keyword) || (a.description || '').includes(keyword)
          )
          resolve(filtered.slice(0, 20))
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}

// ============================================================
// Google News 限定站点搜索
// ============================================================

function fetchGoogleNewsWithSite(keyword, site) {
  const query = `${keyword} site:${site}`
  return new Promise((resolve, reject) => {
    uni.request({
      url: 'https://news.google.com/rss/search',
      data: {
        q: query,
        hl: 'zh-CN',
        gl: 'CN',
        ceid: 'CN:zh-Hans'
      },
      timeout: TIMEOUT,
      dataType: 'text',
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(parseRSS(res.data, keyword))
        } else {
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}

// ============================================================
// GNews API (备用)
// ============================================================

function fetchGNews(keyword) {
  if (!GNEWS_API_KEY) return Promise.reject(new Error('GNews API key 未配置'))

  return new Promise((resolve, reject) => {
    uni.request({
      url: 'https://gnews.io/api/v4/search',
      data: {
        q: keyword,
        lang: 'zh',
        country: 'cn',
        max: 50,
        token: GNEWS_API_KEY
      },
      timeout: TIMEOUT,
      success: (res) => {
        if (res.statusCode === 200 && res.data?.articles) {
          resolve(res.data.articles.map(a => ({
            title: a.title?.trim() || '',
            link: a.url || '',
            pubDate: a.publishedAt || '',
            source: a.source?.name || '',
            description: a.description || '',
            keyword
          })))
        } else {
          reject(new Error(`GNews HTTP ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}

// ============================================================
// RSS 解析（通用）
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
    const source = extractTag(block, 'source')
    const description = extractTag(block, 'description')

    if (title && link) {
      items.push({
        title,
        link,
        pubDate: pubDate || new Date().toISOString(),
        source: source || extractSourceFromTitle(title),
        description: description || '',
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
    if (m) return decodeHTML(m[1].trim())
  }
  return ''
}

function decodeHTML(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function extractSourceFromTitle(title) {
  const match = title.match(/\s*-\s*([^-]+)$/)
  return match ? match[1].trim() : ''
}

// ============================================================
// 去重 & 工具
// ============================================================

function dedupByLink(articles) {
  const seen = new Set()
  return articles.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })
}

export function setGNewsKey(key) {
  GNEWS_API_KEY = key
  if (key) NEWS_SOURCES.gnews.enabled = true
}

export function getSources() {
  return NEWS_SOURCES
}

export function getEnabledSources() {
  return Object.keys(NEWS_SOURCES).filter(k => NEWS_SOURCES[k].enabled)
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
  return title.replace(/\s*-\s*[^-]+$/, '').trim()
}

export default {
  fetchAllSources,
  setGNewsKey,
  getSources,
  getEnabledSources,
  formatPubTime,
  cleanTitle
}
