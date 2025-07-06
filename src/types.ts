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
    enabledGroups: string[]  // 监控的群组ID列表（空则监控所有群组）
    excludedUsers: string[]  // 不监控的用户QQ号列表
    excludeBots: boolean     // 是否排除机器人消息
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

// 插件统计信息
export interface PluginStats {
  totalMessages: number
  todayMessages: number
  imageRecords: number
  uploadedMessages: number
}

// 扩展数据库模型类型
declare module 'koishi' {
  interface Tables {
    chat_records: ChatRecord
    image_records: ImageRecord
    file_records: FileRecord
    video_records: VideoRecord
  }
} 