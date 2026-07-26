/**
 * 新闻搜索云函数 - news-api
 *
 * 搜索策略：
 *   1. 百度新闻搜索 → 云函数端抓取解析（主力）
 *   2. 搜狗新闻搜索 → 备用抓取
 *   3. RSS 聚合 → 人民网/新浪/36氪（兜底）
 *   4. 豆包AI → 搜索无结果时智能回答（需配置 API key）
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
    case 'askAI':
      return await askAI(keyword)
    default:
      return { code: 400, message: '未知操作: ' + action }
  }
}

// ============================================================
// 核心搜索：百度新闻 → 搜狗 → RSS
// ============================================================

async function searchNews(keyword, page, pageSize) {
  if (!keyword) return { code: 400, message: '关键词不能为空' }

  let articles = []
  let source = ''

  // 1. 百度新闻搜索（主力，零成本）
  for (let pn = 0; pn < Math.min(page, 3); pn++) {
    try {
      const batch = await fetchBaiduNews(keyword, pn)
      if (batch.length > 0) {
        articles = articles.concat(batch)
        if (!source) source = '百度新闻'
      }
    } catch (e) {
      console.warn('[百度] 失败:', e.message)
    }
    if (articles.length >= pageSize * page) break
    await sleep(300)
  }

  // 2. 搜狗新闻搜索（备用）
  if (articles.length < 10) {
    try {
      const batch = await fetchSogouNews(keyword)
      const existing = new Set(articles.map(a => a.link))
      const merged = batch.filter(a => !existing.has(a.link))
      articles = articles.concat(merged)
      source = source || '搜狗新闻'
    } catch (e) {
      console.warn('[搜狗] 失败:', e.message)
    }
  }

  // 3. RSS 聚合（兜底）
  if (articles.length < 5) {
    try {
      const batch = await fetchRSSFeeds(keyword)
      const existing = new Set(articles.map(a => a.link))
      const merged = batch.filter(a => !existing.has(a.link))
      articles = articles.concat(merged)
      source = source || 'RSS聚合'
    } catch (e) {
      console.warn('[RSS] 失败:', e.message)
    }
  }

  // 去重
  const seen = new Set()
  const unique = articles.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })

  // 4. AI 智能兜底（搜索结果为空时）
  if (unique.length === 0) {
    try {
      const aiResult = await askAI(keyword)
      if (aiResult && aiResult.text) {
        unique.push({
          title: `AI 智能回答: ${keyword}`,
          link: '',
          pubDate: new Date().toISOString(),
          source: aiResult.source,
          description: aiResult.text,
          keyword,
          sourceName: aiResult.source,
          isAI: true
        })
        source = aiResult.source
      }
    } catch (e) {
      console.warn('[AI] 失败:', e.message)
    }
  }

  // 分页
  const start = (page - 1) * pageSize
  const paged = unique.slice(start, start + pageSize)

  console.log(`[search] "${keyword}" → ${unique.length} 条 (源: ${source})`)

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
// 百度新闻搜索（HTML 抓取）
// ============================================================

async function fetchBaiduNews(keyword, pageNum = 0) {
  const url = `https://www.baidu.com/s?tn=news&word=${encodeURIComponent(keyword)}&pn=${pageNum * 10}`
  
  const res = await uniCloud.httpclient.request(url, {
    method: 'GET',
    timeout: 15000,
    dataType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache'
    }
  })

  if (res.statusCode !== 200 || !res.data) return []

  const html = typeof res.data === 'string' ? res.data : res.data.toString()
  return parseBaiduNewsHTML(html, keyword)
}

/**
 * 解析百度新闻搜索结果 HTML
 * 提取真实新闻 URL（跳转链接 → 真实 URL）
 */
function parseBaiduNewsHTML(html, keyword) {
  const articles = []

  // 百度新闻搜索结果结构：
  // 1. <a> 标签包含新闻标题，href 指向真实 URL
  // 2. 部分链接是百度跳转链接，需要提取真实 URL

  // 提取所有新闻链接块
  const resultBlocks = html.split(/<div[^>]*class="[^"]*result[^"]*"/i)
  
  for (const block of resultBlocks) {
    // 提取标题和链接
    const titleMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/i)
    if (!titleMatch) continue

    let url = titleMatch[1]
    let title = titleMatch[2]

    // 清洗标题中的 HTML 标签
    title = title.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim()

    // 跳过太短的标题、导航链接
    if (title.length < 8) continue
    if (url.includes('baidu.com/s?') || url.includes('baidu.com/link')) {
      // 百度跳转链接 → 提取真实 URL
      const realUrlMatch = url.match(/[?&]url=([^&]+)/)
      if (realUrlMatch) {
        url = decodeURIComponent(realUrlMatch[1])
      } else {
        continue
      }
    }

    // 跳过非新闻链接
    if (url.includes('baidu.com') || url.length < 25) continue

    // 提取来源
    let source = ''
    const sourceMatch = block.match(/(?:class="[^"]*source[^"]*"[^>]*>|来源[：:]\s*)([^<]+)/i)
    if (sourceMatch) {
      source = sourceMatch[1].trim()
    }

    // 提取摘要
    let description = ''
    const descMatch = block.match(/(?:class="[^"]*desc[^"]*"[^>]*>|class="[^"]*summary[^"]*"[^>]*>)([^<]+)/i)
    if (descMatch) {
      description = descMatch[1].trim().substring(0, 150)
    }

    // 提取时间
    let pubDate = new Date().toISOString()
    const timeMatch = block.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}[T\s]\d{1,2}:\d{2})|(\d+[分钟小时天]前)|(\d{1,2}月\d{1,2}日)/i)
    if (timeMatch) {
      pubDate = timeMatch[0]
    }

    articles.push({
      title,
      link: url,
      pubDate,
      source: source || extractDomain(url),
      description,
      keyword,
      sourceName: '百度新闻'
    })
  }

  // 如果正则没解析出来，尝试更简单的提取
  if (articles.length === 0) {
    const simpleLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi)
    if (simpleLinks) {
      for (const linkStr of simpleLinks) {
        const urlMatch = linkStr.match(/href="(https?:\/\/[^"]+)"/)
        const titleMatch = linkStr.match(/>([^<]+)</)
        if (!urlMatch || !titleMatch) continue

        let url = urlMatch[1]
        let title = titleMatch[1].trim()

        // 清洗标题和 URL（同上逻辑）
        title = title.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim()
        if (title.length < 8) continue

        if (url.includes('baidu.com/s?') || url.includes('baidu.com/link')) {
          const realUrlMatch = url.match(/[?&]url=([^&]+)/)
          if (realUrlMatch) {
            url = decodeURIComponent(realUrlMatch[1])
          } else {
            continue
          }
        }
        if (url.includes('baidu.com') || url.length < 25) continue

        articles.push({
          title,
          link: url,
          pubDate: new Date().toISOString(),
          source: extractDomain(url),
          description: '',
          keyword,
          sourceName: '百度新闻'
        })
      }
    }
  }

  return articles.slice(0, 30)
}

// ============================================================
// 搜狗新闻搜索（备用）
// ============================================================

async function fetchSogouNews(keyword) {
  const url = `https://news.sogou.com/news?query=${encodeURIComponent(keyword)}&page=1`
  
  const res = await uniCloud.httpclient.request(url, {
    method: 'GET',
    timeout: 15000,
    dataType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  })

  if (res.statusCode !== 200 || !res.data) return []

  const html = typeof res.data === 'string' ? res.data : res.data.toString()
  const articles = []

  // 提取搜狗新闻结果（搜狗使用 vr-title 类）
  const titleBlocks = html.match(/<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>(.*?)<\/h3>/gi)
  const linkMatches = html.match(/href="(https?:\/\/[^"]+)"/gi)

  if (titleBlocks && linkMatches) {
    for (let i = 0; i < Math.min(titleBlocks.length, linkMatches.length); i++) {
      let title = titleBlocks[i].replace(/<[^>]+>/g, '').trim()
      let link = linkMatches[i].match(/href="([^"]+)"/)[1]

      if (title.length < 8) continue
      if (link.includes('sogou.com') || link.includes('sogoucdn')) continue

      articles.push({
        title,
        link,
        pubDate: new Date().toISOString(),
        source: extractDomain(link),
        description: '',
        keyword,
        sourceName: '搜狗新闻'
      })
    }
  }

  return articles.slice(0, 20)
}

// ============================================================
// RSS 聚合（兜底）
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
          return items
            .filter(a =>
              (a.title || '').toLowerCase().includes(keyword.toLowerCase()) ||
              (a.description || '').toLowerCase().includes(keyword.toLowerCase())
            )
            .map(a => ({ ...a, sourceName: feed.name }))
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

function extractDomain(url) {
  try {
    const match = url.match(/https?:\/\/([^\/]+)/)
    return match ? match[1].replace('www.', '') : ''
  } catch (e) {
    return ''
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================
// AI 智能兜底（搜索结果为空时调用）
//
// 支持的 AI 服务（按优先级）：
//   1. DeepSeek — 环境变量 DEEPSEEK_API_KEY
//      https://platform.deepseek.com/api_keys
//   2. 豆包    — 环境变量 DOUBAO_API_KEY
//      https://console.volcengine.com/ark
// ============================================================

const AI_PROVIDERS = [
  {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    sourceName: 'DeepSeek AI'
  },
  {
    name: '豆包',
    envKey: 'DOUBAO_API_KEY',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-lite-32k',
    sourceName: '豆包AI'
  }
]

async function askAI(keyword) {
  for (const provider of AI_PROVIDERS) {
    const apiKey = process.env[provider.envKey] || ''
    if (!apiKey) continue

    try {
      const res = await uniCloud.httpclient.request(provider.endpoint, {
        method: 'POST',
        timeout: 30000,
        dataType: 'json',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        data: {
          model: provider.model,
          messages: [{
            role: 'user',
            content: `请帮我搜索关于"${keyword}"的最新信息，简要列出：\n1. 最新动态或新闻\n2. 关键数据或事实\n3. 相关背景\n请用中文回答，控制在500字以内，不要编造信息。`
          }],
          max_tokens: 800,
          temperature: 0.3
        }
      })

      if (res.statusCode === 200 && res.data?.choices?.length > 0) {
        console.log(`[AI] ${provider.name} 返回结果`)
        return {
          text: res.data.choices[0].message?.content?.trim() || '',
          source: provider.sourceName
        }
      }
      console.warn(`[AI] ${provider.name} 异常: HTTP ${res.statusCode}`)

    } catch (e) {
      console.warn(`[AI] ${provider.name} 失败:`, e.message)
    }
  }

  console.warn('[AI] 无可用 AI 服务（未配置 API key）')
  return null
}
