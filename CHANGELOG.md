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