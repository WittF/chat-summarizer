# koishi-plugin-chat-summarizer

[![npm version](https://badge.fury.io/js/koishi-plugin-chat-summarizer.svg)](https://badge.fury.io/js/koishi-plugin-chat-summarizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Koishi 聊天记录收集和上传插件

## 主要功能

- 自动收集群聊消息并保存到本地
- 自动上传图片、文件到 S3 存储
- 合并转发里的图片和视频、语音也会转存（可在 `chatLog.includeForwardMedia` / `chatLog.includeAudio` 关掉）
- 转存失败自动重试，最终失败的记进当天的失败清单
- 支持多种格式和时间范围的聊天记录导出
- 支持AI总结功能（文本/图片格式）
- 定时任务和数据库缓存管理
- 支持 AWS S3、MinIO 等 S3 兼容存储

## 存储里的路径

| 前缀 | 内容 |
|---|---|
| `chat-logs/<日期>/` | 每天的聊天记录（JSONL） |
| `images/` `videos/` `files/` | 消息里直接发的图片、视频、文件 |
| `forward-media/<md5 前两位>/<md5>.<扩展名>` | 合并转发里的图片和视频，按内容去重；对应片段的 `data.s3Key` 记着路径，原来的字段不动 |
| `audios/<消息日期>/<群>/<消息 id>.<扩展名>` | 语音原文件（QQ 的语音是 SILK，不转码）；语音元素的 `attrs.s3Key` 记着路径 |
| `failed-media/<日期>/guild_<群>.jsonl` | 重试之后还是没存下来的媒体清单 |

每条记录另有几个可选字段：`replyTo` / `replyToUser`（被回复的消息和人）、`onebot`（适配器给的原始序号）；
适配器一个元素都没解析出来的消息会带 `rawTypes` / `rawMessage`，方便以后查是什么消息。

失败重试：第一次失败后隔 30 秒、2 分钟、10 分钟各再试一次；QQ 的媒体地址带签名、很快失效，
隔得久的重试会先向机器人（OneBot）重取一遍消息换新地址。

## 📚 API

### 命令

- `cs.status`: 查看插件状态
- `cs.geturl`: 获取回复消息中图片/文件的S3链接（仅管理员可用）
  - 使用方法：回复包含图片或文件的消息，然后发送 `cs.geturl` 命令
  - 权限要求：需要在配置中的 `admin.adminIds` 列表中
  - ⚠️ 限制：只能查询最近24小时内的消息（数据库缓存期限）
- `cs.export [群组] [时间范围] [格式] [-t 消息类型] [-s]`: 导出指定时间范围的聊天记录（仅管理员可用）
  - 时间范围：预设（today/yesterday/last7days等）或具体日期（2024-01-01）
  - 格式：json（默认）、txt、csv
  - 可选参数：-t 过滤消息类型，-s 生成AI总结
- `cs.summary.check [天数]`: 检查缺失的AI总结（仅管理员可用）
  - 默认检查最近7天，可指定1-365天
  - 显示哪些日期的群组缺失AI总结
- `cs.summary.retry <日期> [群组ID]`: 重新生成指定日期的AI总结（仅管理员可用）
  - 支持重新生成单个群组或该日期所有群组的总结
  - 自动清除旧的总结记录并重新生成
- `cs.summary.get <日期> [群组ID]`: 获取指定日期的AI总结图片（仅管理员可用）
  - 支持预设日期（today、yesterday等）和具体日期格式
  - 在群聊中可省略群组参数，自动使用当前群组
  - 群组参数：
    - `current` - 当前群（仅在群聊中有效）
    - `123456789` - 具体群号
- `cs.analysis <自然语言查询>`: AI分析聊天记录（仅管理员可用）
  - 自动识别时间范围并转换为具体日期（如：昨天 → 2025-01-07，最近3天 → 2025-01-05, 2025-01-06, 2025-01-07）
  - 根据问题生成针对性分析结果（限制100字以内）
  - 支持各种类型的查询（事件总结、话题分析、金句提取等）
  - 输出纯文本格式，简洁直接
