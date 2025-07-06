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

## 🚀 功能说明

- **消息处理**: 自动收集群聊消息（跳过私聊），解析图片和文件链接
- **文件上传**: 支持图片、文档、压缩包、音视频等多种格式
- **存储结构**: 按日期和群组组织，便于管理和查找
- **定时任务**: 每日自动上传前一天的聊天记录
- **数据库缓存**: 数据库仅保留24小时记录作为缓存，避免性能问题

## 📚 API

### 命令

- `cs.status`: 查看插件状态
- `cs.geturl`: 获取回复消息中图片/文件的S3链接（仅管理员可用）
  - 使用方法：回复包含图片或文件的消息，然后发送 `cs.geturl` 命令
  - 权限要求：需要在配置中的 `admin.adminIds` 列表中
  - ⚠️ 限制：只能查询最近24小时内的消息（数据库缓存期限）
- `cs.export <群组> <时间范围> [格式]`: 导出指定时间范围的聊天记录（仅管理员可用）
  - 群组参数：
    - `current` - 当前群（仅在群聊中有效）
    - `123456789` - 具体群号
    - `private` - 私聊记录
  - 时间范围：
    - 预设：`today`, `yesterday`, `last7days`, `lastweek`, `thismonth`, `lastmonth`
    - 具体日期：`2024-01-01` 或 `2024-01-01,2024-01-31`
    - 简化格式：`01-01` 或 `01-01,01-31`（当年）
  - 格式：`json`（默认）、`txt`、`csv`
  - 数据来源：优先本地文件，然后从S3下载
  - ⚠️ 完整性要求：必须所有日期的数据都存在才会导出，否则拒绝部分导出

### 使用示例

1. **获取S3链接**：
   ```
   [用户A发送了包含图片的消息]
   [管理员B回复该消息]: cs.geturl
   [机器人返回]: 🖼️ 图片链接:
                 1. https://your-s3-domain.com/images/2024-01-01/group_123/msg_456.jpg
   ```

2. **查看插件状态**：
   ```
   cs.status
   ```

3. **导出聊天记录**：
   ```
   cs.export current yesterday        # 导出当前群昨天的记录（JSON格式）
   cs.export 123456789 last7days txt # 导出指定群最近7天记录为文本格式
   cs.export current 2024-01-01,2024-01-31 csv # 导出当前群1月份记录为CSV格式
   cs.export private thismonth       # 导出本月私聊记录
   ```

