/**
 * 新闻查询云函数 - news-api
 * 供客户端直接调用的新闻查询接口
 * （与 news-fetcher 定时任务配合使用）
 */

'use strict'

const db = uniCloud.database()

exports.main = async (event, context) => {
  const { action, keyword, page = 1, pageSize = 20 } = event

  switch (action) {
    // 实时搜索新闻
    case 'search':
      return await searchNews(keyword, page, pageSize)

    // 从数据库获取已缓存的新闻
    case 'getCached':
      return await getCachedNews(keyword, page, pageSize)

    // 添加/更新关键词追踪
    case 'addKeyword':
      return await addKeyword(keyword)

    // 移除关键词追踪
    case 'removeKeyword':
      return await removeKeyword(keyword)

    // 获取我的关键词列表
    case 'getKeywords':
      return await getKeywords()

    default:
      return { code: 400, message: '未知操作: ' + action }
  }
}

/**
 * 实时搜索：直接调 Google RSS + GNews
 */
async function searchNews(keyword, page, pageSize) {
  if (!keyword) {
    return { code: 400, message: '关键词不能为空' }
  }

  let articles = []

  // Google RSS
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`
    const res = await uniCloud.httpclient.request(url, {
      method: 'GET',
      timeout: 15000,
      dataType: 'text'
    })
    if (res.statusCode === 200) {
      articles = parseRSS(res.data, keyword)
    }
  } catch (e) {
    console.warn('Google RSS failed:', e.message)
  }

  // GNews fallback
  if (articles.length === 0) {
    try {
      const apiKey = process.env.GNEWS_API_KEY || ''
      if (apiKey) {
        const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(keyword)}&lang=zh&country=cn&max=50&token=${apiKey}`
        const res = await uniCloud.httpclient.request(url, {
          method: 'GET',
          timeout: 15000,
          dataType: 'json'
        })
        if (res.statusCode === 200 && res.data?.articles) {
          articles = res.data.articles.map(a => ({
            title: a.title || '',
            link: a.url || '',
            pubDate: a.publishedAt || '',
            source: a.source?.name || '',
            description: a.description || ''
          }))
        }
      }
    } catch (e) {
      console.warn('GNews failed:', e.message)
    }
  }

  // 分页
  const start = (page - 1) * pageSize
  const pagedArticles = articles.slice(start, start + pageSize)

  return {
    code: 0,
    data: {
      articles: pagedArticles,
      total: articles.length,
      page,
      pageSize,
      hasMore: start + pageSize < articles.length
    }
  }
}

/**
 * 获取数据库中缓存的新闻
 */
async function getCachedNews(keyword, page, pageSize) {
  const collection = db.collection('news_articles')
  
  let query = collection
  if (keyword) {
    query = query.where({ keyword })
  }
  
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
      page,
      pageSize,
      hasMore: (page * pageSize) < countRes.total
    }
  }
}

/**
 * 添加关键词（用于定时任务追踪）
 */
async function addKeyword(keyword) {
  if (!keyword) {
    return { code: 400, message: '关键词不能为空' }
  }

  // 先查是否已存在
  const existRes = await db.collection('user_keywords')
    .where({ keyword, active: true })
    .count()

  if (existRes.total > 0) {
    return { code: 0, message: '关键词已存在' }
  }

  await db.collection('user_keywords').add({
    keyword,
    active: true,
    createdAt: new Date().toISOString()
  })

  return { code: 0, message: '添加成功' }
}

/**
 * 移除关键词追踪
 */
async function removeKeyword(keyword) {
  await db.collection('user_keywords')
    .where({ keyword })
    .update({ active: false })

  return { code: 0, message: '已移除' }
}

/**
 * 获取所有活跃关键词
 */
async function getKeywords() {
  const res = await db.collection('user_keywords')
    .where({ active: true })
    .orderBy('createdAt', 'desc')
    .get()

  return {
    code: 0,
    data: res.data
  }
}

// ============ RSS 解析工具 ============

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
      items.push({ title, link, pubDate, source, description, keyword })
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
