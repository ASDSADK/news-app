/**
 * 状态管理 Store
 * 管理关键词、新闻列表、获取状态
 */

import { reactive } from 'vue'

// 使用 Vue3 reactive 做简单状态管理 (兼容 uni-app)
const store = reactive({
  // 当前关键词
  currentKeyword: '',
  
  // 是否正在追踪
  isFetching: false,
  
  // 历史关键词列表
  savedKeywords: [],
  
  // 当前新闻列表
  newsList: [],
  
  // 下次刷新时间
  nextRefreshTime: '',
  
  // 新闻来源
  sourceUsed: '',
  
  // 定时器引用
  timer: null,

  /**
   * 加载本地存储的关键词
   */
  loadKeywords() {
    try {
      const saved = uni.getStorageSync('savedKeywords')
      if (saved) {
        this.savedKeywords = JSON.parse(saved)
      }
    } catch (e) {
      this.savedKeywords = []
    }
  },

  /**
   * 保存关键词到本地
   */
  saveKeyword(kw) {
    const idx = this.savedKeywords.indexOf(kw)
    if (idx > -1) {
      this.savedKeywords.splice(idx, 1)
    }
    this.savedKeywords.unshift(kw)
    if (this.savedKeywords.length > 10) {
      this.savedKeywords.pop()
    }
    uni.setStorageSync('savedKeywords', JSON.stringify(this.savedKeywords))
  },

  /**
   * 清空新闻
   */
  clearNews() {
    this.newsList = []
  },

  /**
   * 停止追踪
   */
  stopFetching() {
    this.isFetching = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /**
   * 重置
   */
  reset() {
    this.currentKeyword = ''
    this.isFetching = false
    this.newsList = []
    this.nextRefreshTime = ''
    this.sourceUsed = ''
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
})

export default store
