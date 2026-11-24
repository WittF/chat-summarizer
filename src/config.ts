import { Schema } from 'koishi'
import { Config, GroupConfig, ForwardTarget } from './types'

export const name = 'chat-summarizer'
export const inject = { required: ['database', 'http', 'puppeteer'] }

export const ConfigSchema: Schema<Config> = Schema.object({
  chatLog: Schema.object({
    enabled: Schema.boolean()
      .description('是否启用聊天记录功能')
      .default(true),
    includeImages: Schema.boolean()
      .description('是否在聊天记录中包含图片链接')
      .default(true),
    includeForwardMedia: Schema.boolean()
      .description('是否转存合并转发里的图片和视频（按内容去重，存到 forward-media/）')
      .default(true),
    includeAudio: Schema.boolean()
      .description('是否转存语音（原文件原样存到 audios/，不转码）')
      .default(true),
    recordPoke: Schema.boolean()
      .description('是否记下群里的戳一戳（谁戳了谁；记在聊天记录文件里，多一个 notice 字段，不算发言）')
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
    groups: Schema.array(Schema.object({
      groupId: Schema.string()
        .description('群组ID（必需）')
        .required(),
      name: Schema.string()
        .description('群组名称标识（方便管理，可选）'),

      // 监控配置
      monitorEnabled: Schema.boolean()
        .description('是否监控消息（默认true）')
        .default(true),

      // 总结配置
      summaryEnabled: Schema.boolean()
        .description('是否生成AI总结（默认继承全局AI配置）'),
      summaryTime: Schema.string()
        .description('生成总结时间 HH:mm（默认继承全局 defaultSummaryTime）')
        .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),

      // 推送配置
      pushEnabled: Schema.boolean()
        .description('是否启用推送（默认true）')
        .default(true),
      pushTime: Schema.string()
        .description('推送时间 HH:mm（默认与 summaryTime 相同）')
        .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
      pushToSelf: Schema.boolean()
        .description('推送回本群（默认true）')
        .default(true),
      forwardGroups: Schema.array(Schema.object({
        groupId: Schema.string()
          .description('转发目标群组ID')
          .required(),
        name: Schema.string()
          .description('目标群组名称标识（可选）')
      }))
        .description('额外转发到的群组列表')
        .default([]),

      // AI覆盖配置
      systemPrompt: Schema.string()
        .role('textarea', { rows: 8 })
        .description('该群组专用的系统提示词（可选，留空则使用全局配置）'),
      userPromptTemplate: Schema.string()
        .role('textarea', { rows: 6 })
        .description('该群组专用的用户提示词模板（可选，留空则使用全局配置）')
    }))
      .description('群组配置列表（空则监控所有群组，不自动生成总结）')
      .role('table')
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
      .default(`你是专业聊天记录分析助手。你的任务是分析群友们的聊天记录，并生成简洁有趣的总结。

请按照以下要求进行分析：

1. **群友动态**：统计活跃的群友，关注他们的互动和贡献
2. **日常闲聊**：不要忽略日常生活话题，这些也是群友感情交流的重要部分
3. **群内氛围**：分析群内的整体氛围（如：欢乐、激烈讨论、温馨互助等）
4. **重要事件**：提取值得关注的群内公告、活动、决定等

输出格式要求：
- 使用表达清晰的语调，符合群聊的氛围
- 结构清晰，用emoji和标题分段，便于快速阅读
- 控制在500字以内，重点突出，信息准确
- 如果聊天内容较少，说明"今天大家比较安静，主要是日常交流"
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
      .default(`请分析以下群聊天记录：

📊 **基本信息：**
- 时间范围：{timeRange}
- 消息数量：{messageCount} 条
- 聊天群组：{groupInfo}

💬 **聊天内容：**
{content}

请根据上述聊天记录，生成一份有趣的群日报～`),
    useFileMode: Schema.boolean()
      .description('是否使用文件模式发送聊天记录（优化长文本处理，适用于云雾API等）')
      .default(false),
    fileName: Schema.string()
      .description('文件模式下的文件名（仅用于提示，如：chat-log.txt）')
      .default('chat-log.txt'),

    // 全局默认时间配置
    defaultSummaryTime: Schema.string()
      .description('默认总结生成时间（HH:mm格式，群组未单独配置时使用）')
      .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .default('03:00'),
    defaultPushTime: Schema.string()
      .description('默认推送时间（HH:mm格式，留空则与 defaultSummaryTime 相同）')
      .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
  }).description('AI总结配置'),
  
  debug: Schema.boolean()
    .description('是否启用调试模式')
    .default(false)
})

// 结构化 AI 输出的系统提示词
export const STRUCTURED_SYSTEM_PROMPT = `你是专业的群聊记录分析助手。你需要分析聊天记录并输出结构化的JSON数据。

你必须且只能输出以下JSON格式，不要添加任何解释性文字、代码块标记或其他内容：
{
  "summary": {
    "overview": "30-50字的整体概述，描述今天群内的主要活动和氛围",
    "highlights": ["要点1", "要点2", "要点3"],
    "atmosphere": "用2-4个词描述群内氛围，如：轻松愉快、热烈讨论、温馨互助等"
  },
  "hotTopics": [
    {
      "topic": "话题名称",
      "description": "简短描述该话题的内容",
      "participants": ["参与者1", "参与者2"],
      "heatLevel": "high/medium/low"
    }
  ],
  "importantInfo": [
    {
      "type": "announcement/link/resource/decision/other",
      "content": "重要信息内容",
      "source": "信息来源（可选）"
    }
  ],
  "quotes": [
    {
      "content": "有趣或精彩的发言内容",
      "author": "发言人"
    }
  ]
}

分析要求：
1. summary.overview - 30-50字整体概述，用词要生动但清晰
2. summary.highlights - 3-5个要点，每个要点一句话
3. summary.atmosphere - 描述群内氛围的简短词组
4. hotTopics - 按热度排序，最多5个，heatLevel根据讨论热度判断
5. importantInfo - 提取公告、重要决定等，没有则返回空数组
6. quotes - 最有趣/精彩/有哲理的发言，最多5句，没有则返回空数组

重要注意事项：
- 严格按JSON格式输出，确保JSON语法正确
- 不要在JSON前后添加任何文字说明
- 不要使用markdown代码块包裹JSON
- 如果聊天内容较少，各字段可以精简但结构必须完整
- 保护隐私，不透露敏感个人信息
- **importantInfo的content字段必须是对信息的描述，禁止直接放入原始URL链接或图片标记**
- **不要把纯链接、纯图片当作重要信息，只提取有实际内容描述的信息**`

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