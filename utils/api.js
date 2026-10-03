/**
 * 新闻 API 工具模块（v4 — Bing 搜索版）
 *
 * 2026-10 实测结论：
 *   ✅ Bing 新闻 RSS  — 任意关键词精准搜索（主力）
 *      https://www.bing.com/news/search?q=关键词&format=RSS
 *   ✅ 人民网/中新网/界面新闻 RSS — 频道最新新闻（兜底）
 *   ❌ 百度新闻抓取  — 返回"百度安全验证"反爬页
 *   ❌ 搜狗/360/头条 — 结果 JS 渲染，HTML 无法解析
 *   ❌ Google News   — 国内不可达
 *
 * 搜索策略：
 *   1. 云函数（Bing + RSS + AI 兜底）
 *   2. 本地直连（云函数不可用时）
 */

const TIMEOUT = 20000

// DeepSeek API Key（本地调试用，生产环境请配云函数环境变量）
let LOCAL_DEEPSEEK_KEY = ''

// ============================================================
// 新闻源注册表
// ============================================================

const BING_SOURCE = {
  key: 'bing',
  name: 'Bing搜索',
  label: 'Bing搜索',
  icon: '🔎',
  desc: '任意关键词精准搜索',
  enabled: true
}

// 频道 RSS（实测可用的 https 源）
const RSS_FEEDS = [
  {
    key: 'people',
    name: '人民网',
    icon: '🏛',
    url: 'https://www.people.com.cn/rss/politics.xml',
    desc: '时政要闻'
  },
  {
    key: 'chinanews',
    name: '中国新闻网',
    icon: '📰',
    url: 'https://www.chinanews.com.cn/rss/scroll-news.xml',
    desc: '即时新闻'
  },
  {
    key: 'chinanews_fin',
    name: '中新网财经',
    icon: '💰',
    url: 'https://www.chinanews.com.cn/rss/finance.xml',
    desc: '财经新闻'
  },
  {
    key: 'jiemian',
    name: '界面新闻',
    icon: '📈',
    url: 'https://a.jiemian.com/index.php?m=article&a=rss',
    desc: '商业财经'
  }
]

// ============================================================
// 云函数搜索
// ============================================================

export async function fetchViaCloud(keyword) {
  return new Promise((resolve, reject) => {
    try {
      uniCloud.callFunction({
        name: 'news-api',
        data: { action: 'search', keyword, pageSize: 50 },
        success: (res) => {
          if (res.result && res.result.code === 0 && res.result.data) {
            const articles = (res.result.data.articles || []).map(a => ({
              title: a.title,
              link: a.link,
              pubDate: a.pubDate,
              source: a.source,
              description: a.description,
              isAI: a.isAI || false,
              sourceKey: 'cloud',
              sourceName: a.sourceName || a.source || '搜索结果'
            }))
            resolve({
              articles,
              sources: ['cloud'],
              source: res.result.data.source || '云函数搜索'
            })
          } else {
            reject(new Error((res.result && res.result.message) || '云函数返回异常'))
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
// 本地直连多源聚合（云函数不可用时的降级路径）
// ============================================================

export async function fetchAllSources(keyword, sourceKeys = null) {
  const useAll = !sourceKeys || sourceKeys.length === 0
  const all = []
  const usedSources = []

  const tasks = []

  // Bing 搜索（任意关键词）
  if (useAll || sourceKeys.includes('bing')) {
    tasks.push(
      fetchBingRSS(keyword)
        .then(articles => ({ key: 'bing', name: 'Bing搜索', articles }))
        .catch(() => ({ key: 'bing', name: 'Bing搜索', articles: [] }))
    )
  }

  // 频道 RSS
  RSS_FEEDS
    .filter(f => useAll || sourceKeys.includes(f.key))
    .forEach(feed => {
      tasks.push(
        fetchFeed(feed, keyword)
          .then(articles => ({ key: feed.key, name: feed.name, articles }))
          .catch(() => ({ key: feed.key, name: feed.name, articles: [] }))
      )
    })

  const results = await Promise.allSettled(tasks)

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.articles.length > 0) {
      r.value.articles.forEach(a => {
        a.sourceKey = r.value.key
        if (!a.sourceName) a.sourceName = r.value.name
      })
      all.push(...r.value.articles)
      usedSources.push(r.value.key)
    }
  }

  // 链接去重
  const seen = new Set()
  const unique = all.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })

  return { articles: unique, sources: usedSources }
}

// ============================================================
// Bing 新闻 RSS（主力搜索源）
// ============================================================

function fetchBingRSS(keyword) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&format=RSS&mkt=zh-CN`

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      timeout: TIMEOUT,
      dataType: 'text',
      header: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data) {
          resolve(parseBingRSS(res.data, keyword))
        } else {
          reject(new Error(`Bing HTTP ${res.statusCode}`))
        }
      },
      fail: reject
    })
  })
}

/**
 * 解析 Bing 新闻 RSS
 * link 形如 ...apiclick.aspx?...&url=<真实URL编码>...
 */
function parseBingRSS(xml, keyword) {
  const items = []
  const itemRe = /<item>([\s\S]*?)<\/item>/gi
  let m

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]
    const title = extractTag(block, 'title')
    const rawLink = extractTag(block, 'link')
    const description = extractTag(block, 'description')
    const pubDate = extractTag(block, 'pubDate')
    const source = extractTag(block, 'News:Source')

    if (!title || !rawLink) continue

    // 提取真实 URL
    let link = rawLink
    const urlMatch = rawLink.match(/[?&]url=([^&]+)/)
    if (urlMatch) {
      try { link = decodeURIComponent(urlMatch[1]) } catch (e) { link = rawLink }
    }

    items.push({
      title: cleanHTML(title),
      link: cleanHTML(link),
      pubDate,
      source: cleanHTML(source) || domainOf(link),
      description: cleanHTML(description).substring(0, 200),
      keyword,
      sourceName: 'Bing新闻'
    })
  }

  return items
}

// ============================================================
// 频道 RSS
// ============================================================

function fetchFeed(feed, keyword) {
  return new Promise((resolve) => {
    uni.request({
      url: feed.url,
      timeout: TIMEOUT,
      dataType: 'text',
      success: (res) => {
        if (res.statusCode !== 200 || !res.data) return resolve([])
        const kw = (keyword || '').toLowerCase()
        const items = parseRSSItems(res.data, keyword)
        resolve(
          items.filter(a =>
            (a.title || '').toLowerCase().includes(kw) ||
            (a.description || '').toLowerCase().includes(kw)
          ).slice(0, 30)
        )
      },
      fail: () => resolve([])
    })
  })
}

function parseRSSItems(xml, keyword) {
  const items = []
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi
  let m

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    const pubDate = extractTag(block, 'pubDate')
    const source = extractTag(block, 'source') || extractTag(block, 'author')
    const description = extractTag(block, 'description')

    if (title && link) {
      items.push({
        title: cleanHTML(title),
        link: cleanHTML(link),
        pubDate,
        source: cleanHTML(source) || '',
        description: cleanHTML(description).substring(0, 200),
        keyword
      })
    }
  }
  return items
}

// ============================================================
// 工具函数
// ============================================================

function extractTag(block, tag) {
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<${esc}[^>]*><!\\[CDATA\\[(.*?)\\]\\]></${esc}>`, 'i'),
    new RegExp(`<${esc}[^>]*>(.*?)</${esc}>`, 'i')
  ]
  for (const p of patterns) {
    const m = p.exec(block)
    if (m) return m[1].trim()
  }
  return ''
}

function cleanHTML(str) {
  if (!str) return ''
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function domainOf(url) {
  try {
    const m = url.match(/https?:\/\/([^\/]+)/)
    return m ? m[1].replace('www.', '') : ''
  } catch (e) {
    return ''
  }
}

// ============================================================
// 对外接口
// ============================================================

export function getSources() {
  const map = {}
  map[BING_SOURCE.key] = {
    name: BING_SOURCE.name,
    label: BING_SOURCE.label,
    icon: BING_SOURCE.icon,
    desc: BING_SOURCE.desc,
    enabled: true
  }
  RSS_FEEDS.forEach(f => {
    map[f.key] = {
      name: f.name,
      label: f.name,
      icon: f.icon,
      desc: f.desc,
      enabled: true
    }
  })
  return map
}

export function getEnabledSources() {
  return [BING_SOURCE.key, ...RSS_FEEDS.map(f => f.key)]
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

export function setDeepSeekKey(key) {
  LOCAL_DEEPSEEK_KEY = key
}

export default {
  fetchViaCloud,
  fetchAllSources,
  getSources,
  getEnabledSources,
  formatPubTime,
  cleanTitle,
  setDeepSeekKey
}
