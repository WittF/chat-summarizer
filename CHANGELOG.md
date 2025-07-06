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
