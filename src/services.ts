import { Context } from 'koishi'
import { Config } from './types'
import { MessageProcessor } from './message-processor'
import { S3Uploader, S3Config } from './s3-uploader'
import { CONSTANTS } from './config'

// 日志服务类
export class LoggerService {
  private logger: any

  constructor(ctx: Context, private config: Config) {
    this.logger = ctx.logger('chat-summarizer')
  }

  debug(message: string, data?: any): void {
    if (this.config.debug) {
      if (data) {
        this.logger.debug(`${message}\n${JSON.stringify(data, null, 2)}`)
      } else {
        this.logger.debug(message)
      }
    }
  }

  info(message: string): void {
    this.logger.info(message)
  }

  warn(message: string): void {
    this.logger.warn(message)
  }

  error(message: string, error?: any): void {
    if (error) {
      this.logger.error(`${message}\n错误详情: ${error?.message || '未知错误'}\n堆栈: ${error?.stack || '无堆栈信息'}`)
    } else {
      this.logger.error(message)
    }
  }
}

// S3服务类
export class S3Service {
  private s3Uploader: S3Uploader | null = null

  constructor(
    private config: Config,
    private logger: LoggerService
  ) {}

  // 初始化S3上传器
  init(): void {
    if (!this.config.s3.enabled || !this.config.s3.accessKeyId || !this.config.s3.secretAccessKey) {
      // 只在调试模式下显示详细警告
      if (this.config.debug) {
        this.logger.warn('S3配置不完整，S3功能将被禁用')
      }
      return
    }

    const s3Config: S3Config = {
      region: CONSTANTS.S3_REGION,
      bucket: this.config.s3.bucket,
      accessKeyId: this.config.s3.accessKeyId,
      secretAccessKey: this.config.s3.secretAccessKey,
      endpoint: this.config.s3.endpoint,
      pathPrefix: this.config.s3.pathPrefix
    }

    this.s3Uploader = new S3Uploader(s3Config)
    
    // 只在调试模式下显示详细信息
    if (this.config.debug) {
      this.logger.info('S3上传器初始化完成')
    }
  }

  // 获取S3上传器实例
  getUploader(): S3Uploader | null {
    return this.s3Uploader
  }
}

// 消息处理工具
export class MessageProcessorService {
  private messageProcessor: MessageProcessor

  constructor(includeImages: boolean) {
    this.messageProcessor = new MessageProcessor(includeImages)
  }

  // 处理消息元素
  processElements(elements: any[]): any {
    return this.messageProcessor.processElements(elements)
  }

  // 处理用户ID，去除平台前缀
  normalizeUserId(userId: string): string {
    if (!userId) return ''
    const colonIndex = userId.indexOf(':')
    if (colonIndex !== -1) {
      return userId.substring(colonIndex + 1)
    }
    return userId
  }
} 