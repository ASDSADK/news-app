<template>
  <scroll-view class="privacy-container" scroll-y>
    <text class="privacy-title">📰 新闻速递 隐私政策</text>
    <text class="privacy-date">生效日期：2025年7月1日</text>

    <text class="privacy-intro">欢迎使用新闻速递。我们高度重视用户隐私保护，本隐私政策旨在向您说明我们如何收集、使用和保护您的信息。</text>

    <view class="highlight-box">
      <text>⚡ 核心承诺：本应用不收集任何个人身份信息，不注册账号，不上传通讯录、位置、相册等敏感数据。</text>
    </view>

    <text class="section-title">一、我们收集的信息</text>
    <text class="section-text">本应用仅在以下场景涉及数据处理：</text>
    <text class="bullet">• 搜索关键词：您输入的关键词仅用于从公开新闻源（Google News RSS）获取新闻，关键词仅存储在您的设备本地，不会上传至任何服务器。</text>
    <text class="bullet">• 网络请求：应用向 Google News 发送搜索请求以获取新闻，该过程不包含任何用户标识信息。</text>

    <text class="section-title">二、信息的使用</text>
    <text class="bullet">• 搜索关键词仅用于实时检索公开新闻内容。</text>
    <text class="bullet">• 历史搜索关键词仅保存在您的设备本地存储中，用于方便您快速切换追踪主题。</text>
    <text class="bullet">• 我们不会将任何数据用于广告投放、用户画像或任何商业目的。</text>

    <text class="section-title">三、信息的存储与安全</text>
    <text class="bullet">• 您的搜索关键词和历史记录仅存储在设备本地。</text>
    <text class="bullet">• 卸载本应用后，所有本地数据将被自动清除。</text>
    <text class="bullet">• 本应用不设后端服务器，不进行用户注册，不保留任何用户数据。</text>

    <text class="section-title">四、第三方服务</text>
    <text class="bullet">• Google News：用于获取新闻内容</text>
    <text class="bullet">• uniCloud (DCloud)：用于云端定时任务</text>

    <text class="section-title">五、权限说明</text>
    <text class="bullet">• INTERNET：获取新闻数据</text>
    <text class="bullet">• ACCESS_NETWORK_STATE：检测网络状态</text>
    <text class="bullet">• WAKE_LOCK：保持后台定时刷新</text>
    <text class="bullet">• RECEIVE_BOOT_COMPLETED：设备重启后恢复定时任务</text>
    <text class="section-text" style="margin-top: 8px;">本应用不申请：相机、麦克风、通讯录、短信、位置、文件存储等敏感权限。</text>

    <text class="section-title">八、联系我们</text>
    <text class="bullet">• 邮箱：support@newsapp.example.com</text>

    <view class="bottom-space"></view>
  </scroll-view>
</template>

<script>
export default {}
</script>

<style scoped>
.privacy-container {
  padding: 40rpx 32rpx;
  background: #fff;
  min-height: 100vh;
}
.privacy-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #1a1a1a;
  display: block;
  text-align: center;
  margin-bottom: 12rpx;
}
.privacy-date {
  font-size: 24rpx;
  color: #999;
  display: block;
  text-align: center;
  margin-bottom: 40rpx;
}
.privacy-intro {
  font-size: 28rpx;
  color: #555;
  line-height: 1.8;
  display: block;
  margin-bottom: 24rpx;
}
.highlight-box {
  background: #eef0ff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 32rpx;
}
.highlight-box text {
  font-size: 26rpx;
  color: #4d6bfe;
  line-height: 1.6;
}
.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #4d6bfe;
  display: block;
  margin: 32rpx 0 12rpx;
}
.section-text {
  font-size: 26rpx;
  color: #666;
  line-height: 1.8;
  display: block;
  margin-bottom: 8rpx;
}
.bullet {
  font-size: 26rpx;
  color: #666;
  line-height: 1.8;
  display: block;
  padding-left: 8rpx;
}
.bottom-space {
  height: 80rpx;
}
</style>
