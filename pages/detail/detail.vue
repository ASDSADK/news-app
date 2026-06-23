<template>
  <view class="container">
    <!-- 加载中 -->
    <view class="loading" v-if="isLoading">
      <text class="loading-icon">⏳</text>
      <text>加载新闻中...</text>
    </view>

    <!-- 新闻内容 -->
    <view class="detail-content" v-else>
      <text class="detail-title">{{ title }}</text>
      
      <view class="detail-meta">
        <text class="meta-source">{{ source || '未知来源' }}</text>
        <text class="meta-time">{{ formatTime(pubDate) }}</text>
      </view>

      <!-- 描述 -->
      <view class="detail-desc" v-if="description">
        <text>{{ cleanDesc(description) }}</text>
      </view>

      <!-- 操作按钮 -->
      <view class="action-buttons">
        <button class="btn-open" @click="openInBrowser">
          <text class="btn-icon">🌐</text>
          <text>在浏览器中打开</text>
        </button>
        <button class="btn-copy" @click="copyUrl">
          <text class="btn-icon">📋</text>
          <text>{{ copied ? '已复制' : '复制网址' }}</text>
        </button>
        <button class="btn-share" @click="shareNews">
          <text class="btn-icon">📤</text>
          <text>分享</text>
        </button>
      </view>

      <!-- 网址展示 -->
      <view class="url-box" @click="copyUrl">
        <text class="url-label">原文链接</text>
        <text class="url-text">{{ url }}</text>
        <text class="url-hint">点击复制</text>
      </view>

      <!-- 内嵌浏览器 (APP端) -->
      <!-- #ifdef APP-PLUS -->
      <web-view 
        v-if="showWebview" 
        :src="url"
        class="detail-webview"
        @error="onWebviewError"
      ></web-view>
      <!-- #endif -->
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      title: '',
      url: '',
      source: '',
      pubDate: '',
      description: '',
      isLoading: true,
      copied: false,
      showWebview: false
    }
  },
  onLoad(options) {
    this.title = decodeURIComponent(options.title || '')
    this.url = decodeURIComponent(options.url || '')
    this.source = decodeURIComponent(options.source || '')
    this.pubDate = decodeURIComponent(options.time || '')
    this.description = decodeURIComponent(options.desc || '')
    this.isLoading = false

    // APP端自动加载webview
    // #ifdef APP-PLUS
    if (this.url) {
      this.showWebview = true
    }
    // #endif
  },
  methods: {
    // 在系统浏览器打开
    openInBrowser() {
      // #ifdef APP-PLUS
      plus.runtime.openURL(this.url)
      // #endif
      
      // #ifdef H5
      window.open(this.url, '_blank')
      // #endif

      // #ifdef MP-WEIXIN
      wx.setClipboardData({
        data: this.url,
        success: () => {
          uni.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none' })
        }
      })
      // #endif
    },

    // 复制网址
    copyUrl() {
      uni.setClipboardData({
        data: this.url,
        success: () => {
          this.copied = true
          uni.showToast({ title: '网址已复制', icon: 'success' })
          setTimeout(() => { this.copied = false }, 2000)
        }
      })
    },

    // 分享
    shareNews() {
      // #ifdef APP-PLUS
      uni.share({
        provider: 'weixin',
        type: 0,
        title: this.title,
        href: this.url,
        success: () => {
          uni.showToast({ title: '分享成功', icon: 'success' })
        },
        fail: () => {
          // 分享失败时复制链接
          this.copyUrl()
        }
      })
      // #endif

      // #ifdef MP-WEIXIN
      // 小程序使用 button open-type="share"
      // #endif

      // #ifdef H5
      this.copyUrl()
      // #endif
    },

    // webview 加载错误
    onWebviewError() {
      uni.showToast({ title: '页面加载失败，请尝试在浏览器中打开', icon: 'none' })
    },

    // 清理描述中的HTML标签
    cleanDesc(desc) {
      if (!desc) return ''
      return desc.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ')
    },

    formatTime(dateStr) {
      if (!dateStr) return ''
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
  },
  // 分享到微信小程序
  // #ifdef MP-WEIXIN
  onShareAppMessage() {
    return {
      title: this.title,
      path: `/pages/detail/detail?url=${encodeURIComponent(this.url)}&title=${encodeURIComponent(this.title)}`
    }
  }
  // #endif
}
</script>

<style scoped>
.container {
  min-height: 100vh;
  background: #f5f5f5;
}
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  color: #999;
  font-size: 28rpx;
  gap: 20rpx;
}
.loading-icon {
  font-size: 80rpx;
}
.detail-content {
  padding: 32rpx 28rpx;
}
.detail-title {
  font-size: 38rpx;
  font-weight: 700;
  color: #222;
  line-height: 1.5;
  display: block;
}
.detail-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 20rpx;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid #eee;
}
.meta-source {
  font-size: 24rpx;
  color: #4d6bfe;
  background: #eef0ff;
  padding: 6rpx 18rpx;
  border-radius: 6rpx;
}
.meta-time {
  font-size: 24rpx;
  color: #999;
}
.detail-desc {
  margin-top: 24rpx;
  padding: 24rpx;
  background: #fff;
  border-radius: 12rpx;
  font-size: 28rpx;
  color: #555;
  line-height: 1.7;
}
/* 操作按钮 */
.action-buttons {
  display: flex;
  gap: 16rpx;
  margin-top: 28rpx;
}
.action-buttons button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 80rpx;
  border-radius: 40rpx;
  font-size: 26rpx;
  font-weight: 600;
  border: none;
  background: #fff;
  color: #333;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.06);
}
.btn-open {
  background: #4d6bfe !important;
  color: #fff !important;
}
.btn-icon {
  font-size: 32rpx;
}
/* 网址展示 */
.url-box {
  margin-top: 28rpx;
  padding: 28rpx;
  background: #fff;
  border-radius: 12rpx;
}
.url-label {
  font-size: 24rpx;
  color: #999;
  display: block;
  margin-bottom: 12rpx;
}
.url-text {
  font-size: 24rpx;
  color: #4d6bfe;
  word-break: break-all;
  line-height: 1.6;
  display: block;
}
.url-hint {
  font-size: 20rpx;
  color: #ccc;
  margin-top: 12rpx;
  display: block;
}
/* webview */
.detail-webview {
  margin-top: 28rpx;
  width: 100%;
  height: 800rpx;
  border-radius: 12rpx;
  overflow: hidden;
}
</style>
