# 新闻速递 📰

基于 uni-app + uniCloud 的关键词新闻聚合应用。输入关键词，每10分钟自动抓取最新新闻，支持 Android / iOS / 鸿蒙 / H5 / 小程序。

## 功能特性

- 🔍 **关键词搜索** — 输入任意关键词，精准搜索相关新闻
- 🔗 **网址直达** — 新闻列表展示原文链接，一键复制/打开/分享
- 📋 **历史关键词** — 自动保存搜索历史，点击即可切换
- 🔎 **Bing 搜索** — 主力搜索源，任意关键词都能搜到
- 📡 **多源兜底** — 人民网/中新网/界面新闻 RSS 补充
- 🤖 **AI 兜底** — 搜不到时由 AI 智能回答
- 📱 **多端打包** — HBuilderX 一键打包 Android / iOS / 鸿蒙 / H5 / 小程序

## 新闻源策略

| 优先级 | 来源 | 关键词搜索 | 说明 |
|-------|------|-----------|------|
| 主力 | Bing 新闻 RSS | ✅ 支持 | 免费，格式 `?q=关键词&format=RSS` |
| 兜底 | 人民网 RSS | ❌ 仅频道 | 时政要闻 100 条 |
| 兜底 | 中国新闻网 RSS | ❌ 仅频道 | 即时新闻 30 条 |
| 兜底 | 中新网财经 RSS | ❌ 仅频道 | 财经新闻 30 条 |
| 兜底 | 界面新闻 RSS | ❌ 仅频道 | 商业财经 30 条 |
| 兜底 | AI（DeepSeek/豆包） | ✅ 支持 | 搜索无结果时智能回答 |

### 已废弃的源（实测不可用）

| 来源 | 原因 |
|------|------|
| 百度新闻抓取 | 返回「百度安全验证」反爬页 |
| 搜狗 / 360 / 头条搜索 | 结果 JS 动态渲染，HTML 无法解析 |
| Google News | 国内网络不可达 |
| 东方财富 / 网易 RSS | 403 反爬 |

## 项目结构

```
news-app/
├── pages/
│   ├── index/index.vue          # 主页：关键词输入 + 新闻列表
│   └── detail/detail.vue        # 新闻详情页
├── uniCloud-aliyun/
│   ├── cloudfunctions/
│   │   ├── news-fetcher/        # 定时云函数：每10分钟抓取
│   │   └── news-api/            # 查询云函数：实时搜索接口
│   └── database/
│       └── schema.json          # 数据库表结构
├── utils/
│   └── api.js                   # 新闻API工具模块
├── store/
│   └── index.js                 # 状态管理
├── static/                      # 静态资源（logo等）
├── App.vue                      # 应用入口
├── main.js                      # Vue初始化
├── pages.json                   # 页面路由配置
├── manifest.json                # 应用打包配置
└── uni.scss                     # 全局样式变量
```

## 快速开始

### 1. 环境准备

- 下载安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（最新版）
- 注册 [DCloud 开发者账号](https://dev.dcloud.net.cn/)
- （可选）注册 [GNews](https://gnews.io/) 获取备用 API Key

### 2. 导入项目

1. 打开 HBuilderX
2. 文件 → 导入 → 从本地目录导入
3. 选择 `news-app/` 文件夹

### 3. 配置 uniCloud

1. 右键项目根目录 → 创建 uniCloud 云开发环境
2. 选择阿里云或腾讯云
3. 在 uniCloud 控制台创建以下数据表：
   - `news_articles` — 新闻数据表
   - `user_keywords` — 关键词追踪表
4. 右键 `uniCloud-aliyun/cloudfunctions/news-fetcher/` → 上传部署
5. 右键 `uniCloud-aliyun/cloudfunctions/news-api/` → 上传部署

### 4. 定时触发器（已移除）

`news-fetcher` 的定时触发器**已移除**，不再自动执行。

原配置为每 10 分钟跑一次，即使不打开 App 也会持续消耗云函数额度（约 4320 次/月），因此已关闭。

现在搜索完全由用户手动触发，走 `news-api` 云函数，不做任何后台轮询。

### 5. （可选）配置 GNews 备用源

1. 前往 [gnews.io](https://gnews.io/) 注册免费账号
2. 获取 API Key
3. 在 uniCloud 控制台 → 云函数 → news-fetcher → 环境变量，添加：
   - 变量名：`GNEWS_API_KEY`
   - 变量值：你的 API Key
4. 或在 `utils/api.js` 中设置 `GNEWS_API_KEY`

### 6. 运行调试

- **H5 调试**：运行 → 运行到浏览器
- **APP 调试**：运行 → 运行到手机或模拟器
- **小程序调试**：运行 → 运行到微信开发者工具

### 7. 打包上架

1. HBuilderX → 发行 → 原生 App-云打包
2. 配置应用图标（替换 `static/logo.png`）
3. 配置启动图
4. 填写应用信息
5. 打包生成 APK / IPA
6. 上传至各大应用市场

## 数据表结构

### news_articles（新闻数据表）

| 字段 | 类型 | 说明 |
|------|------|------|
| title | String | 新闻标题 |
| link | String | 新闻链接（去重键） |
| pubDate | String | 发布时间 |
| source | String | 来源名称 |
| description | String | 摘要 |
| keyword | String | 搜索关键词 |
| fetchedAt | String | 抓取时间 |
| createdAt | String | 入库时间 |

### user_keywords（关键词表）

| 字段 | 类型 | 说明 |
|------|------|------|
| keyword | String | 追踪关键词 |
| active | Boolean | 是否激活 |
| createdAt | String | 创建时间 |

## 技术栈

- **框架**: uni-app (Vue3)
- **云服务**: uniCloud (阿里云/腾讯云)
- **新闻源**: Bing 新闻 RSS + 人民网/中新网/界面新闻 RSS
- **状态管理**: Vue3 reactive
- **打包工具**: HBuilderX

## License

MIT
