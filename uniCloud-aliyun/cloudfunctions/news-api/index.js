/**
 * 新闻搜索云函数 - news-api
 *
 * 搜索策略（2026-10 实测）：
 *   1. Bing 新闻 RSS  → 任意关键词精准搜索（主力）✅
 *      例：搜"中央汇金" 返回 11 条真实新闻
 *   2. 国内 RSS 聚合  → 人民网/中新网/界面新闻（兜底）✅
 *   3. AI 智能回答    → 前两者均无结果时（需配 API key）
 *
 * 已废弃（实测不可用）：
 *   ❌ 百度新闻抓取  — 返回"百度安全验证"反爬页
 *   ❌ 搜狗/360/头条 — 结果 JS 动态渲染，HTML 无法解析
 *   ❌ Google News   — 国内网络不可达
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
// 核心搜索：Bing 新闻 RSS → 国内 RSS 聚合 → AI
// ============================================================

async function searchNews(keyword, page, pageSize) {
  if (!keyword) return { code: 400, message: '关键词不能为空' }

  let articles = []
  const usedSources = []

  // 1. Bing 新闻 RSS（主力，支持任意关键词）
  try {
    const batch = await fetchBingNews(keyword)
    if (batch.length > 0) {
      articles = articles.concat(batch)
      usedSources.push('Bing新闻')
      console.log(`[Bing] "${keyword}" → ${batch.length} 条`)
    }
  } catch (e) {
    console.warn('[Bing] 失败:', e.message)
  }

  // 2. 国内 RSS 聚合（补充）
  try {
    const batch = await fetchRSSFeeds(keyword)
    if (batch.length > 0) {
      const existing = new Set(articles.map(a => a.link))
      const merged = batch.filter(a => !existing.has(a.link))
      articles = articles.concat(merged)
      if (merged.length > 0) usedSources.push('RSS聚合')
      console.log(`[RSS] "${keyword}" → 补充 ${merged.length} 条`)
    }
  } catch (e) {
    console.warn('[RSS] 失败:', e.message)
  }

  // 去重
  const seen = new Set()
  const unique = articles.filter(a => {
    if (seen.has(a.link)) return false
    seen.add(a.link)
    return true
  })

  // 3. AI 兜底（全部无结果时）
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
        usedSources.push(aiResult.source)
      }
    } catch (e) {
      console.warn('[AI] 失败:', e.message)
    }
  }

  // 分页
  const start = (page - 1) * pageSize
  const paged = unique.slice(start, start + pageSize)
  const source = usedSources.join(' + ')

  console.log(`[search] "${keyword}" → ${unique.length} 条 (源: ${source || '无'})`)

  return {
    code: 0,
    data: {
      articles: paged,
      total: unique.length,
      page,
      pageSize,
      source,
      hasMore: start + pageSize < unique.length
    }
  }
}

// ============================================================
// Bing 新闻 RSS（主力搜索源）
// URL: https://www.bing.com/news/search?q=关键词&format=RSS
// ============================================================

async function fetchBingNews(keyword) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}&format=RSS&mkt=zh-CN`

  const res = await uniCloud.httpclient.request(url, {
    method: 'GET',
    timeout: 20000,
    dataType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  })

  if (res.statusCode !== 200 || !res.data) return []
  const xml = typeof res.data === 'string' ? res.data : res.data.toString()
  return parseBingRSS(xml, keyword)
}

/**
 * 解析 Bing 新闻 RSS
 *
 * item 结构：
 *   <title>标题</title>
 *   <link>http://www.bing.com/news/apiclick.aspx?...&url=<真实URL编码>...</link>
 *   <description>摘要</description>
 *   <pubDate>Sun, 31 Aug 2025 17:01:00 GMT</pubDate>
 *   <News:Source>腾讯网</News:Source>
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
    const source = extractTag(block, 'News:Source') || extractTag(block, 'source')

    if (!title || !rawLink) continue

    // 从 Bing 跳转链接中提取真实新闻 URL
    let link = rawLink
    const urlMatch = rawLink.match(/[?&]url=([^&]+)/)
    if (urlMatch) {
      try {
        link = decodeURIComponent(urlMatch[1])
      } catch (e) {
        link = rawLink
      }
    }

    items.push({
      title: cleanHTML(title),
      link,
      pubDate: parseBingDate(pubDate),
      source: cleanHTML(source) || domainOf(link),
      description: cleanHTML(description).substring(0, 200),
      keyword,
      sourceName: 'Bing新闻'
    })
  }

  return items
}

// ============================================================
// 国内 RSS 聚合（兜底，实测可用源）
// ============================================================

const RSS_FEEDS = [
  { name: '人民网',    url: 'http://www.people.com.cn/rss/politics.xml' },
  { name: '中国新闻网', url: 'https://www.chinanews.com.cn/rss/scroll-news.xml' },
  { name: '中新网财经', url: 'https://www.chinanews.com.cn/rss/finance.xml' },
  { name: '界面新闻',   url: 'https://a.jiemian.com/index.php?m=article&a=rss' }
]

async function fetchRSSFeeds(keyword) {
  const kw = keyword.toLowerCase()
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
        if (res.statusCode !== 200 || !res.data) return []

        const xml = typeof res.data === 'string' ? res.data : res.data.toString()
        return parseRSSItems(xml, keyword)
          .filter(a =>
            (a.title || '').toLowerCase().includes(kw) ||
            (a.description || '').toLowerCase().includes(kw)
          )
          .map(a => ({ ...a, sourceName: feed.name }))
      } catch (e) {
        return []
      }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }
  return all
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
        pubDate: pubDate || new Date().toISOString(),
        source: cleanHTML(source) || '',
        description: cleanHTML(description).substring(0, 200),
        keyword
      })
    }
  }
  return items
}

// ============================================================
// 通用工具
// ============================================================

/**
 * 提取 XML 标签内容（支持 CDATA）
 * 标签名可含冒号，如 News:Source
 */
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseBingDate(str) {
  if (!str) return new Date().toISOString()
  const d = new Date(str)
  return isNaN(d.getTime()) ? str : d.toISOString()
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
// 缓存查询（保留接口）
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
    : collection.count())

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

      if (res.statusCode === 200 && res.data && res.data.choices && res.data.choices.length > 0) {
        console.log(`[AI] ${provider.name} 返回结果`)
        return {
          text: (res.data.choices[0].message && res.data.choices[0].message.content || '').trim(),
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
