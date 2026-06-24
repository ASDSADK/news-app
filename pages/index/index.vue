<template>
  <view class="chat-container">
    <!-- 顶部导航栏 -->
    <view class="chat-header">
      <view class="header-left">
        <text class="header-logo">📰</text>
        <text class="header-title">新闻速递</text>
      </view>
      <view class="header-right">
        <text class="header-badge" v-if="activeKeyword">追踪中</text>
        <text class="header-icon" @click="showHistory = !showHistory">☰</text>
      </view>
    </view>

    <!-- 侧边栏：历史关键词 -->
    <view class="history-overlay" v-if="showHistory" @click="showHistory = false">
      <view class="history-panel" @click.stop>
        <view class="history-header">
          <text class="history-title">追踪记录</text>
          <text class="history-close" @click="showHistory = false">✕</text>
        </view>
        <scroll-view class="history-list" scroll-y>
          <view
            class="history-item"
            :class="{ 'history-active': conv.keyword === activeKeyword && isFetching }"
            v-for="(conv, idx) in conversations"
            :key="idx"
            @click="switchConversation(conv.keyword)"
          >
            <text class="history-keyword">{{ conv.keyword }}</text>
            <text class="history-count">{{ conv.articles.length }}条</text>
            <text class="history-delete" @click.stop="deleteConversation(idx)">🗑</text>
          </view>
          <view class="history-empty" v-if="!conversations.length">
            <text>暂无追踪记录</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 对话区域 -->
    <scroll-view
      class="chat-messages"
      scroll-y
      :scroll-into-view="scrollToId"
      :scroll-with-animation="true"
      @scrolltolower="loadMore"
    >
      <!-- 欢迎页 -->
      <view class="welcome-screen" v-if="!conversations.length">
        <view class="welcome-logo">📰</view>
        <text class="welcome-brand">新闻速递</text>
        <text class="welcome-slogan">输入关键词，追踪你关心的新闻</text>
        <view class="welcome-suggestions">
          <text class="suggest-label">试试这些：</text>
          <view class="suggest-tags">
            <text class="suggest-tag" @click="quickSearch('人工智能')">🤖 人工智能</text>
            <text class="suggest-tag" @click="quickSearch('科技')">💻 科技</text>
            <text class="suggest-tag" @click="quickSearch('经济')">📈 经济</text>
            <text class="suggest-tag" @click="quickSearch('体育')">⚽ 体育</text>
          </view>
        </view>
        <view class="welcome-footer">
          <text class="footer-link" @click="openPrivacy">📜 隐私政策</text>
        </view>
      </view>

      <!-- 对话列表 -->
      <view v-for="(conv, cIdx) in conversations" :key="cIdx" class="conversation-block">
        <!-- 用户消息：关键词 -->
        <view class="message-row message-user">
          <view class="message-bubble user-bubble">
            <text class="bubble-label">🔍 追踪关键词</text>
            <text class="bubble-keyword">{{ conv.keyword }}</text>
            <view class="bubble-meta" v-if="conv.keyword === activeKeyword && isFetching">
              <text class="meta-dot"></text>
              <text class="meta-text">每10分钟自动刷新 · 下次 {{ nextRefreshTime }}</text>
            </view>
          </view>
        </view>

        <!-- 助手消息：新闻列表 -->
        <view class="message-row message-assistant">
          <view class="message-bubble assistant-bubble">
            <!-- 加载中 -->
            <view class="loading-indicator" v-if="conv.loading">
              <view class="loading-dots">
                <view class="dot"></view>
                <view class="dot"></view>
                <view class="dot"></view>
              </view>
              <text class="loading-text">正在搜索「{{ conv.keyword }}」相关新闻...</text>
            </view>

            <!-- 新闻列表 -->
            <view class="news-cards" v-else>
              <text class="cards-header">
                找到 <text class="highlight">{{ conv.articles.length }}</text> 条相关新闻
                <text class="cards-source"> · {{ conv.source || 'Google News' }}</text>
              </text>

              <view
                class="news-card"
                v-for="(item, nIdx) in conv.displayArticles"
                :key="nIdx"
                @click="openDetail(item)"
              >
                <view class="card-header">
                  <view class="card-header-left">
                    <text class="card-source">{{ item.source || '未知来源' }}</text>
                    <text class="card-source-badge" v-if="item.sourceName">{{ item.sourceName }}</text>
                  </view>
                  <text class="card-time">{{ formatTime(item.pubDate) }}</text>
                </view>
                <text class="card-title">{{ cleanTitle(item.title) }}</text>
                <text class="card-desc" v-if="item.description">{{ cleanDesc(item.description) }}</text>
                <view class="card-footer">
                  <text class="card-link">{{ item.link }}</text>
                  <text class="card-action">查看详情 →</text>
                </view>
              </view>

              <!-- 加载更多 -->
              <view class="more-btn" v-if="conv.hasMore" @click="loadMoreForConv(cIdx)">
                <text>{{ conv.loadingMore ? '加载中...' : `查看全部 ${conv.articles.length} 条 →` }}</text>
              </view>

              <!-- 操作按钮 -->
              <view class="conv-actions" v-if="conv.articles.length">
                <view class="action-btn" @click.stop="refreshConversation(conv.keyword)">
                  <text>🔄 刷新</text>
                </view>
                <view class="action-btn" @click.stop="stopTracking(conv.keyword)" v-if="conv.keyword === activeKeyword && isFetching">
                  <text>⏹ 停止追踪</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 底部占位 -->
      <view class="scroll-bottom" id="scroll-bottom"></view>
    </scroll-view>

    <!-- 底部输入栏 -->
    <view class="chat-input-bar">
      <!-- 新闻源选择器 -->
      <view class="source-selector" v-if="sources && Object.keys(sources).length">
        <scroll-view class="source-scroll" scroll-x :show-scrollbar="false">
          <view
            class="source-chip"
            :class="{ 'chip-active': selectedSources.includes(k) }"
            v-for="(src, k) in sources"
            :key="k"
            @click="toggleSource(k)"
          >
            <text class="chip-icon">{{ src.icon }}</text>
            <text class="chip-name">{{ src.label }}</text>
          </view>
        </scroll-view>
      </view>
      <view class="input-row">
        <view class="input-box">
          <input
            v-model="keyword"
            class="chat-input"
            placeholder="输入关键词，如：人工智能、科技..."
            confirm-type="send"
            :disabled="isLoading"
            @confirm="sendKeyword"
            :adjust-position="true"
          />
          <text class="input-clear" v-if="keyword" @click="keyword=''">✕</text>
        </view>
        <view class="send-btn" :class="{ 'send-disabled': !keyword.trim() || isLoading }" @click="sendKeyword">
          <text class="send-icon" v-if="!isLoading">↑</text>
          <text class="send-icon loading-spin" v-else>⏳</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { fetchAllSources, fetchViaCloud, getSources, getEnabledSources } from '@/utils/api.js'

export default {
  data() {
    return {
      keyword: '',
      activeKeyword: '',
      isFetching: false,
      isLoading: false,
      nextRefreshTime: '',
      timer: null,
      showHistory: false,
      scrollToId: '',
      sourceUsed: '',
      // 新闻源
      sources: {},
      selectedSources: [],
      // 对话列表：每个关键词一个对话
      conversations: [],
      pageSize: 10
    }
  },
  onLoad() {
    // 初始化新闻源
    this.sources = getSources()
    this.selectedSources = getEnabledSources()
    // 恢复历史会话
    const saved = uni.getStorageSync('conversations')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        // 恢复时清除loading状态
        this.conversations = data.map(c => ({
          ...c,
          loading: false,
          loadingMore: false,
          hasMore: c.articles.length > this.pageSize,
          displayArticles: c.articles.slice(0, this.pageSize)
        }))
      } catch (e) {
        this.conversations = []
      }
    }
  },
  onUnload() {
    this.stopAllTracking()
  },
  methods: {
    // ========== 发送关键词 ==========
    sendKeyword() {
      const kw = this.keyword.trim()
      if (!kw || this.isLoading) return

      this.keyword = ''
      this.isLoading = true
      this.activeKeyword = kw

      // 检查是否已存在该对话
      const existIdx = this.conversations.findIndex(c => c.keyword === kw)
      if (existIdx > -1) {
        // 移到最前面
        const conv = this.conversations.splice(existIdx, 1)[0]
        conv.loading = true
        conv.loadingMore = false
        conv.hasMore = false
        conv.displayArticles = []
        this.conversations.unshift(conv)
      } else {
        // 新建对话
        this.conversations.unshift({
          keyword: kw,
          articles: [],
          displayArticles: [],
          loading: true,
          loadingMore: false,
          hasMore: false,
          source: '',
          allNews: []
        })
      }

      this.scrollToBottom()
      this.fetchNewsForKeyword(kw)

      // 开启定时刷新
      if (this.timer) clearInterval(this.timer)
      this.timer = setInterval(() => {
        this.autoRefresh()
      }, 10 * 60 * 1000)
      this.updateNextRefreshTime()
    },

    // ========== 快捷搜索 ==========
    quickSearch(kw) {
      this.keyword = kw
      this.sendKeyword()
    },

    // ========== 获取新闻 ==========
    async fetchNewsForKeyword(keyword) {
      const conv = this.conversations.find(c => c.keyword === keyword)
      if (!conv) return

      let result = { articles: [], sources: [] }

      // 优先通过云函数搜索（精准关键词 + RSS聚合）
      try {
        result = await fetchViaCloud(keyword)
      } catch (e) {
        console.warn('云函数搜索失败，降级到本地RSS:', e.message)
      }

      // 云函数无结果时降级到本地 RSS 直连
      if (result.articles.length === 0) {
        result = await fetchAllSources(keyword, this.selectedSources)
      }

      if (result.articles.length > 0) {
        conv.source = result.source || result.sources.map(k => this.sources[k]?.label || k).join(' + ')
        this.updateConvWithArticles(conv, result.articles)
      } else {
        conv.loading = false
        uni.showToast({ title: '未找到相关新闻，换个关键词试试', icon: 'none' })
        this.saveConversations()
      }
    },

    updateConvWithArticles(conv, articles) {
      conv.articles = articles
      conv.allNews = articles
      conv.loading = false
      conv.hasMore = articles.length > this.pageSize
      conv.displayArticles = articles.slice(0, this.pageSize)
      this.isLoading = false
      this.isFetching = true
      this.sourceUsed = conv.source
      this.scrollToBottom()
      this.saveConversations()
    },

    // ========== 自动刷新 ==========
    async autoRefresh() {
      if (!this.activeKeyword) return
      // 定时刷新只用免费RSS，不消耗天行数据额度
      const result = await fetchAllSources(this.activeKeyword, this.selectedSources)
      if (result.articles.length > 0) {
        const conv = this.conversations.find(c => c.keyword === this.activeKeyword)
        if (conv) {
          conv.articles = result.articles
          conv.allNews = result.articles
          conv.hasMore = result.articles.length > this.pageSize
          conv.displayArticles = result.articles.slice(0, this.pageSize)
          conv.source = result.source || result.sources.map(k => this.sources[k]?.label || k).join(' + ')
          this.updateNextRefreshTime()
          this.saveConversations()
        }
      }
    },

    // ========== 加载更多 ==========
    loadMoreForConv(cIdx) {
      const conv = this.conversations[cIdx]
      if (!conv || conv.loadingMore || !conv.hasMore) return
      conv.loadingMore = true
      const currentLen = conv.displayArticles.length
      const more = conv.allNews.slice(currentLen, currentLen + this.pageSize)
      if (more.length) {
        conv.displayArticles = [...conv.displayArticles, ...more]
        conv.hasMore = conv.displayArticles.length < conv.allNews.length
      }
      conv.loadingMore = false
    },

    // ========== 切换对话 ==========
    switchConversation(keyword) {
      this.showHistory = false
      this.activeKeyword = keyword
      this.isFetching = true
      if (this.timer) clearInterval(this.timer)
      this.timer = setInterval(() => {
        this.autoRefresh()
      }, 10 * 60 * 1000)
      this.updateNextRefreshTime()
      this.scrollToBottom()
    },

    // ========== 刷新对话 ==========
    async refreshConversation(keyword) {
      const conv = this.conversations.find(c => c.keyword === keyword)
      if (conv) {
        conv.loading = true
        conv.displayArticles = []
        this.scrollToBottom()
        await this.fetchNewsForKeyword(keyword)
      }
    },

    // ========== 停止追踪 ==========
    stopTracking(keyword) {
      this.isFetching = false
      this.activeKeyword = ''
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    },

    stopAllTracking() {
      this.isFetching = false
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    },

    // ========== 删除对话 ==========
    deleteConversation(idx) {
      const conv = this.conversations[idx]
      if (conv.keyword === this.activeKeyword) {
        this.stopTracking(conv.keyword)
      }
      this.conversations.splice(idx, 1)
      this.saveConversations()
    },

    // ========== 持久化 ==========
    saveConversations() {
      const toSave = this.conversations.map(c => ({
        keyword: c.keyword,
        articles: c.articles,
        source: c.source
      }))
      uni.setStorageSync('conversations', JSON.stringify(toSave))
    },

    // ========== 标题/描述清理 ==========
    cleanTitle(title) {
      if (!title) return ''
      return title.replace(/\s*-\s*[^-]+$/, '').trim()
    },

    cleanDesc(desc) {
      if (!desc) return ''
      return desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').substring(0, 120)
    },

    // ========== 工具方法 ==========
    openDetail(item) {
      uni.navigateTo({
        url: `/pages/detail/detail?title=${encodeURIComponent(item.title)}&url=${encodeURIComponent(item.link)}&source=${encodeURIComponent(item.source)}&time=${encodeURIComponent(item.pubDate)}&desc=${encodeURIComponent(item.description || '')}`
      })
    },

    openPrivacy() {
      uni.navigateTo({ url: '/pages/privacy/privacy' })
    },

    toggleSource(key) {
      const idx = this.selectedSources.indexOf(key)
      if (idx > -1) {
        if (this.selectedSources.length > 1) {
          this.selectedSources.splice(idx, 1)
        }
      } else {
        this.selectedSources.push(key)
      }
    },

    scrollToBottom() {
      this.$nextTick(() => {
        this.scrollToId = 'scroll-bottom'
      })
    },

    updateNextRefreshTime() {
      const t = new Date(Date.now() + 10 * 60 * 1000)
      this.nextRefreshTime = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}`
    },

    formatTime(dateStr) {
      if (!dateStr) return ''
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr
      const now = new Date()
      const diff = now - d
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
      return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
  }
}
</script>

<style scoped>
/* ========== 容器 ========== */
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ========== 顶部栏 ========== */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20rpx 28rpx;
  background: #fff;
  border-bottom: 1rpx solid #eee;
  position: sticky;
  top: 0;
  z-index: 10;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.header-logo {
  font-size: 36rpx;
}
.header-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #1a1a1a;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.header-badge {
  font-size: 20rpx;
  color: #fff;
  background: #4d6bfe;
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
}
.header-icon {
  font-size: 40rpx;
  color: #666;
  padding: 8rpx;
}

/* ========== 侧边栏 ========== */
.history-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 100;
}
.history-panel {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 520rpx;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32rpx 28rpx;
  border-bottom: 1rpx solid #eee;
}
.history-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #1a1a1a;
}
.history-close {
  font-size: 36rpx;
  color: #999;
  padding: 8rpx;
}
.history-list {
  flex: 1;
  padding: 16rpx;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 24rpx 20rpx;
  border-radius: 14rpx;
  margin-bottom: 8rpx;
  background: #f8f8fa;
}
.history-active {
  background: #eef0ff;
  border: 2rpx solid #4d6bfe;
}
.history-keyword {
  flex: 1;
  font-size: 28rpx;
  color: #333;
  font-weight: 500;
}
.history-count {
  font-size: 22rpx;
  color: #999;
}
.history-delete {
  font-size: 28rpx;
  color: #ccc;
  padding: 8rpx;
}
.history-empty {
  text-align: center;
  padding: 100rpx 0;
  color: #ccc;
  font-size: 26rpx;
}

/* ========== 欢迎页 ========== */
.welcome-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 40rpx 0;
}
.welcome-logo {
  font-size: 120rpx;
  margin-bottom: 24rpx;
}
.welcome-brand {
  font-size: 48rpx;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 12rpx;
}
.welcome-slogan {
  font-size: 28rpx;
  color: #999;
  margin-bottom: 60rpx;
}
.welcome-suggestions {
  width: 100%;
}
.suggest-label {
  font-size: 24rpx;
  color: #bbb;
  margin-bottom: 20rpx;
  display: block;
}
.suggest-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.suggest-tag {
  font-size: 26rpx;
  color: #4d6bfe;
  background: #eef0ff;
  padding: 14rpx 28rpx;
  border-radius: 36rpx;
  transition: 0.2s;
}
.suggest-tag:active {
  background: #dde0ff;
  transform: scale(0.96);
}
.welcome-footer {
  margin-top: 80rpx;
}
.footer-link {
  font-size: 24rpx;
  color: #999;
}

/* ========== 消息 ========== */
.chat-messages {
  flex: 1;
  padding: 24rpx 24rpx 0;
}
.conversation-block {
  margin-bottom: 32rpx;
}
.message-row {
  display: flex;
  margin-bottom: 20rpx;
}
.message-user {
  justify-content: flex-end;
}
.message-assistant {
  justify-content: flex-start;
}
.message-bubble {
  max-width: 92%;
  border-radius: 20rpx;
  padding: 28rpx;
}

/* 用户气泡 */
.user-bubble {
  background: #eef0ff;
  border-bottom-right-radius: 6rpx;
}
.bubble-label {
  font-size: 22rpx;
  color: #8b9cf7;
  display: block;
  margin-bottom: 6rpx;
}
.bubble-keyword {
  font-size: 34rpx;
  font-weight: 700;
  color: #1a1a1a;
}
.bubble-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 12rpx;
}
.meta-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #4d6bfe;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.meta-text {
  font-size: 20rpx;
  color: #8b9cf7;
}

/* 助手气泡 */
.assistant-bubble {
  background: #fff;
  border-bottom-left-radius: 6rpx;
  box-shadow: 0 2rpx 16rpx rgba(0,0,0,0.04);
}

/* ========== 加载动画 ========== */
.loading-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 0;
}
.loading-dots {
  display: flex;
  gap: 10rpx;
  margin-bottom: 20rpx;
}
.dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: #ccc;
  animation: bounce 1.4s infinite both;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
.loading-text {
  font-size: 24rpx;
  color: #aaa;
}

/* ========== 新闻卡片 ========== */
.cards-header {
  font-size: 24rpx;
  color: #999;
  display: block;
  margin-bottom: 20rpx;
}
.highlight {
  color: #4d6bfe;
  font-weight: 600;
}
.cards-source {
  color: #ccc;
  font-size: 20rpx;
}
.news-card {
  background: #fafbfc;
  border-radius: 14rpx;
  padding: 24rpx;
  margin-bottom: 14rpx;
  border: 1rpx solid #f0f0f0;
  transition: 0.2s;
}
.news-card:active {
  background: #f0f2f5;
  transform: scale(0.99);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}
.card-source {
  font-size: 20rpx;
  color: #4d6bfe;
  background: #eef0ff;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
}
.card-time {
  font-size: 20rpx;
  color: #bbb;
}
.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #1a1a1a;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 10rpx;
}
.card-desc {
  font-size: 24rpx;
  color: #999;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 14rpx;
}
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-link {
  font-size: 18rpx;
  color: #ccc;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-action {
  font-size: 22rpx;
  color: #4d6bfe;
  font-weight: 500;
}

/* ========== 加载更多 ========== */
.more-btn {
  text-align: center;
  padding: 20rpx;
  font-size: 24rpx;
  color: #4d6bfe;
}
.conv-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 16rpx;
}
.action-btn {
  font-size: 22rpx;
  color: #999;
  padding: 12rpx 24rpx;
  background: #f5f5f7;
  border-radius: 24rpx;
}
.action-btn:active {
  background: #e8e8ec;
}

/* ========== 底部输入栏 ========== */
.chat-input-bar {
  background: #fff;
  padding: 16rpx 24rpx;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid #eee;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 14rpx;
}
.input-box {
  flex: 1;
  position: relative;
}
.chat-input {
  width: 100%;
  height: 80rpx;
  background: #f5f5f7;
  border-radius: 40rpx;
  padding: 0 80rpx 0 36rpx;
  font-size: 28rpx;
  box-sizing: border-box;
  color: #1a1a1a;
}
.chat-input:focus {
  background: #f0f0f5;
}
.input-clear {
  position: absolute;
  right: 24rpx;
  top: 50%;
  transform: translateY(-50%);
  font-size: 26rpx;
  color: #bbb;
  padding: 8rpx;
}
.send-btn {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #4d6bfe;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: 0.2s;
}
.send-btn:active {
  transform: scale(0.92);
}
.send-disabled {
  background: #dde0ff;
}
.send-icon {
  font-size: 36rpx;
  color: #fff;
  font-weight: 700;
}
.loading-spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ========== 底部占位 ========== */
.scroll-bottom {
  height: 20rpx;
}

/* ========== 新闻源选择器 ========== */
.source-selector {
  padding: 0 0 12rpx 0;
}
.source-scroll {
  display: flex;
  white-space: nowrap;
}
.source-chip {
  display: inline-flex;
  align-items: center;
  gap: 4rpx;
  padding: 8rpx 18rpx;
  margin-right: 10rpx;
  background: #f0f0f5;
  border-radius: 24rpx;
  font-size: 22rpx;
  color: #999;
  transition: 0.2s;
  border: 2rpx solid transparent;
}
.chip-active {
  background: #eef0ff;
  color: #4d6bfe;
  border-color: #4d6bfe;
  font-weight: 600;
}
.chip-icon {
  font-size: 22rpx;
}
.chip-name {
  font-size: 20rpx;
}

/* ========== 卡片来源徽章 ========== */
.card-header-left {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.card-source-badge {
  font-size: 18rpx;
  color: #fff;
  background: #4d6bfe;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
</style>
