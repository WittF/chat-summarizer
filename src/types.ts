// 转发目标群组配置接口
export interface ForwardTarget {
  groupId: string                  // 群组 ID
  name?: string                    // 群组名称标识（方便管理）
}

// 群组配置接口
export interface GroupConfig {
  groupId: string                  // 群组ID (必需)
  name?: string                    // 群组名称标识（方便管理）

  // 监控配置
  monitorEnabled?: boolean         // 是否监控消息（默认true）

  // 总结配置
  summaryEnabled?: boolean         // 是否生成AI总结（默认继承全局）
  summaryTime?: string             // 生成时间 HH:mm（默认继承全局）

  // 推送配置
  pushEnabled?: boolean            // 是否启用推送（默认true）
  pushTime?: string                // 推送时间 HH:mm（默认=summaryTime）
  pushToSelf?: boolean             // 推回本群（默认true）
  forwardGroups?: ForwardTarget[]  // 额外转发群组

  // AI覆盖配置
  systemPrompt?: string            // 该群组专用的系统提示词（可选）
  userPromptTemplate?: string      // 该群组专用的用户提示词模板（可选）
}

// 兼容旧配置的推送目标群组配置接口（已废弃，保留用于迁移）
export interface PushGroupConfig {
  groupId: string                  // 群组 ID
  channelId?: string              // 频道 ID（可选）
  platform?: string               // 平台（可选，如 onebot）
}

export interface Config {
  // S3兼容存储配置
  s3: {
    enabled: boolean          // 是否启用S3兼容存储
    bucket: string           // 存储桶名称
    accessKeyId: string      // Access Key ID
    secretAccessKey: string  // Secret Access Key
    endpoint?: string        // API端点地址（可选）
    pathPrefix: string       // 存储路径前缀，用于组织文件结构
  }
  
  // 聊天记录配置
  chatLog: {
    enabled: boolean         // 是否启用聊天记录
    includeImages: boolean   // 是否包含图片链接
    maxFileSize: number      // 单个日志文件最大大小(MB)
    autoUploadTime: string   // 自动上传时间（HH:mm格式）
    retentionDays: number    // 本地文件保留天数
    dbRetentionHours: number // 数据库记录保留小时数（建议24小时，用作缓存）
  }
  
  // 监控配置
  monitor: {
    groups: GroupConfig[]         // 群组配置列表（空则监控所有群组）
    excludedUsers: string[]       // 不监控的用户QQ号列表
    excludeBots: boolean          // 是否排除机器人消息
  }
  
  // 管理员配置
  admin: {
    adminIds: string[]       // 管理员QQ号列表
  }
  
  // AI总结配置
  ai: {
    enabled: boolean         // 是否启用AI总结功能
    apiUrl: string          // AI接口URL
    apiKey: string          // AI接口密钥
    model?: string          // AI模型名称（可选）
    maxTokens?: number      // 最大token数（可选）
    timeout?: number        // 请求超时时间（秒，可选）
    systemPrompt?: string   // 系统提示词（可选）
    userPromptTemplate?: string // 用户提示词模板（可选）
    useFileMode?: boolean   // 是否使用文件模式发送聊天记录（可选）
    fileName?: string       // 文件模式下的文件名（可选）

    // 全局默认时间（群组未配置时使用）
    defaultSummaryTime?: string  // 默认总结生成时间 HH:mm（默认 "03:00"）
    defaultPushTime?: string     // 默认推送时间 HH:mm（默认与summaryTime相同）
  }
  
  // 调试配置
  debug: boolean             // 调试模式
}

// 聊天记录数据结构
export interface ChatRecord {
  id?: number              // 数据库自增ID
  messageId: string        // 消息ID
  guildId?: string         // 群组ID
  channelId: string        // 频道ID
  userId: string           // 用户ID
  username: string         // 用户名
  content: string          // 消息内容（处理后）
  originalElements: string // 原始消息元素（JSON格式）
  timestamp: number        // 消息时间戳
  messageType: 'text' | 'image' | 'mixed' | 'other' // 消息类型
  imageUrls?: string       // 图片URL列表（JSON格式）
  fileUrls?: string        // 文件URL列表（JSON格式）
  videoUrls?: string       // 视频URL列表（JSON格式）
  uploadedAt?: number      // 上传到S3的时间戳
  isUploaded: boolean      // 是否已上传到S3
}

// 图片上传记录
export interface ImageRecord {
  id?: number              // 数据库自增ID
  originalUrl: string      // 原始图片URL
  s3Url: string           // S3存储URL
  s3Key: string           // S3存储键
  fileSize: number        // 文件大小（字节）
  uploadedAt: number      // 上传时间戳
  messageId: string       // 关联的消息ID
}

// 文件上传记录
export interface FileRecord {
  id?: number              // 数据库自增ID
  originalUrl: string      // 原始文件URL
  s3Url: string           // S3存储URL
  s3Key: string           // S3存储键
  fileName: string        // 文件名
  fileSize: number        // 文件大小（字节）
  uploadedAt: number      // 上传时间戳
  messageId: string       // 关联的消息ID
}

// 视频上传记录
export interface VideoRecord {
  id?: number              // 数据库自增ID
  originalUrl: string      // 原始视频URL
  s3Url: string           // S3存储URL
  s3Key: string           // S3存储键
  fileName: string        // 视频文件名
  fileSize: number        // 文件大小（字节）
  uploadedAt: number      // 上传时间戳
  messageId: string       // 关联的消息ID
}

// 聊天记录文件上传记录
export interface ChatLogFileRecord {
  id?: number              // 数据库自增ID
  guildId?: string         // 群组ID，undefined表示私聊
  date: string            // 日期字符串，格式: YYYY-MM-DD
  filePath: string        // 本地文件路径
  s3Key: string           // S3对象键
  s3Url?: string          // S3访问URL
  fileSize: number        // 文件大小（字节）
  recordCount: number     // 该文件包含的聊天记录数
  uploadedAt: number      // 上传时间戳
  status: 'pending' | 'uploading' | 'uploaded' | 'failed'  // 上传状态
  error?: string          // 错误信息（如果失败）
  summaryImageUrl?: string // AI总结缩略图URL（可选）
  summaryGeneratedAt?: number // AI总结生成时间戳（可选）
}

// 插件统计信息
export interface PluginStats {
  totalMessages: number
  todayMessages: number
  imageRecords: number
  uploadedMessages: number
}

// ========== AI 结构化输出类型 ==========

// AI 输出的结构化 JSON
export interface AISummaryOutput {
  summary: {
    overview: string        // 整体概述
    highlights: string[]    // 要点列表
    atmosphere: string      // 氛围描述
  }
  hotTopics: Array<{
    topic: string
    description: string
    participants: string[]
    heatLevel: 'high' | 'medium' | 'low'
  }>
  importantInfo: Array<{
    type: 'announcement' | 'link' | 'resource' | 'decision' | 'other'
    content: string
    source?: string
  }>
  quotes: Array<{
    content: string
    author: string
  }>
}

// 代码统计的互动数据
export interface InteractionStatistics {
  activityRanking: Array<{ username: string; messageCount: number; rank: number }>
  hourlyDistribution: Array<{ hour: number; count: number; percentage: number }>
  interactions: {
    mentions: Array<{ from: string; to: string; count: number }>
    replies: Array<{ from: string; to: string; count: number }>
  }
  basicStats: {
    totalMessages: number
    uniqueUsers: number
    avgMessagesPerUser: number
    peakHour: number
  }
}

// 完整群日报数据
export interface DailyReport {
  date: string
  guildId: string
  aiContent: AISummaryOutput
  statistics: InteractionStatistics
  metadata: { generatedAt: number; aiModel: string }
}

// 解析后的消息结构（用于统计服务）
export interface ParsedMessage {
  timestamp: number
  time: string
  messageId: string
  guildId?: string
  channelId: string
  userId: string
  username: string
  content: string
  messageType: string
  imageUrls: string[]
  fileUrls: string[]
  videoUrls: string[]
}

// 扩展数据库模型类型
declare module 'koishi' {
  interface Tables {
    chat_records: ChatRecord
    image_records: ImageRecord
    file_records: FileRecord
    video_records: VideoRecord
    chat_log_files: ChatLogFileRecord
  }
} 