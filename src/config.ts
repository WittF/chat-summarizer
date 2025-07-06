import { Schema } from 'koishi'
import { Config } from './types'

export const name = 'chat-summarizer'
export const inject = { required: ['database', 'http'] }

export const ConfigSchema: Schema<Config> = Schema.object({
  chatLog: Schema.object({
    enabled: Schema.boolean()
      .description('是否启用聊天记录功能')
      .default(true),
    includeImages: Schema.boolean()
      .description('是否在聊天记录中包含图片链接')
      .default(true),
    autoUploadTime: Schema.string()
      .description('自动上传时间（HH:mm格式，如：02:00）')
      .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .default('02:00'),
    retentionDays: Schema.number()
      .description('本地文件保留天数')
      .min(1).max(365).default(3),
    maxFileSize: Schema.number()
      .description('单个日志文件最大大小(MB)')
      .min(1).max(100).default(10),
    dbRetentionHours: Schema.number()
      .description('数据库记录保留小时数（建议24小时，用作缓存）')
      .min(1).max(168).default(24)
  }).description('聊天记录配置'),
  
  s3: Schema.object({
    enabled: Schema.boolean()
      .description('是否启用S3兼容云存储功能')
      .default(false),
    bucket: Schema.string()
      .description('存储桶名称')
      .default(''),
    accessKeyId: Schema.string()
      .description('Access Key ID')
      .role('secret')
      .default(''),
    secretAccessKey: Schema.string()
      .description('Secret Access Key')
      .role('secret')
      .default(''),
    endpoint: Schema.string()
      .description('API端点地址（可选，用于MinIO等）'),
    pathPrefix: Schema.string()
      .description('存储路径前缀')
      .default('')
  }).description('S3兼容云存储配置'),
  
  monitor: Schema.object({
    enabledGroups: Schema.array(Schema.string())
      .description('监控的群组ID列表（空则监控所有群组）')
      .default([]),
    excludedUsers: Schema.array(Schema.string())
      .description('不监控的用户QQ号列表')
      .default([]),
    excludeBots: Schema.boolean()
      .description('是否排除机器人发送的消息')
      .default(true)
  }).description('监控配置'),
  
  admin: Schema.object({
    adminIds: Schema.array(Schema.string())
      .description('管理员QQ号列表（可以使用cs.geturl和cs.export命令）')
      .default([])
  }).description('管理员配置'),
  
  ai: Schema.object({
    enabled: Schema.boolean()
      .description('是否启用AI总结功能')
      .default(false),
    apiUrl: Schema.string()
      .description('AI接口URL（如：https://api.openai.com/v1/chat/completions）')
      .default(''),
    apiKey: Schema.string()
      .description('AI接口密钥')
      .role('secret')
      .default(''),
    model: Schema.string()
      .description('AI模型名称（如：gpt-3.5-turbo）')
      .default('gpt-3.5-turbo'),
    maxTokens: Schema.number()
      .description('最大token数（设置为0表示不限制）')
      .min(0).max(32000).default(0),
    timeout: Schema.number()
      .description('请求超时时间（秒，文件模式建议设置为120秒以上）')
      .min(10).max(600).default(120),
    systemPrompt: Schema.string()
      .role('textarea', { rows: 10 })
      .description('系统提示词（自定义AI分析角色和要求）')
      .default(`你是籽岷主播舰长群的专业聊天记录分析助手。你的任务是分析舰长们的聊天记录，并生成简洁有趣的总结。

请按照以下要求进行分析：

1. **游戏话题**：重点关注游戏相关的讨论，包括游戏攻略、新游戏推荐、游戏体验分享等
2. **主播互动**：识别与籽岷主播相关的话题，如直播内容讨论、粉丝互动、直播时间等
3. **舰长动态**：统计活跃的舰长，关注他们的互动和贡献
4. **日常闲聊**：不要忽略日常生活话题，这些也是群友感情交流的重要部分
5. **群内氛围**：分析群内的整体氛围（如：欢乐、激烈讨论、温馨互助等）
6. **重要事件**：提取值得关注的群内公告、活动、决定等

输出格式要求：
- 使用活泼有趣但表达清晰的语调，符合游戏群的氛围
- 结构清晰，用emoji和标题分段，便于快速阅读
- 控制在500字以内，重点突出，信息准确
- 如果聊天内容较少，说明"今天舰长们比较安静，主要是日常交流"
- 保护隐私，不透露具体的个人信息
- **重要：在风趣幽默的同时，确保信息传达准确清晰，避免过度使用网络梗或难懂的表达**

写作风格：
- 用词生动但不晦涩，让所有读者都能轻松理解
- 适当使用二次元/游戏文化用语，但不影响信息的清晰表达
- 重点信息用简洁明了的语言描述，辅以轻松的语调
- 结构化呈现，让读者一目了然

记住：幽默是调料，清晰是主菜！确保每个人都能快速理解群内动态。`),
    userPromptTemplate: Schema.string()
      .role('textarea', { rows: 8 })
      .description('用户提示词模板（支持变量：{timeRange}, {messageCount}, {groupInfo}, {content}）')
      .default(`请分析以下籽岷主播舰长群的聊天记录：

📊 **基本信息：**
- 时间范围：{timeRange}
- 消息数量：{messageCount} 条
- 聊天群组：{groupInfo}

💬 **聊天内容：**
{content}

请根据上述聊天记录，生成一份有趣的舰长群日报～`),
    useFileMode: Schema.boolean()
      .description('是否使用文件模式发送聊天记录（优化长文本处理，适用于云雾API等）')
      .default(false),
    fileName: Schema.string()
      .description('文件模式下的文件名（仅用于提示，如：chat-log.txt）')
      .default('chat-log.txt')
  }).description('AI总结配置'),
  
  debug: Schema.boolean()
    .description('是否启用调试模式')
    .default(false)
})

// 常量定义
export const CONSTANTS = {
  STORAGE_DIRS: {
    DATA: 'data'
  },
  URL_REPLACEMENTS: {
    OLD_DOMAIN: 'cn-sy1.rains3.com/qqmsg',
    NEW_DOMAIN: 'qqmsg.pan.wittf.ink'
  },
  FILE_SETTINGS: {
    ENCODING: 'utf8' as const,
    LINE_SEPARATOR: '\n',
    JSON_EXTENSION: '.jsonl'
  },
  DEFAULTS: {
    UNKNOWN_USER: '未知用户',
    PRIVATE_GROUP: 'private',
    QUOTE_AUTHOR_FALLBACK: '某用户'
  },
  S3_REGION: 'auto',
  MAX_CONTENT_PREVIEW: 50,
  IMAGE_UPLOAD_TIMEOUT: 60000
} as const 