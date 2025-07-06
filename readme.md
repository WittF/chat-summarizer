# koishi-plugin-chat-summarizer

[![semantic-release: angular](https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![npm version](https://badge.fury.io/js/koishi-plugin-chat-summarizer.svg)](https://badge.fury.io/js/koishi-plugin-chat-summarizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Koishi 聊天记录收集和上传插件

一个功能完整的 Koishi 插件，用于收集、处理和上传聊天记录到 S3 兼容存储。

## ✨ 特性

- 📝 **聊天记录收集**: 自动收集群聊消息并保存到本地
- 🖼️ **图片处理**: 自动上传图片到 S3 存储并替换链接
- 📎 **文件上传**: 支持 60+ 种文件格式的自动上传
- ⏰ **定时任务**: 可配置的自动上传时间
- 🗃️ **数据管理**: 完整的数据库记录和本地文件管理
- 🛡️ **错误处理**: 健壮的错误处理和重试机制
- 🌐 **S3 兼容**: 支持 AWS S3、MinIO 等 S3 兼容存储

## 📦 安装

```bash
npm install koishi-plugin-chat-summarizer
```

## ⚙️ 配置

### S3 存储配置

```yaml
s3:
  enabled: true
  bucket: your-bucket-name
  accessKeyId: your-access-key
  secretAccessKey: your-secret-key
  endpoint: https://your-s3-endpoint.com  # 可选，用于 MinIO 等
  pathPrefix: chat-logs  # 存储路径前缀
```

### 聊天记录配置

```yaml
chatLog:
  enabled: true
  includeImages: true
  autoUploadTime: "02:00"  # 自动上传时间
  retentionDays: 3  # 本地文件保留天数
```

### 监控配置

```yaml
monitor:
  enabledGroups: []  # 监控的群组 ID，空数组表示监控所有群组
  excludedUsers: []  # 排除的用户 QQ 号
  excludeBots: true  # 是否排除机器人消息
```

### 管理员配置

```yaml
admin:
  adminIds: ["123456789", "987654321"]  # 管理员QQ号列表
```

## 🚀 功能说明

- **消息处理**: 自动收集群聊消息（跳过私聊），解析图片和文件链接
- **文件上传**: 支持图片、文档、压缩包、音视频等多种格式
- **存储结构**: 按日期和群组组织，便于管理和查找
- **定时任务**: 每日自动上传前一天的聊天记录

## 📚 API

### 命令

- `cs.status`: 查看插件状态
- `cs.geturl`: 获取回复消息中图片/文件的S3链接（仅管理员可用）
  - 使用方法：回复包含图片或文件的消息，然后发送 `cs.geturl` 命令
  - 权限要求：需要在配置中的 `admin.adminIds` 列表中

### 使用示例

1. **获取S3链接**：
   ```
   [用户A发送了包含图片的消息]
   [管理员B回复该消息]: cs.geturl
   [机器人返回]: 📋 S3链接信息:
                 🖼️ 图片链接:
                 1. https://your-s3-domain.com/images/2024-01-01/group_123/msg_456.jpg
   ```

2. **查看插件状态**：
   ```
   cs.status
   ```

## 🛠️ 开发

### 构建

```bash
npm run build
```

### 发布

本项目使用 [semantic-release](https://github.com/semantic-release/semantic-release) 自动化发布。

提交消息格式：
- `feat:` 新功能
- `fix:` 修复
- `refactor:` 重构
- `docs:` 文档
- `style:` 样式
- `perf:` 性能优化

## 📄 许可证

[MIT](./LICENSE) © 2025

## 🔗 相关链接

- [Koishi 官方文档](https://koishi.chat/)
- [Semantic Release](https://github.com/semantic-release/semantic-release)
- [AWS S3 文档](https://docs.aws.amazon.com/s3/)


