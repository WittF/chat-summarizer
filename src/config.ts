import { Schema } from 'koishi'
import { Config } from './types'

export const name = 'chat-summarizer'
export const inject = { required: ['database', 'http'] }

export const ConfigSchema: Schema<Config> = Schema.object({
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
      .description('API端点地址'),
    pathPrefix: Schema.string()
      .description('存储路径前缀')
      .default('')
  }).description('S3兼容云存储配置'),
  
  chatLog: Schema.object({
    enabled: Schema.boolean()
      .description('是否启用聊天记录功能')
      .default(true),
    includeImages: Schema.boolean()
      .description('是否在聊天记录中包含图片链接')
      .default(true),
    maxFileSize: Schema.number()
      .description('单个日志文件最大大小(MB)')
      .min(1).max(100).default(10),
    autoUploadTime: Schema.string()
      .description('自动上传时间（HH:mm格式，如：02:00）')
      .pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .default('02:00'),
    retentionDays: Schema.number()
      .description('本地文件保留天数')
      .min(1).max(365).default(3)
  }).description('聊天记录配置'),
  

  
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
      .description('管理员QQ号列表（可以使用cs.geturl命令）')
      .default([])
  }).description('管理员配置'),
  
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