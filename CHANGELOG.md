## [1.22.0](https://github.com/WittF/chat-summarizer/compare/v1.21.0...v1.22.0) (2026-11-24)

### ✨ 功能更新

* 记下群里的戳一戳：谁戳了谁、什么时候，每次往当天的记录文件里追加一行（带 `notice: "poke"`，不进数据库、不算发言条数）；新开关 `chatLog.recordPoke`，默认开 ([afc6e01](https://github.com/WittF/chat-summarizer/commit/afc6e0158a0801cdbdbed6f562cf725a769b3a12))

## [1.21.0](https://github.com/WittF/chat-summarizer/compare/v1.20.0...v1.21.0) (2026-11-24)

### ✨ 功能更新

* 合并转发里的图片、视频和语音当场转存；转存失败按轮重试三次，最后还不行的记进失败清单；多记回复目标等字段 ([1823b31](https://github.com/WittF/chat-summarizer/commit/1823b31d938eae06547f0a6bb83ece7cf4019d47))

## [1.20.0](https://github.com/WittF/chat-summarizer/compare/v1.19.0...v1.20.0) (2026-11-24)

### ✨ 功能更新

* 存储桶不再需要公开读 ([a798fa9](https://github.com/WittF/chat-summarizer/commit/a798fa9588b2aeae7c77dfa8156e85ab804c037c))

## [1.19.0](https://github.com/WittF/chat-summarizer/compare/v1.18.0...v1.19.0) (2026-01-20)

### ✨ 功能更新

* 新增群组独立配置与卡片渲染功能 ([6035708](https://github.com/WittF/chat-summarizer/commit/6035708b3ac84f2c1ef01e583402821bb55bfe03))

## [1.18.0](https://github.com/WittF/chat-summarizer/compare/v1.17.0...v1.18.0) (2025-10-08)

### ✨ 功能更新

* **analysis:** 优化AI分析命令输出格式和日期处理 ([07e5583](https://github.com/WittF/chat-summarizer/commit/07e55832a963b76eca4bad8d67ee0b648b90a229))

## [1.17.0](https://github.com/WittF/chat-summarizer/compare/v1.16.0...v1.17.0) (2025-10-07)

### ✨ 功能更新

* **ai:** 添加AI聊天记录分析功能，支持自然语言查询并返回分析结果，更新命令处理逻辑以支持管理员使用 ([fa0e32d](https://github.com/WittF/chat-summarizer/commit/fa0e32d08a9572b5edcc5926d4e5365948e923d1))
* **commands:** 添加获取AI总结图片的命令，支持指定日期和群组，优化日期解析功能 ([8dbaf6f](https://github.com/WittF/chat-summarizer/commit/8dbaf6f89f4b6fb6c2721c8d9cc2a188f68fb7cc))

## [1.16.0](https://github.com/WittF/chat-summarizer/compare/v1.15.0...v1.16.0) (2025-08-25)

### ✨ 功能更新

* **cleanup:** 优化本地文件清理功能，基于文件修改时间删除过期.jsonl文件 ([0652108](https://github.com/WittF/chat-summarizer/commit/0652108aaded9e1ef2875b709ab851389dae3c5f))
* **commands:** 添加AI总结管理命令，支持检查缺失总结和重新生成总结功能 ([200f751](https://github.com/WittF/chat-summarizer/commit/200f75195cdd7083181f9ff8d303a175acfcc7fc))

### 🐛 Bug修复

* **readme:** 更新readme.md中的命令示例，修正导出今天文本消息的命令格式 ([e8ea37b](https://github.com/WittF/chat-summarizer/commit/e8ea37b42479132666941c4afad73b8ad6c05950))

## [1.15.0](https://github.com/WittF/chat-summarizer/compare/v1.14.0...v1.15.0) (2025-07-17)

### ✨ 功能更新

* **config:** 更新聊天记录分析助手的提示词，调整分析要求以更好地适应群聊氛围 ([34784dc](https://github.com/WittF/chat-summarizer/commit/34784dc267df7217ce5520d7fd3785e169a0e031))

### 🐛 Bug修复

* **upload:** 在上传超时警告中添加调试配置检查，以便在调试模式下记录超时信息 ([d269c58](https://github.com/WittF/chat-summarizer/commit/d269c5872a3a35796f480ef1f153381d9f9d8d2f))

## [1.14.0](https://github.com/WittF/chat-summarizer/compare/v1.13.6...v1.14.0) (2025-07-13)

### ✨ 功能更新

* **config:** 添加自动总结功能配置，更新数据库结构以支持AI总结，增加自动总结调度器 ([28cd353](https://github.com/WittF/chat-summarizer/commit/28cd353bac574821fbdd4e4de22e2331dcfec962))

## [1.13.6](https://github.com/WittF/chat-summarizer/compare/v1.13.5...v1.13.6) (2025-07-13)

### 🐛 Bug修复

* **export:** 完全重写文件处理逻辑，优化数据源选择，优先使用本地文件并减少S3调用次数 ([b1549d2](https://github.com/WittF/chat-summarizer/commit/b1549d293cc7749eebec6dda326a616a97217a14))

## [1.13.5](https://github.com/WittF/chat-summarizer/compare/v1.13.4...v1.13.5) (2025-07-13)

### 🐛 Bug修复

* **export:** 优化文件下载逻辑，避免重复下载已存在的本地文件 ([16ce42d](https://github.com/WittF/chat-summarizer/commit/16ce42d53ee3a853518659e84312a2f485e399f7))

## [1.13.4](https://github.com/WittF/chat-summarizer/compare/v1.13.3...v1.13.4) (2025-07-13)

### 🐛 Bug修复

* **md-to-image:** 更新emoji图片源为BootCDN，以提高国内访问稳定性 ([c4944fe](https://github.com/WittF/chat-summarizer/commit/c4944fe5aeced409387ad0693a98a27a81dc85e3))

## [1.13.3](https://github.com/WittF/chat-summarizer/compare/v1.13.2...v1.13.3) (2025-07-06)

### 🐛 Bug修复

* **ai-service:** 修复群组配置匹配逻辑，确保每个群使用各自的专用prompt配置 ([3a3265d](https://github.com/WittF/chat-summarizer/commit/3a3265dc6d938f432be13d32efdb176052ebeb72))

## [1.13.2](https://github.com/WittF/chat-summarizer/compare/v1.13.1...v1.13.2) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 简化emoji处理逻辑，优化加载失败时的fallback机制，使用基本字符转义替代原始emoji ([5bc5d2e](https://github.com/WittF/chat-summarizer/commit/5bc5d2eb8df6986267e06bf04bf90b513e07dd92))

## [1.13.1](https://github.com/WittF/chat-summarizer/compare/v1.13.0...v1.13.1) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 优化emoji加载失败处理逻辑，添加fallback机制以替换未加载成功的emoji为文本 ([3d1bd69](https://github.com/WittF/chat-summarizer/commit/3d1bd69bea4edebfc82fc463753c127cc10210d1))

## [1.13.0](https://github.com/WittF/chat-summarizer/compare/v1.12.0...v1.13.0) (2025-07-06)

### ✨ 功能更新

* **database:** 扩展数据库模型以支持聊天记录文件上传，新增相关操作方法 ([e79712d](https://github.com/WittF/chat-summarizer/commit/e79712d22f6792dd720043ddbd12ba508d7be403))

## [1.12.0](https://github.com/WittF/chat-summarizer/compare/v1.11.2...v1.12.0) (2025-07-06)

### ✨ 功能更新

* **md-to-image:** 优化emoji处理逻辑，使用正则表达式动态转换emoji为CDN图片，并添加获取emoji Unicode码点的功能 ([ba47ca9](https://github.com/WittF/chat-summarizer/commit/ba47ca98d725ad99441a5c6d510506f43aea17c0))

## [1.11.2](https://github.com/WittF/chat-summarizer/compare/v1.11.1...v1.11.2) (2025-07-06)

### ♻️ 代码重构

* **emoji:** 恢复使用CDN emoji图片替代本地文件方案 ([309f8fc](https://github.com/WittF/chat-summarizer/commit/309f8fc702a58fc8f9d334e3710d851286748f8b))

## [1.11.1](https://github.com/WittF/chat-summarizer/compare/v1.11.0...v1.11.1) (2025-07-06)

### 🐛 Bug修复

* **s3-uploader:** 修复S3上传卡住导致消息处理阻塞的问题 ([b409b65](https://github.com/WittF/chat-summarizer/commit/b409b654b7d36fc082d153cb4c50d51d1373a1d4))

## [1.11.0](https://github.com/WittF/chat-summarizer/compare/v1.10.0...v1.11.0) (2025-07-06)

### ✨ 功能更新

* **md-to-image:** 更新构建脚本以支持本地emoji和字体文件的复制 ([870f303](https://github.com/WittF/chat-summarizer/commit/870f3034724504111a8559798524c633558f3607))

## [1.10.0](https://github.com/WittF/chat-summarizer/compare/v1.9.9...v1.10.0) (2025-07-06)

### ✨ 功能更新

* **md-to-image:** 将emoji字体方案改为CDN图片方案 ([8540655](https://github.com/WittF/chat-summarizer/commit/8540655ca68d172c839f136e69b64c36243f5068))

## [1.9.9](https://github.com/WittF/chat-summarizer/compare/v1.9.8...v1.9.9) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 增加渲染队列管理，优化并发渲染处理逻辑 ([eee1ba3](https://github.com/WittF/chat-summarizer/commit/eee1ba308a29e23bbf9ad05f3a907a11b9936c37))

## [1.9.8](https://github.com/WittF/chat-summarizer/compare/v1.9.7...v1.9.8) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 更新字体CSS生成逻辑，支持Google Fonts并优化emoji字体加载策略 ([062fb8d](https://github.com/WittF/chat-summarizer/commit/062fb8d0db4ad8a5b4af82686b3e9f8eb3f3ca7f))

## [1.9.7](https://github.com/WittF/chat-summarizer/compare/v1.9.6...v1.9.7) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 更新emoji字体样式，移除unicode-range限制并优化渲染测试逻辑 ([b695d67](https://github.com/WittF/chat-summarizer/commit/b695d676951d7e3f473d862828c56d3470d7be85))

## [1.9.6](https://github.com/WittF/chat-summarizer/compare/v1.9.5...v1.9.6) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 修改字体加载顺序，优先使用emoji字体渲染 ([a00fb24](https://github.com/WittF/chat-summarizer/commit/a00fb24c5f50bb91c70933367dd3f2d705a5e41d))

## [1.9.5](https://github.com/WittF/chat-summarizer/compare/v1.9.4...v1.9.5) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 优化emoji字体加载逻辑，增加mdtest指令用于验证 ([6b0fc15](https://github.com/WittF/chat-summarizer/commit/6b0fc15a9d494d61aca5ca8c1b03304c0a7b271b))

## [1.9.4](https://github.com/WittF/chat-summarizer/compare/v1.9.3...v1.9.4) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 优化字体加载逻辑，增加多路径尝试和文件大小检查 ([0f49937](https://github.com/WittF/chat-summarizer/commit/0f499373a0e5cf24e3cddead6e4fbd3d0137b189))

## [1.9.3](https://github.com/WittF/chat-summarizer/compare/v1.9.2...v1.9.3) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 优化字体加载逻辑，增加备用路径尝试和字体加载状态检查 ([944a6c7](https://github.com/WittF/chat-summarizer/commit/944a6c756d04dfb88a0c163fcb1f793e47b823e6))

## [1.9.2](https://github.com/WittF/chat-summarizer/compare/v1.9.1...v1.9.2) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 修改字体加载策略，将font-display属性从swap更改为block，并增加字体加载超时时间至15000ms ([d51c405](https://github.com/WittF/chat-summarizer/commit/d51c4055d97e61cf5899b3accff57d83443dae7f))

## [1.9.1](https://github.com/WittF/chat-summarizer/compare/v1.9.0...v1.9.1) (2025-07-06)

### 🐛 Bug修复

* 优化文件上传逻辑，增加并行上传和超时控制，增强emoji字体加载兼容性 ([c5610b5](https://github.com/WittF/chat-summarizer/commit/c5610b50501613a451bc2bc3fddee3cddc5b9c70))

## [1.9.0](https://github.com/WittF/chat-summarizer/compare/v1.8.2...v1.9.0) (2025-07-06)

### ✨ 功能更新

* **md-to-image:** 增加本地字体支持，优化字体加载和CSS生成 ([9fcb3df](https://github.com/WittF/chat-summarizer/commit/9fcb3dfec83bfda3d3ad3e3d097f212f53229ebb))

## [1.8.2](https://github.com/WittF/chat-summarizer/compare/v1.8.1...v1.8.2) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 增强emoji字体兼容性，优化字体加载和渲染效果 ([affa0fb](https://github.com/WittF/chat-summarizer/commit/affa0fb4c8b6e2b0999ef5aec98dbc52dc0e4d76))

## [1.8.1](https://github.com/WittF/chat-summarizer/compare/v1.8.0...v1.8.1) (2025-07-06)

### 🐛 Bug修复

* **md-to-image:** 移除截图质量设置，优化图片生成性能 ([d18d466](https://github.com/WittF/chat-summarizer/commit/d18d4664573c433a1b020105707714fbb9b5bb09))

## [1.8.0](https://github.com/WittF/chat-summarizer/compare/v1.7.0...v1.8.0) (2025-07-06)

### ✨ 功能更新

* 发布新版本，增强AI服务配置，支持群组专用设置 ([6bebcf1](https://github.com/WittF/chat-summarizer/commit/6bebcf1b575e0de840fa6d9e6e3f1f16d504b22a))

### 🐛 Bug修复

* **md-to-image:** 将page.waitForTimeout() 替换为标准的Promise + setTimeout实现 ([96c6be5](https://github.com/WittF/chat-summarizer/commit/96c6be5f4c1dbad1056906eee8587795d1f332c0))

## [1.7.0](https://github.com/WittF/chat-summarizer/compare/v1.6.0...v1.7.0) (2025-07-06)

### ✨ 功能更新

* **file-writer:** 引入安全文件写入器，优化文件写入和更新逻辑 ([6a6190e](https://github.com/WittF/chat-summarizer/commit/6a6190e028518e8406362dfc08c1061e7cb224f9))
* **md-to-image:** 优化Markdown转图片功能，增加对数字和标点符号的字体处理，修复emoji显示问题 ([b6fef22](https://github.com/WittF/chat-summarizer/commit/b6fef22277b141c9785045c8cb463c958df7b597))
* **md-to-image:** 增强Markdown转图片功能，优化视口设置和字体渲染，提升图片质量 ([0f475fd](https://github.com/WittF/chat-summarizer/commit/0f475fdee83ea66439b4fd18a20039715677d699))

## [1.6.0](https://github.com/WittF/chat-summarizer/compare/v1.5.0...v1.6.0) (2025-07-06)

### ✨ 功能更新

* **message:** 添加小程序分享卡片解析 ([559938a](https://github.com/WittF/chat-summarizer/commit/559938a9acc6252a176f723f7eacbc5d9c8b9c70))

## [1.5.0](https://github.com/WittF/chat-summarizer/compare/v1.4.1...v1.5.0) (2025-07-06)

### ✨ 功能更新

* **md-to-image:** 增加对Noto Color Emoji字体的支持，并优化字体加载逻辑 ([9923f62](https://github.com/WittF/chat-summarizer/commit/9923f62843c5b31da491696ba1f8329600ff39d0))

## [1.4.1](https://github.com/WittF/chat-summarizer/compare/v1.4.0...v1.4.1) (2025-07-06)

### 🐛 Bug修复

* 触发1.4.1版本发布 ([555308b](https://github.com/WittF/chat-summarizer/commit/555308ba720ab67f95ca79a80a51b6e99b206929))

## [1.4.0](https://github.com/WittF/chat-summarizer/compare/v1.3.0...v1.4.0) (2025-07-06)

### ✨ 功能更新

* **ai:** 优化AI总结图片输出功能，使用Koishi puppeteer生成GitHub样式markdown图片 ([dee8d84](https://github.com/WittF/chat-summarizer/commit/dee8d84b9ffc37d247755540cfaf5a406db761cc))
* **commands:** 优化图片生成失败处理，新增合并转发功能以发送AI总结 ([408fc2f](https://github.com/WittF/chat-summarizer/commit/408fc2fc9f5cc650272df05748501f8b1fddc0b3))
* **md-to-image:** 更新Markdown转图片功能，增加h3和h4样式支持，并优化字体设置 ([6d7e8ee](https://github.com/WittF/chat-summarizer/commit/6d7e8ee08ad92eb16cf50040c4a1db535e0fc076))

### 🐛 Bug修复

* **release:** 修复错误的Git记录和版本号 ([aa5dade](https://github.com/WittF/chat-summarizer/commit/aa5dadec51235de2faccf3db565aea6e9f22629c))
* **release:** 修复错误的Git记录和版本号 ([7686eb2](https://github.com/WittF/chat-summarizer/commit/7686eb2c656d572468427105b1c726e4568ef209))
* **release:** 修复错误的Git记录和版本号 ([5b7f0ad](https://github.com/WittF/chat-summarizer/commit/5b7f0ad4e29252c79be49e558db0bc9f9b49661e))
* 修复emoji显示乱码和####标题处理问题 ([5cfdb06](https://github.com/WittF/chat-summarizer/commit/5cfdb069dda92a5b48751e97d6279d117e57d320))
* 修复emoji显示乱码和####标题处理问题 ([effae61](https://github.com/WittF/chat-summarizer/commit/effae6119642d0f1b016b10e3d2bf1ddf486822f))

### 🔧 其他更改

* **release:** 1.4.0 [skip ci] ([4c60955](https://github.com/WittF/chat-summarizer/commit/4c60955eb430c07e8b866ef43c3f7cf545d5aca6))
* **release:** 1.4.0 [skip ci] ([b57568d](https://github.com/WittF/chat-summarizer/commit/b57568da4ec97699d64e09bb55dd72ab1dea0f50))
* **release:** 1.4.0 [skip ci] ([90d145a](https://github.com/WittF/chat-summarizer/commit/90d145a48f16f703677dca8007350c6586d6a9cc))

## [1.4.0](https://github.com/WittF/chat-summarizer/compare/v1.3.0...v1.4.0) (2025-07-06)

### ✨ 功能更新

* **ai:** 优化AI总结图片输出功能，使用Koishi puppeteer生成GitHub样式markdown图片 ([dee8d84](https://github.com/WittF/chat-summarizer/commit/dee8d84b9ffc37d247755540cfaf5a406db761cc))
* **commands:** 优化图片生成失败处理，新增合并转发功能以发送AI总结 ([408fc2f](https://github.com/WittF/chat-summarizer/commit/408fc2fc9f5cc650272df05748501f8b1fddc0b3))
* **md-to-image:** 更新Markdown转图片功能，增加h3和h4样式支持，并优化字体设置 ([6d7e8ee](https://github.com/WittF/chat-summarizer/commit/6d7e8ee08ad92eb16cf50040c4a1db535e0fc076))

### 🐛 Bug修复

* **release:** 修复错误的Git记录和版本号 ([7686eb2](https://github.com/WittF/chat-summarizer/commit/7686eb2c656d572468427105b1c726e4568ef209))
* **release:** 修复错误的Git记录和版本号 ([5b7f0ad](https://github.com/WittF/chat-summarizer/commit/5b7f0ad4e29252c79be49e558db0bc9f9b49661e))

### 🔧 其他更改

* **release:** 1.4.0 [skip ci] ([b57568d](https://github.com/WittF/chat-summarizer/commit/b57568da4ec97699d64e09bb55dd72ab1dea0f50))
* **release:** 1.4.0 [skip ci] ([90d145a](https://github.com/WittF/chat-summarizer/commit/90d145a48f16f703677dca8007350c6586d6a9cc))

## [1.4.0](https://github.com/WittF/chat-summarizer/compare/v1.3.0...v1.4.0) (2025-07-06)

### ✨ 功能更新

* **ai:** 优化AI总结图片输出功能，使用Koishi puppeteer生成GitHub样式markdown图片 ([dee8d84](https://github.com/WittF/chat-summarizer/commit/dee8d84b9ffc37d247755540cfaf5a406db761cc))
* **commands:** 优化图片生成失败处理，新增合并转发功能以发送AI总结 ([408fc2f](https://github.com/WittF/chat-summarizer/commit/408fc2fc9f5cc650272df05748501f8b1fddc0b3))
* **md-to-image:** 更新Markdown转图片功能，增加h3和h4样式支持，并优化字体设置 ([6d7e8ee](https://github.com/WittF/chat-summarizer/commit/6d7e8ee08ad92eb16cf50040c4a1db535e0fc076))

### 🐛 Bug修复

* **release:** 修复错误的Git记录和版本号 ([5b7f0ad](https://github.com/WittF/chat-summarizer/commit/5b7f0ad4e29252c79be49e558db0bc9f9b49661e))

### 🔧 其他更改

* **release:** 1.4.0 [skip ci] ([90d145a](https://github.com/WittF/chat-summarizer/commit/90d145a48f16f703677dca8007350c6586d6a9cc))

## [1.4.0](https://github.com/WittF/chat-summarizer/compare/v1.3.0...v1.4.0) (2025-07-06)

### ✨ 功能更新

* **ai:** 优化AI总结图片输出功能，使用Koishi puppeteer生成GitHub样式markdown图片 ([dee8d84](https://github.com/WittF/chat-summarizer/commit/dee8d84b9ffc37d247755540cfaf5a406db761cc))
* **commands:** 优化图片生成失败处理，新增合并转发功能以发送AI总结 ([408fc2f](https://github.com/WittF/chat-summarizer/commit/408fc2fc9f5cc650272df05748501f8b1fddc0b3))

### 🐛 Bug修复

* **release:** 修复错误的Git记录和版本号 ([5b7f0ad](https://github.com/WittF/chat-summarizer/commit/5b7f0ad4e29252c79be49e558db0bc9f9b49661e))

## [1.3.0](https://github.com/WittF/chat-summarizer/compare/v1.2.0...v1.3.0) (2025-07-06)

### ✨ 功能更新

* **ai:** 添加AI总结功能，支持聊天记录导出时生成AI总结并可选择以图片形式发送 ([3a4a999](https://github.com/WittF/chat-summarizer/commit/3a4a999240356505a7685c5edb9a6ca80ac62115))
* **database:** 添加视频记录支持，扩展数据库模型以存储视频信息并实现视频上传功能 ([bc0879a](https://github.com/WittF/chat-summarizer/commit/bc0879a2fcb575ae1d80deb093ebcdeac6da63d1))
* **export:** 优化导出功能，添加简化时间格式和URL替换 ([f820700](https://github.com/WittF/chat-summarizer/commit/f82070083e50b247e07f37f70880a398d30abfce))
* **reply:** 修改addReplyPrefix函数为异步，支持从数据库获取已处理的回复内容 ([4d29fc6](https://github.com/WittF/chat-summarizer/commit/4d29fc693c0fb0677241614e26105de01955a2a8))

## [1.2.0](https://github.com/WittF/chat-summarizer/compare/v1.1.0...v1.2.0) (2025-07-06)

### ✨ 功能更新

* **commands:** 优化S3链接信息的格式，移除多余的换行符 ([b2c8270](https://github.com/WittF/chat-summarizer/commit/b2c82708f0ff84d373aa379e76d3ae0481631e05))
* **database:** 添加数据库自动清理机制，将数据库用作24小时缓存 ([32d2606](https://github.com/WittF/chat-summarizer/commit/32d2606770c21fd76ec56faf30da6a48440e9a77))
* **export:** 添加cs.export命令，支持智能导出历史聊天记录 ([1306c50](https://github.com/WittF/chat-summarizer/commit/1306c506728568831cb4a2b0497a05fa23bd3f06))

### 🐛 Bug修复

* **commands:** 优化cs.geturl命令错误提示，明确说明数据库缓存限制 ([6b835a1](https://github.com/WittF/chat-summarizer/commit/6b835a12c19d2c2e8eb62e9709812d2c5da677cc))

### 🔧 其他更改

* **readme:** 移除开发部分内容，更新文档结构 ([619df1b](https://github.com/WittF/chat-summarizer/commit/619df1ba2515e540920a7528a433d181c14cd6a3))

## [1.1.0](https://github.com/WittF/chat-summarizer/compare/v1.0.0...v1.1.0) (2025-07-06)

### ✨ 功能更新

* **admin:** 添加管理员配置和获取S3链接命令 ([c6e66b9](https://github.com/WittF/chat-summarizer/commit/c6e66b9628a51740fcb0a11d9f1d806aa8af9426))
* **config:** 更新聊天记录配置，添加最大文件大小限制并优化S3配置描述 ([bc4a048](https://github.com/WittF/chat-summarizer/commit/bc4a048eb461bfdbe6537bce2993c14d35f3d941))

### 🐛 Bug修复

* **release:** 移除不存在的package-lock.json引用 ([7d48edc](https://github.com/WittF/chat-summarizer/commit/7d48edc369e425c4f49d8a28f47d91d02683143f))

## 1.0.0 (2025-07-06)

### ✨ 功能更新

* **chat-summarizer:** 扩展文件上传支持并优化存储结构 ([320e44a](https://github.com/WittF/chat-summarizer/commit/320e44a35d36ba6a15c306d3fb4cd5036ece401e))
* **plugins:** 初始化Koishi插件集合，包含聊天记录、账号绑定、管理工具等核心功能 ([9090f5a](https://github.com/WittF/chat-summarizer/commit/9090f5a3e6d4e6b04e0c0c579b8bdc4f28a23f30))
* 引入semantic-release自动化发布流程 ([03671d2](https://github.com/WittF/chat-summarizer/commit/03671d2f4e33e229306eb1264a5aebc3a97a6c56))

### 🐛 Bug修复

* **build:** 移除yml-register类型定义依赖 ([f7d161c](https://github.com/WittF/chat-summarizer/commit/f7d161c27c62bbabcf526518f4c9025f862ab413))
* **ci:** 使用npm install替代npm ci避免依赖锁文件问题 ([87d305a](https://github.com/WittF/chat-summarizer/commit/87d305a5f14b00c0b0a8a8002c592f1a5909a364))
* **ci:** 移除npm缓存配置避免lockfile依赖 ([d7a6fa2](https://github.com/WittF/chat-summarizer/commit/d7a6fa21586b3093882b3d1a703ceb89978e7455))
* **deps:** 添加缺失的conventional-changelog-conventionalcommits依赖 ([bac8720](https://github.com/WittF/chat-summarizer/commit/bac8720a140c16d8a70cf64e1a0505bab749db3b))

### ♻️ 代码重构

* **chat-summarizer:** 消除重复实现并优化代码结构 ([c84a32c](https://github.com/WittF/chat-summarizer/commit/c84a32c93074254cc74bdff6cc2d7a8edb63d759))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 初始版本的聊天记录收集和上传功能
- S3 兼容存储支持
- 图片和文件自动上传
- 定时任务自动上传聊天记录
- 完整的错误处理和日志记录

### Changed
- 重构代码结构，消除重复实现
- 优化时间处理，统一使用 UTC+8 时区
- 改进错误处理机制

### Technical
- 创建公共工具函数模块
- 统一 JSON 处理和错误处理
- 添加类型安全保障
- 引入自动化发布流程
