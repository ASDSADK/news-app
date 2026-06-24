'use strict'

// ============================================================
// 新闻抓取云函数 - news-fetcher
// 定时触发器：每10分钟执行一次
// 主力新闻源：Google News RSS（免费无限）
// 备用新闻源：GNews API（免费版每天100次）
// ============================================================

const db = uniCloud.database()

/**
 * 定时云函数入口
 * 触发配置在 package.json 的 cloudfunction-config.triggers 中
 */
exports.main = async (event, context) => {
  console.log('[news-fetcher] 定时任务触发:', new Date().toISOString())
  
  const results = {
    totalKeywords: 0,
    totalArticles: 0,
    details: [],
    sourceUsed: ''
  }

  try {
    // 1. 从数据库读取所有活跃关键词
    const keywordRes = await db.collection('user_keywords')
      .where({ active: true })
      .get()

    const keywords = keywordRes.data
    results.totalKeywords = keywords.length

    if (keywords.length === 0) {
      console.log('[news-fetcher] 无活跃关键词，跳过')
      return { success: true, message: '无活跃关键词', results }
    }

    // 去重关键词
    const uniqueKeywords = [...new Set(keywords.map(k => k.keyword))]
    console.log(`[news-fetcher] 去重后关键词数: ${uniqueKeywords.length}`)

    // 2. 逐个关键词抓取新闻
    for (const kw of uniqueKeywords) {
      try {
        const articles = await fetchNewsForKeyword(kw)
        results.totalArticles += articles.length
        results.details.push({
          keyword: kw,
          count: articles.length,
          source: results.sourceUsed || 'unknown'
        })

        // 3. 存储新闻到数据库（去重）
        if (articles.length > 0) {
          await saveArticles(kw, articles)
        }

        // 请求间隔，避免被限流
        await sleep(1000)

      } catch (err) {
        console.error(`[news-fetcher] 关键词 "${kw}" 抓取失败:`, err.message)
        results.details.push({
          keyword: kw,
          count: 0,
          error: err.message
        })
      }
    }

    console.log(`[news-fetcher] 完成: ${results.totalArticles} 条新闻`)
    return { success: true, results }

  } catch (err) {
    console.error('[news-fetcher] 任务执行失败:', err)
    return { success: false, error: err.message }
  }
}

/**
 * 抓取单个关键词的新闻
 * 策略（国内可用）：人民网 → 新浪 → 36氪 → Google(境外)
 */
async function fetchNewsForKeyword(keyword) {
  const sources = [
    { name: '人民网', fn: fetchPeopleRSS },
    { name: '人民网财经', fn: fetchPeopleFinance },
    { name: '新浪新闻', fn: fetchSinaNews },
    { name: '36氪', fn: fetch36Kr },
    { name: 'Google News', fn: fetchGoogleRSS }
  ]

  // 并发请求所有源
  const allArticles = []
  const results = await Promise.allSettled(
    sources.map(async (src) => {
      try {
        const articles = await src.fn(keyword)
        if (articles.length > 0) {
          articles.forEach(a => a.sourceKey = src.name)
          return articles
        }
      } catch (e) {
        console.warn(`[fetch] ${src.name} 失败: ${e.message}`)
      }
      return []
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.length > 0) {
      allArticles.push(...r.value)
    }
  }

  // 去重 + 排序
  const seen = new Set()
  const unique = allArticles.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })
  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))

  console.log(`[fetch] 总结果: ${unique.length} 条 (${allArticles.length} 原始)`)
  return unique
}

/**
 * Google News RSS 抓取
 * 免费、无需 API Key、支持中文
 */
async function fetchGoogleRSS(keyword) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`

  const res = await uniCloud.httpclient.request(url, {
    method: 'GET',
    timeout: 15000,
    dataType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NewsApp/1.0)'
    }
  })

  if (res.statusCode !== 200 || !res.data) {
    throw new Error(`HTTP ${res.statusCode}`)
  }

  return parseGoogleRSS(res.data, keyword)
}

/**
 * GNews API 备用抓取
 * 免费版限制：每天100请求，每请求最多10条
 * 需在 uniCloud 环境变量中配置 GNEWS_API_KEY
 */
async function fetchGNews(keyword) {
  const apiKey = process.env.GNEWS_API_KEY || ''
  
  if (!apiKey) {
    throw new Error('GNEWS_API_KEY 未配置')
  }

  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(keyword)}&lang=zh&country=cn&max=50&token=${apiKey}`

  const res = await uniCloud.httpclient.request(url, {
    method: 'GET',
    timeout: 15000,
    dataType: 'json'
  })

  if (res.statusCode !== 200) {
    throw new Error(`GNews HTTP ${res.statusCode}`)
  }

  const data = res.data
  if (!data.articles || !Array.isArray(data.articles)) {
    return []
  }

  return data.articles.map(a => ({
    title: (a.title || '').trim(),
    link: a.url || '',
    pubDate: a.publishedAt || new Date().toISOString(),
    source: (a.source && a.source.name) ? a.source.name : '',
    description: a.description || '',
    keyword: keyword,
    fetchedAt: new Date().toISOString()
  }))
}

/**
 * 解析 Google News RSS XML
 */
function parseGoogleRSS(xmlStr, keyword) {
  const items = []

  // 匹配 <item> 块（支持嵌套标签和CDATA）
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
        title: title,
        link: link,
        pubDate: pubDate || new Date().toISOString(),
        source: source || extractSourceFromTitle(title),
        description: description || '',
        keyword: keyword,
        fetchedAt: new Date().toISOString()
      })
    }
  }

  return items
}

/**
 * 从 XML 块中提取指定标签内容
 * 支持 CDATA 和普通文本
 */
function extractTag(block, tag) {
  // 先匹配 CDATA 格式
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`, 'i')
  const cdataMatch = cdataPattern.exec(block)
  if (cdataMatch) {
    return decodeHTMLEntities(cdataMatch[1].trim())
  }

  // 再匹配普通格式
  const normalPattern = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'i')
  const normalMatch = normalPattern.exec(block)
  if (normalMatch) {
    return decodeHTMLEntities(normalMatch[1].trim())
  }

  return ''
}

/**
 * HTML 实体解码
 */
function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * 从标题中提取来源（Google RSS 标题格式: "标题 - 来源"）
 */
function extractSourceFromTitle(title) {
  const match = title.match(/\s*-\s*([^-]+)$/)
  return match ? match[1].trim() : ''
}

/**
 * 存储文章到数据库
 * 使用 link 字段做去重判断
 */
async function saveArticles(keyword, articles) {
  const collection = db.collection('news_articles')
  let saved = 0

  for (const article of articles) {
    try {
      // 检查是否已存在（按 link 去重）
      const existRes = await collection.where({ link: article.link }).count()
      if (existRes.total > 0) {
        continue
      }

      // 新增
      await collection.add({
        ...article,
        createdAt: new Date().toISOString()
      })
      saved++

    } catch (err) {
      // 单条存储失败不影响整体
      console.warn(`[saveArticles] 存储失败: ${article.link}`, err.message)
    }
  }

  console.log(`[saveArticles] "${keyword}" 新增 ${saved} 条`)
  return saved
}

/**
 * 延时工具函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================
// 国内可用的 RSS 源
// ============================================================

async function fetchPeopleRSS(keyword) {
  return await fetchAndFilter('http://www.people.com.cn/rss/politics.xml', keyword)
}

async function fetchPeopleFinance(keyword) {
  return await fetchAndFilter('http://finance.people.com.cn/rss/finance.xml', keyword)
}

async function fetchSinaNews(keyword) {
  return await fetchAndFilter('https://rss.sina.com.cn/news/marquee/ddt.xml', keyword)
}

async function fetch36Kr(keyword) {
  return await fetchAndFilter('https://36kr.com/feed', keyword)
}

async function fetchAndFilter(url, keyword) {
  try {
    const res = await uniCloud.httpclient.request(url, {
      method: 'GET',
      timeout: 15000,
      dataType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsApp/1.0)' }
    })
    if (res.statusCode !== 200 || !res.data) return []
    const allArticles = parseGoogleRSS(res.data, keyword)
    return allArticles.filter(a =>
      (a.title || '').includes(keyword) || (a.description || '').includes(keyword)
    ).slice(0, 30)
  } catch (e) {
    return []
  }
}
