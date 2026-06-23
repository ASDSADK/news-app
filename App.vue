<script>
export default {
  onLaunch() {
    console.log('新闻速递 App 启动')
    
    // 检查更新
    // #ifdef APP-PLUS
    this.checkUpdate()
    // #endif
  },
  onShow() {
    console.log('App Show')
  },
  onHide() {
    console.log('App Hide')
  },
  methods: {
    // APP 版本更新检查
    checkUpdate() {
      // #ifdef APP-PLUS
      plus.runtime.getProperty(plus.runtime.appid, (info) => {
        // 可接入自己的更新检测逻辑
        console.log('当前版本:', info.version)
      })
      // #endif
    }
  }
}
</script>

<style lang="scss">
/* 全局样式 */
page {
  background: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial,
    sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* 通用按钮重置 */
button {
  padding: 0;
  margin: 0;
  background: none;
  line-height: inherit;
}
button::after {
  border: none;
}

/* 文本省略 */
.text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.text-ellipsis-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
