# koishi-plugin-chat-summarizer

[![npm](https://img.shields.io/npm/v/koishi-plugin-chat-summarizer?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-chat-summarizer)

一个用于收集、处理和自动上传聊天记录到S3存储的Koishi插件。

## 主要功能

- 📝 **聊天记录收集** - 实时监控并记录群组和私聊消息
- 📊 **消息处理** - 支持文本、图片、表情、骰子、包剪锤等多种消息元素
- 📤 **自动上传** - 定时上传聊天记录到S3兼容存储
- 🖼️ **图片处理** - 自动上传图片到云存储并替换链接
- 💾 **数据备份** - 本地文件备份 + 数据库存储双重保障
- 🔄 **防重复** - 智能检测避免重复上传

## 基本配置

```yaml
# S3存储配置
s3:
  enabled: true
  bucket: your-bucket-name
  accessKeyId: your-access-key
  secretAccessKey: your-secret-key
  endpoint: https://your-s3-endpoint.com
  pathPrefix: logs/

# 聊天记录配置
chatLog:
  enabled: true
  autoUploadTime: "04:00"
  retentionDays: 7

# 监控配置
monitor:
  enabledGroups: []        # 空数组表示监控所有群组
  excludedUsers: []        # 排除的用户QQ号
  excludeBots: true        # 排除机器人消息
```

## 使用命令

- `cs.status` - 查看插件状态

## 许可证

MIT


