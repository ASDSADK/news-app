<template>
  <view class="aiweb-container">
    <!-- 顶部提示栏 -->
    <view class="aiweb-tip">
      <text class="tip-icon">📋</text>
      <text class="tip-text">关键词「{{ keyword }}」已复制，粘贴到输入框即可提问</text>
      <text class="tip-close" @click="goBack">✕</text>
    </view>

    <!-- WebView -->
    <web-view :src="webUrl" @message="onMessage" v-if="webUrl"></web-view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      keyword: '',
      provider: 'deepseek',
      webUrl: ''
    }
  },
  onLoad(options) {
    this.keyword = decodeURIComponent(options.keyword || '')
    this.provider = options.provider || 'deepseek'

    // 自动复制关键词到剪贴板
    uni.setClipboardData({
      data: this.keyword,
      success: () => {
        uni.showToast({ title: '关键词已复制，粘贴到输入框', icon: 'none', duration: 2500 })
      }
    })

    // 设置对应 AI 的网页地址
    const urls = {
      deepseek: 'https://chat.deepseek.com/',
      doubao: 'https://www.doubao.com/chat/'
    }
    this.webUrl = urls[this.provider] || urls.deepseek
  },
  methods: {
    goBack() {
      uni.navigateBack()
    },
    onMessage(e) {
      // 接收 WebView 消息（预留）
    }
  }
}
</script>

<style scoped>
.aiweb-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.aiweb-tip {
  display: flex;
  align-items: center;
  padding: 16rpx 24rpx;
  background: #eef0ff;
  gap: 10rpx;
}
.tip-icon { font-size: 28rpx; }
.tip-text {
  flex: 1;
  font-size: 24rpx;
  color: #4d6bfe;
}
.tip-close {
  font-size: 32rpx;
  color: #999;
  padding: 8rpx;
}
web-view {
  flex: 1;
}
</style>
