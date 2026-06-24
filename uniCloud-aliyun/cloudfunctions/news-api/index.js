/**
 * 新闻查询云函数 - news-api
 *
 * 搜索策略（按优先级）：
 *   1. 天行数据 API  — 精准关键词搜索（需配置 API key）
 *   2. 中国 RSS 聚合 — 人民网/新浪/36氪，关键词过滤
 *   3. 数据库缓存    — 历史抓取结果
 */

'use strict'

const db = uniCloud.database()

exports.main = async (event, context) => {
  const { action, keyword, page = 1, pageSize = 20 } = event

  switch (action) {
    case 'search':
      return await searchNews(keyword, page, pageSize)
    case 'getCached':
      return await getCachedNews(keyword, page, pageSize)
    case 'addKeyword':
      return await addKeyword(keyword)
    case 'removeKeyword':
      return await removeKeyword(keyword)
    case 'getKeywords':
      return await getKeywords()
    default:
      return { code: 400, message: '未知操作: ' + action }
  }
}

// ============================================================
// 实时搜索：天行数据 → RSS 聚合
// ============================================================

async function searchNews(keyword, page, pageSize) {
  if (!keyword) return { code: 400, message: '关键词不能为空' }

  let articles = []
  let source = ''

  // 1. 天行数据（精准搜索，100次/天免费）
  const tianKey = process.env.TIANAPI_KEY || ''
  if (tianKey) {
    try {
      const res = await uniCloud.httpclient.request(
        `https://apis.tianapi.com/allnews/index?key=${tianKey}&keyword=${encodeURIComponent(keyword)}&num=40`,
        { method: 'GET', timeout: 15000, dataType: 'json' }
      )
      if (res.statusCode === 200 && res.data?.code === 200) {
        articles = (res.data.result?.newslist || []).map(a => ({
          title: a.title || '',
          link: a.url || '',
          pubDate: a.ctime || '',
          source: a.source || '',
          description: a.description || '',
          keyword
        }))
        source = '天行数据'
        console.log(`[天行] "${keyword}" → ${articles.length} 条`)
      }
    } catch (e) {
      console.warn('[天行] 失败:', e.message)
    }
  }

  // 2. RSS 聚合补充
  if (articles.length < 10) {
    try {
      const rssArticles = await fetchRSSFeeds(keyword)
      const existing = new Set(articles.map(a => a.link))
      const merged = rssArticles.filter(a => !existing.has(a.link))
      articles = [...articles, ...merged]
      source = source ? source + ' + RSS' : 'RSS聚合'
      console.log(`[RSS] "${keyword}" → 补充 ${merged.length} 条`)
    } catch (e) {
      console.warn('[RSS] 失败:', e.message)
    }
  }

  // 去重排序
  const seen = new Set()
  const unique = articles.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })
  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))

  // 分页
  const start = (page - 1) * pageSize
  const paged = unique.slice(start, start + pageSize)

  return {
    code: 0,
    data: {
      articles: paged,
      total: unique.length,
      page, pageSize,
      source,
      hasMore: start + pageSize < unique.length
    }
  }
}

// ============================================================
// RSS 聚合（国内可用源）
// ============================================================

const RSS_FEEDS = [
  { name: '人民网', url: 'http://www.people.com.cn/rss/politics.xml' },
  { name: '新浪新闻', url: 'https://rss.sina.com.cn/news/marquee/ddt.xml' },
  { name: '36氪', url: 'https://36kr.com/feed' }
]

async function fetchRSSFeeds(keyword) {
  const all = []

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async feed => {
      try {
        const res = await uniCloud.httpclient.request(feed.url, {
          method: 'GET',
          timeout: 15000,
          dataType: 'text',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsApp/1.0)' }
        })
        if (res.statusCode === 200 && res.data) {
          const items = parseRSS(res.data, keyword)
          return items.filter(a =>
            (a.title || '').toLowerCase().includes(keyword.toLowerCase()) ||
            (a.description || '').toLowerCase().includes(keyword.toLowerCase())
          ).map(a => ({ ...a, sourceName: feed.name }))
        }
      } catch (e) { /* skip */ }
      return []
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
}

// ============================================================
// 缓存查询
// ============================================================

async function getCachedNews(keyword, page, pageSize) {
  const collection = db.collection('news_articles')
  let query = collection
  if (keyword) query = query.where({ keyword })

  const res = await query
    .orderBy('fetchedAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  const countRes = await (keyword
    ? collection.where({ keyword }).count()
    : collection.count()
  )

  return {
    code: 0,
    data: {
      articles: res.data,
      total: countRes.total,
      page, pageSize,
      hasMore: (page * pageSize) < countRes.total
    }
  }
}

// ============================================================
// 关键词管理
// ============================================================

async function addKeyword(keyword) {
  if (!keyword) return { code: 400, message: '关键词不能为空' }
  const existRes = await db.collection('user_keywords')
    .where({ keyword, active: true }).count()
  if (existRes.total > 0) return { code: 0, message: '已存在' }

  await db.collection('user_keywords').add({
    keyword, active: true,
    createdAt: new Date().toISOString()
  })
  return { code: 0, message: '添加成功' }
}

async function removeKeyword(keyword) {
  await db.collection('user_keywords')
    .where({ keyword }).update({ active: false })
  return { code: 0, message: '已移除' }
}

async function getKeywords() {
  const res = await db.collection('user_keywords')
    .where({ active: true }).orderBy('createdAt', 'desc').get()
  return { code: 0, data: res.data }
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
        title: cleanHTML(title), link: cleanHTML(link),
        pubDate: pubDate || new Date().toISOString(),
        source: cleanHTML(source) || '',
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
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim()
}
