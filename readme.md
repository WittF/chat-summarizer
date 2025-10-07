# koishi-plugin-chat-summarizer

[![npm version](https://badge.fury.io/js/koishi-plugin-chat-summarizer.svg)](https://badge.fury.io/js/koishi-plugin-chat-summarizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Koishi 聊天记录收集和上传插件

## 主要功能

- 自动收集群聊消息并保存到本地
- 自动上传图片、文件到 S3 存储
- 支持多种格式和时间范围的聊天记录导出
- 支持AI总结功能（文本/图片格式）
- 定时任务和数据库缓存管理
- 支持 AWS S3、MinIO 等 S3 兼容存储

## 📚 API

### 命令

- `cs.status`: 查看插件状态
- `cs.geturl`: 获取回复消息中图片/文件的S3链接（仅管理员可用）
  - 使用方法：回复包含图片或文件的消息，然后发送 `cs.geturl` 命令
  - 权限要求：需要在配置中的 `admin.adminIds` 列表中
  - ⚠️ 限制：只能查询最近24小时内的消息（数据库缓存期限）
- `cs.export [群组] [时间范围] [格式] [-t 消息类型] [-s]`: 导出指定时间范围的聊天记录（仅管理员可用）
  - 💡 **新功能**：支持无参数调用显示帮助信息
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
  - 时间范围：
    - 预设：`today`, `yesterday`, `last7days`, `lastweek`, `thismonth`, `lastmonth`
    - 具体日期：`2024-01-01` 或 `2024-01-01,2024-01-31`
    - 简化格式：`01-01` 或 `01-01,01-31`（当年）
  - 格式：`json`（默认）、`txt`（简化格式）、`csv`
  - 消息类型过滤（可选）：
    - `-t text` - 只导出纯文本消息
    - `-t image` - 只导出图片消息
    - `-t mixed` - 只导出包含图片和文字的混合消息
    - `-t other` - 只导出其他类型消息
    - `-t text,image` - 导出多种类型（用逗号分隔）
    - 不指定时导出所有类型
  - AI总结选项（可选）：
    - `-s` 或 `--summarize` - 导出完成后自动生成AI总结
    - 需要配置AI接口才能使用
  - 数据来源：优先本地文件，然后从S3下载
  - ⚠️ 完整性要求：必须所有日期的数据都存在才会导出，否则拒绝部分导出
  - 📝 TXT格式说明：使用简化时间格式（去除毫秒），仅保留时间、用户名和消息内容

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
   cs.export current yesterday        # 导出当前群昨天的记录（JSON格式，所有类型）
   cs.export 123456789 last7days txt # 导出指定群最近7天记录为文本格式
   cs.export current 2024-01-01,2024-01-31 csv # 导出当前群1月份记录为CSV格式
   cs.export private thismonth       # 导出本月私聊记录
   cs.export current today txt -t text # 只导出当前群今天的纯文本消息
   cs.export current yesterday json -t text,image # 导出文本和图片消息
   cs.export 123456789 lastweek txt -t mixed # 导出包含图片的混合消息
   ```

4. **AI总结功能**：
   ```
   cs.export current yesterday txt --summarize # 导出昨天记录并生成AI总结
   cs.export 123456789 today json -t text -s # 导出今天的文本消息并AI总结
   cs.export 123456789 thismonth csv --summarize # 导出本月记录并AI总结
   
5. **AI总结管理**：
   ```
   cs.summary.check              # 检查最近7天缺失的AI总结
   cs.summary.check 30           # 检查最近30天缺失的AI总结
   cs.summary.retry 2024-01-01   # 重新生成2024-01-01所有群组的总结
   cs.summary.retry 2024-01-01 123456789  # 重新生成指定群组的总结
   cs.summary.retry 2024-01-01 private    # 重新生成私聊的总结
   cs.summary.get yesterday      # 获取昨天当前群的AI总结图片
   cs.summary.get 2024-01-01     # 获取2024-01-01当前群的AI总结图片
   cs.summary.get 2024-01-01 123456789  # 获取指定群组的AI总结图片
   cs.summary.get 2024-01-01 private    # 获取私聊的AI总结图片
