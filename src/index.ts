import { Context, Session, h } from 'koishi'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Config, ChatRecord, ImageRecord, FileRecord, VideoRecord, ChatLogFileRecord, DailyReport } from './types'
import { name, inject, ConfigSchema, CONSTANTS } from './config'
import { extendDatabase, DatabaseOperations } from './database'
import { LoggerService, S3Service, MessageProcessorService } from './services'
import { CommandHandler } from './commands'
import { S3Uploader, UploadResult } from './s3-uploader'
import { SafeFileWriter } from './file-writer'
import { AIService } from './ai-service'
import { MarkdownToImageService } from './md-to-image'
import { StatisticsService } from './statistics'
import { CardRenderer } from './card-renderer'
import {
  formatDateInUTC8,
  getDateStringInUTC8,
  getCurrentTimeInUTC8,
  safeJsonParse,
  safeJsonStringify,
  replaceImageUrl,
  buildStoredImageElement
} from './utils'

export { name, inject }
export { ConfigSchema as Config }

export function apply(ctx: Context, config: Config) {
  // 扩展数据库模型
  extendDatabase(ctx)

  // 初始化服务
  const logger = new LoggerService(ctx, config)
  const dbOps = new DatabaseOperations(ctx)
  const s3Service = new S3Service(config, logger)
  const messageService = new MessageProcessorService(config.chatLog.includeImages)
  const fileWriter = new SafeFileWriter(ctx.logger('chat-summarizer:file-writer'))
  
  // 获取本地存储目录
  const getStorageDir = (subDir: string): string => {
    return path.join(ctx.baseDir, 'data', 'chat-summarizer', subDir)
  }

  // 确保目录存在
  const ensureDir = async (dirPath: string): Promise<void> => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error: any) {
      logger.error(`创建目录失败: ${dirPath}`, error)
    }
  }

  // 初始化存储目录
  const initStorageDirs = async (): Promise<void> => {
    await ensureDir(getStorageDir('data'))
    logger.info('存储目录初始化完成')
  }

  // 检查是否应该监控此消息
  const shouldMonitorMessage = (session: Session): boolean => {
    if (!config.chatLog.enabled) {
      return false
    }

    // 跳过私聊消息
    if (!session.guildId) {
      return false
    }

    // 检查群组过滤
    if (config.monitor.groups.length > 0) {
      const groupConfig = config.monitor.groups.find(group => group.groupId === session.guildId)
      if (!groupConfig) {
        return false
      }
      // 检查该群组是否启用监控
      if (groupConfig.monitorEnabled === false) {
        return false
      }
    }

    // 检查用户排除
    if (config.monitor.excludedUsers.length > 0) {
      const normalizedUserId = messageService.normalizeUserId(session.userId)
      if (config.monitor.excludedUsers.includes(normalizedUserId)) {
        return false
      }
    }

    // 检查是否排除机器人消息
    if (config.monitor.excludeBots && session.bot && session.userId === session.bot.userId) {
      return false
    }

    return true
  }

  // 添加回复信息前缀
  const addReplyPrefix = async (content: string, session: Session): Promise<string> => {
    if (!session.quote) {
      return content
    }

    const quoteAuthor = session.quote.user?.name || session.quote.user?.username || CONSTANTS.DEFAULTS.QUOTE_AUTHOR_FALLBACK
    const quoteId = session.quote.messageId || ''
    let quoteContent = session.quote.content || ''
    
    // 如果有回复消息ID，尝试从数据库获取已处理的内容
    if (quoteId) {
      try {
        const existingRecord = await ctx.database.get('chat_records', { messageId: quoteId })
        if (existingRecord.length > 0) {
          // 使用数据库中已经处理过的内容（URL已替换）
          quoteContent = existingRecord[0].content
        }
      } catch (error) {
        // 如果查询失败，继续使用原始内容
        if (config.debug) {
          logger.debug(`无法从数据库获取回复消息内容: ${quoteId}`)
        }
      }
    }
    
    let replyPrefix = ''
    if (quoteContent) {
      const truncatedContent = quoteContent.length > 50 
        ? `${quoteContent.substring(0, 50)}...` 
        : quoteContent
      replyPrefix = `[回复 ${quoteAuthor}: ${truncatedContent}] `
    } else if (quoteId) {
      replyPrefix = `[回复 ${quoteAuthor} 的消息] `
    } else {
      replyPrefix = `[回复 ${quoteAuthor}] `
    }
    
    return replyPrefix + content
  }

  // 保存消息到本地文件
  const saveMessageToLocalFile = async (record: ChatRecord): Promise<void> => {
    try {
      const dateStr = getDateStringInUTC8(record.timestamp)
      const groupKey = record.guildId || 'private'
      
      const logDir = getStorageDir('data')
      const fileName = `${groupKey}_${dateStr}.jsonl`
      const filePath = path.join(logDir, fileName)
      
      const logEntry = {
        timestamp: record.timestamp,
        time: formatDateInUTC8(record.timestamp),
        messageId: record.messageId,
        guildId: record.guildId,
        channelId: record.channelId,
        userId: record.userId,
        username: record.username,
        content: record.content,
        messageType: record.messageType,
        imageUrls: safeJsonParse(record.imageUrls, []),
        fileUrls: safeJsonParse(record.fileUrls, []),
        videoUrls: safeJsonParse(record.videoUrls, []),
        originalElements: safeJsonParse(record.originalElements, [])
      }
      
      const logLine = safeJsonStringify(logEntry) + '\n'
      
      // 使用安全文件写入器
      await fileWriter.safeAppend(filePath, logLine)
      
      // 只在调试模式下记录详细信息
      if (config.debug) {
        logger.info(`已保存到本地文件: ${fileName}`)
      }
      
    } catch (error: any) {
      logger.error('保存消息到本地文件失败', error)
    }
  }

  // 上传图片到S3
  const uploadImageToS3 = async (imageUrl: string, messageId: string, guildId?: string): Promise<string | null> => {
    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化')
      return null
    }

    try {
      const s3Key = S3Uploader.generateImageKey(messageId, imageUrl, guildId)
      const result = await s3Uploader.uploadImageFromUrl(imageUrl, s3Key)

      if (result.success && result.url) {
        // 替换URL域名
        const finalUrl = replaceImageUrl(result.url)
        
        const imageRecord: Omit<ImageRecord, 'id'> = {
          originalUrl: imageUrl,
          s3Url: finalUrl,  // 使用替换后的URL
          s3Key: result.key || s3Key,
          fileSize: result.fileSize || 0,
          uploadedAt: Date.now(),
          messageId: messageId
        }

        await dbOps.createImageRecord(imageRecord)
        
        // 简化非调试模式的日志输出
        if (config.debug) {
          logger.info(`✅ 图片上传成功: ${finalUrl}`)
        }
        
        return finalUrl  // 返回替换后的URL
      } else {
        logger.error(`❌ 图片上传失败: ${result.error}`)
        return null
      }
    } catch (error: any) {
      logger.error('❌ 上传图片时发生错误', error)
      return null
    }
  }

  // 上传文件到S3
  const uploadFileToS3 = async (fileUrl: string, fileName: string, messageId: string, guildId?: string): Promise<string | null> => {
    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化')
      return null
    }

    try {
      const s3Key = S3Uploader.generateFileKey(messageId, fileUrl, fileName, guildId)
      const result = await s3Uploader.uploadFileFromUrl(fileUrl, s3Key, fileName)

      if (result.success && result.url) {
        // 替换URL域名
        const finalUrl = replaceImageUrl(result.url)
        
        const fileRecord: Omit<FileRecord, 'id'> = {
          originalUrl: fileUrl,
          s3Url: finalUrl,  // 使用替换后的URL
          s3Key: result.key || s3Key,
          fileName: fileName,
          fileSize: result.fileSize || 0,
          uploadedAt: Date.now(),
          messageId: messageId
        }

        await dbOps.createFileRecord(fileRecord)
        
        // 简化非调试模式的日志输出
        if (config.debug) {
          logger.info(`✅ 文件上传成功: ${fileName} -> ${finalUrl}`)
        }
        
        return finalUrl  // 返回替换后的URL
      } else {
        logger.error(`❌ 文件上传失败: ${fileName} - ${result.error}`)
        return null
      }
    } catch (error: any) {
      logger.error(`❌ 上传文件时发生错误: ${fileName}`, error)
      return null
    }
  }

  // 上传视频到S3
  const uploadVideoToS3 = async (videoUrl: string, fileName: string, messageId: string, guildId?: string): Promise<string | null> => {
    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化')
      return null
    }

    try {
      const s3Key = S3Uploader.generateVideoKey(messageId, videoUrl, fileName, guildId)
      const result = await s3Uploader.uploadVideoFromUrl(videoUrl, s3Key, fileName)

      if (result.success && result.url) {
        // 替换URL域名
        const finalUrl = replaceImageUrl(result.url)
        
        const videoRecord: Omit<VideoRecord, 'id'> = {
          originalUrl: videoUrl,
          s3Url: finalUrl,  // 使用替换后的URL
          s3Key: result.key || s3Key,
          fileName: fileName,
          fileSize: result.fileSize || 0,
          uploadedAt: Date.now(),
          messageId: messageId
        }

        await dbOps.createVideoRecord(videoRecord)
        
        // 简化非调试模式的日志输出
        if (config.debug) {
          logger.info(`✅ 视频上传成功: ${fileName} -> ${finalUrl}`)
        }
        
        return finalUrl  // 返回替换后的URL
      } else {
        logger.error(`❌ 视频上传失败: ${fileName} - ${result.error}`)
        return null
      }
    } catch (error: any) {
      logger.error(`❌ 上传视频时发生错误: ${fileName}`, error)
      return null
    }
  }

  // 异步处理图片、文件和视频上传
  const processFileUploadsAsync = async (
    imageUrls: string[], 
    fileUrls: Array<{ url: string; fileName: string }>,
    videoUrls: Array<{ url: string; fileName: string }>,
    messageId: string, 
    guildId: string | undefined,
    originalRecord: ChatRecord
  ): Promise<void> => {
    if (imageUrls.length === 0 && fileUrls.length === 0 && videoUrls.length === 0) {
      return
    }

    try {
      const urlMapping: Record<string, string> = {}
      const successfulImageUploads: string[] = []
      const successfulFileUploads: string[] = []
      const successfulVideoUploads: string[] = []

      // 处理图片上传（添加超时控制）
      if (imageUrls.length > 0) {
        const imageUploadPromises = imageUrls.map(imageUrl => {
          // 🔑 关键修复：为每个上传添加超时控制
          const uploadPromise = uploadImageToS3(imageUrl, messageId, guildId)
          const timeoutPromise = new Promise<string | null>((resolve) => {
            setTimeout(() => {
              if (config.debug) {
                logger.warn(`图片上传超时: ${imageUrl}`)
              }
              resolve(null)
            }, 120000) // 2分钟超时
          })
          
          return Promise.race([uploadPromise, timeoutPromise])
        })
        
        const imageUploadResults = await Promise.allSettled(imageUploadPromises)
        
        imageUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulImageUploads.push(result.value)
            urlMapping[imageUrls[index]] = result.value
          }
        })
      }

      // 处理文件上传（添加超时控制）
      if (fileUrls.length > 0) {
        const fileUploadPromises = fileUrls.map(fileInfo => {
          // 🔑 关键修复：为每个上传添加超时控制
          const uploadPromise = uploadFileToS3(fileInfo.url, fileInfo.fileName, messageId, guildId)
          const timeoutPromise = new Promise<string | null>((resolve) => {
            setTimeout(() => {
              if (config.debug) {
                logger.warn(`文件上传超时: ${fileInfo.fileName}`)
              }
              resolve(null)
            }, 180000) // 3分钟超时，文件可能更大
          })
          
          return Promise.race([uploadPromise, timeoutPromise])
        })
        
        const fileUploadResults = await Promise.allSettled(fileUploadPromises)
        
        fileUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulFileUploads.push(result.value)
            urlMapping[fileUrls[index].url] = result.value
          }
        })
      }

      // 处理视频上传（添加超时控制）
      if (videoUrls.length > 0) {
        const videoUploadPromises = videoUrls.map(videoInfo => {
          // 🔑 关键修复：为每个上传添加超时控制
          const uploadPromise = uploadVideoToS3(videoInfo.url, videoInfo.fileName, messageId, guildId)
          const timeoutPromise = new Promise<string | null>((resolve) => {
            setTimeout(() => {
              if (config.debug) {
                logger.warn(`视频上传超时: ${videoInfo.fileName}`)
              }
              resolve(null)
            }, 300000) // 5分钟超时，视频文件通常更大
          })
          
          return Promise.race([uploadPromise, timeoutPromise])
        })
        
        const videoUploadResults = await Promise.allSettled(videoUploadPromises)
        
        videoUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulVideoUploads.push(result.value)
            urlMapping[videoUrls[index].url] = result.value
          }
        })
      }

      // 更新数据库记录
      if (successfulImageUploads.length > 0 || successfulFileUploads.length > 0 || successfulVideoUploads.length > 0) {
        // 更新content中的链接
        let updatedContent = originalRecord.content
        Object.entries(urlMapping).forEach(([originalUrl, newUrl]) => {
          updatedContent = updatedContent.replace(originalUrl, newUrl)
        })

        const updateData: Partial<ChatRecord> = {
          content: updatedContent
        }

        if (successfulImageUploads.length > 0) {
          updateData.imageUrls = safeJsonStringify(successfulImageUploads)
        }

        if (successfulFileUploads.length > 0) {
          updateData.fileUrls = safeJsonStringify(successfulFileUploads)
        }

        if (successfulVideoUploads.length > 0) {
          updateData.videoUrls = safeJsonStringify(successfulVideoUploads)
        }

        await dbOps.updateChatRecord(messageId, updateData)
        
        // 更新本地文件记录
        await updateLocalFileRecord({
          ...originalRecord,
          content: updatedContent,
          imageUrls: successfulImageUploads.length > 0 ? safeJsonStringify(successfulImageUploads) : originalRecord.imageUrls,
          fileUrls: successfulFileUploads.length > 0 ? safeJsonStringify(successfulFileUploads) : originalRecord.fileUrls,
          videoUrls: successfulVideoUploads.length > 0 ? safeJsonStringify(successfulVideoUploads) : originalRecord.videoUrls
        })
      }
    } catch (error: any) {
      logger.error('批量上传文件时发生错误', error)
    }
  }

  // 更新本地文件记录
  const updateLocalFileRecord = async (record: ChatRecord): Promise<void> => {
    try {
      const dateStr = getDateStringInUTC8(record.timestamp)
      const groupKey = record.guildId || 'private'
      const fileName = `${groupKey}_${dateStr}.jsonl`
      const filePath = path.join(getStorageDir('data'), fileName)
      
      // 构建更新后的记录
      const updatedRecord = {
        timestamp: record.timestamp,
        time: formatDateInUTC8(record.timestamp),
        messageId: record.messageId,
        guildId: record.guildId,
        channelId: record.channelId,
        userId: record.userId,
        username: record.username,
        content: record.content,
        messageType: record.messageType,
        imageUrls: safeJsonParse(record.imageUrls, []),
        fileUrls: safeJsonParse(record.fileUrls, []),
        videoUrls: safeJsonParse(record.videoUrls, []),
        originalElements: safeJsonParse(record.originalElements, [])
      }
      
      const updatedLine = safeJsonStringify(updatedRecord) + '\n'
      
      // 使用安全文件写入器进行更新
      await fileWriter.safeUpdate(filePath, record.messageId, updatedLine)
      
      // 只在调试模式下记录详细信息
      if (config.debug) {
        logger.info(`已更新本地文件记录: ${fileName}`)
      }
      
    } catch (error: any) {
      logger.error('更新本地文件记录失败', error)
    }
  }

  // 获取下次执行时间（基于UTC+8时区）
  const getNextExecutionTime = (targetTime: string): Date => {
    const now = getCurrentTimeInUTC8()
    const [hours, minutes] = targetTime.split(':').map(Number)
    
    const next = new Date(now)
    next.setHours(hours, minutes, 0, 0)
    
    if (next <= now) {
      next.setDate(next.getDate() + 1)
    }
    
    return next
  }

  // 处理文件保留策略
  const handleFileRetention = async (filePath: string, groupKey: string, uploadDate: Date): Promise<void> => {
    try {
      // 根据保留天数配置决定是否删除文件
      if (config.chatLog.retentionDays > 0) {
        // 获取文件的实际修改时间，而不是使用传入的uploadDate
        const fileStats = await fs.stat(filePath).catch(() => null)
        if (!fileStats) {
          logger.warn(`无法获取文件状态，跳过清理: ${path.basename(filePath)}`)
          return
        }
        
        const fileModifiedTime = fileStats.mtime
        const retentionDate = getCurrentTimeInUTC8()
        retentionDate.setDate(retentionDate.getDate() - config.chatLog.retentionDays)
        
        if (fileModifiedTime <= retentionDate) {
          await fs.unlink(filePath)
          
          // 只在调试模式下记录详细信息
          if (config.debug) {
            logger.info(`已删除过期文件: ${path.basename(filePath)} (保留${config.chatLog.retentionDays}天，文件修改时间: ${fileModifiedTime.toLocaleString('zh-CN')})`)
          }
        } else {
          // 只在调试模式下记录详细信息
          if (config.debug) {
            const remainingDays = Math.ceil((fileModifiedTime.getTime() - retentionDate.getTime()) / (1000 * 60 * 60 * 24))
            logger.info(`保留文件: ${path.basename(filePath)} (还需保留${remainingDays}天，文件修改时间: ${fileModifiedTime.toLocaleString('zh-CN')})`)
          }
        }
      }
    } catch (error: any) {
      logger.error(`处理文件保留策略失败: ${filePath}`, error)
    }
  }

  // 检查指定日期和群组是否已经上传过
  const checkIfDateGroupAlreadyUploaded = async (date: Date, groupKey: string): Promise<boolean> => {
    try {
      const dateStr = getDateStringInUTC8(date.getTime())
      const guildIdCondition = groupKey === 'private' ? undefined : groupKey
      
      // 🔑 使用新的 chat_log_files 表来检查上传状态
      const isAlreadyUploaded = await dbOps.checkChatLogFileUploaded(dateStr, guildIdCondition)
      
      if (isAlreadyUploaded) {
        logger.debug(`群组 ${groupKey} 在 ${dateStr} 的记录已上传`)
        return true
      }

      // 如果没有上传记录，检查是否有该日期的聊天记录
      const startTime = new Date(date)
      startTime.setHours(0, 0, 0, 0)
      
      const endTime = new Date(date)
      endTime.setHours(23, 59, 59, 999)
      
      const totalRecords = await ctx.database.get('chat_records', {
        timestamp: { $gte: startTime.getTime(), $lte: endTime.getTime() },
        guildId: guildIdCondition
      })

      if (totalRecords.length === 0) {
        logger.debug(`群组 ${groupKey} 在 ${dateStr} 没有消息记录`)
        return true // 返回true表示"跳过上传"
      }

      logger.debug(`群组 ${groupKey} 在 ${dateStr} 有 ${totalRecords.length} 条记录待上传`)
      return false
    } catch (error: any) {
      logger.error(`检查上传状态失败 (群组: ${groupKey})`, error)
      return false // 出错时允许上传，避免阻塞
    }
  }

  // 创建或更新聊天记录文件上传记录
  const createOrUpdateChatLogFileRecord = async (
    date: Date, 
    groupKey: string, 
    filePath: string, 
    s3Key: string, 
    fileSize: number, 
    recordCount: number,
    s3Url?: string,
    status: 'pending' | 'uploading' | 'uploaded' | 'failed' = 'pending',
    error?: string
  ): Promise<void> => {
    try {
      const dateStr = getDateStringInUTC8(date.getTime())
      const guildIdCondition = groupKey === 'private' ? undefined : groupKey
      
      // 检查是否已存在记录
      const existingRecord = await dbOps.getChatLogFileRecord(dateStr, guildIdCondition)
      
      if (existingRecord) {
        // 更新现有记录
        await dbOps.updateChatLogFileRecord(existingRecord.id!, {
          s3Url,
          fileSize,
          recordCount,
          status,
          error,
          uploadedAt: status === 'uploaded' ? Date.now() : existingRecord.uploadedAt
        })
        
        if (config.debug) {
          logger.info(`已更新聊天记录文件上传记录 (群组: ${groupKey}, 日期: ${dateStr}, 状态: ${status})`)
        }
      } else {
        // 创建新记录
        await dbOps.createChatLogFileRecord({
          guildId: guildIdCondition,
          date: dateStr,
          filePath,
          s3Key,
          s3Url,
          fileSize,
          recordCount,
          uploadedAt: status === 'uploaded' ? Date.now() : 0,
          status,
          error
        })
        
        if (config.debug) {
          logger.info(`已创建聊天记录文件上传记录 (群组: ${groupKey}, 日期: ${dateStr}, 状态: ${status})`)
        }
      }
    } catch (error: any) {
      logger.error(`创建或更新聊天记录文件上传记录失败 (群组: ${groupKey})`, error)
    }
  }

  // 定时上传调度器
  let uploadScheduler: NodeJS.Timeout | null = null

  // 执行聊天记录上传（直接上传本地文件）
  const executeAutoUpload = async (): Promise<void> => {
    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化，无法执行自动上传')
      return
    }

    try {
      logger.info('开始执行聊天记录自动上传')

      // 获取昨天的日期字符串（基于UTC+8时区）
      const yesterday = getCurrentTimeInUTC8()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = getDateStringInUTC8(yesterday.getTime())

      // 扫描本地data目录
      const dataDir = getStorageDir('data')
      const files = await fs.readdir(dataDir)
      
      // 筛选出昨天的JSONL文件
      const targetFiles = files.filter(file => 
        file.endsWith(`_${dateStr}.jsonl`) && 
        file !== `.${dateStr}.jsonl` // 排除异常文件名
      )

      if (targetFiles.length === 0) {
        // 只在调试模式下记录详细信息
        if (config.debug) {
          logger.info(`没有找到昨天(${dateStr})的聊天记录文件`)
        }
        return
      }

      // 简化非调试模式的文件发现日志
      if (config.debug) {
        logger.info(`发现 ${targetFiles.length} 个待上传文件: ${targetFiles.join(', ')}`)
      } else {
        logger.info(`发现 ${targetFiles.length} 个待上传文件`)
      }

      // 准备上传文件列表
      const filesToUpload: Array<{
        filePath: string
        key: string
        groupKey: string
      }> = []

      for (const fileName of targetFiles) {
        // 从文件名提取群组信息：groupKey_dateStr.jsonl
        const groupKey = fileName.replace(`_${dateStr}.jsonl`, '')
        const filePath = path.join(dataDir, fileName)
        
        // 检查文件是否存在且有内容
        try {
          const fileStats = await fs.stat(filePath)
          if (fileStats.size === 0) {
            logger.warn(`跳过空文件: ${fileName}`)
            continue
          }
        } catch (error) {
          logger.warn(`文件状态检查失败: ${fileName}`)
          continue
        }

        // 🔑 关键：检查该日期该群组是否已经上传过
        const isAlreadyUploaded = await checkIfDateGroupAlreadyUploaded(yesterday, groupKey)
        if (isAlreadyUploaded) {
          // 只在调试模式下记录详细信息
          if (config.debug) {
            logger.info(`跳过已上传文件: ${fileName} (群组 ${groupKey} 的 ${dateStr} 记录已上传)`)
          }
          continue
        }

        // 生成S3键名
        const s3Key = S3Uploader.generateChatLogKey(
          yesterday, 
          groupKey === 'private' ? undefined : groupKey
        )

        filesToUpload.push({
          filePath,
          key: s3Key,
          groupKey
        })
      }

      if (filesToUpload.length === 0) {
        // 只在调试模式下记录详细信息
        if (config.debug) {
          logger.info('没有有效的文件需要上传')
        }
        return
      }

      // 批量上传文件
      logger.info(`开始上传 ${filesToUpload.length} 个文件`)

      // 改为并行上传，并添加超时控制
      const uploadPromises = filesToUpload.map(async (fileToUpload) => {
        try {
          // 简化非调试模式的上传日志
          if (config.debug) {
            logger.info(`正在上传: ${path.basename(fileToUpload.filePath)} -> ${fileToUpload.key}`)
          }
          
          // 使用Promise.race添加60秒超时
          const uploadPromise = s3Uploader.uploadFile(
            fileToUpload.filePath, 
            fileToUpload.key, 
            'application/x-ndjson; charset=utf-8'
          )
          
          const timeoutPromise = new Promise<UploadResult>((_, reject) => {
            setTimeout(() => reject(new Error('上传超时（60秒）')), 60000)
          })
          
          const result = await Promise.race([uploadPromise, timeoutPromise])
          
          const resultWithMeta = { ...result, groupKey: fileToUpload.groupKey, filePath: fileToUpload.filePath }

          if (result.success) {
            // 简化非调试模式的成功日志
            if (config.debug) {
              logger.info(`✅ 群组 ${fileToUpload.groupKey} 上传成功: ${result.url}`)
            }
            
            // 获取文件大小和记录数
            const fileStats = await fs.stat(fileToUpload.filePath)
            const fileSize = fileStats.size
            
            // 统计文件中的记录数
            const fileContent = await fs.readFile(fileToUpload.filePath, 'utf-8')
            const recordCount = fileContent.split('\n').filter(line => line.trim().length > 0).length
            
            // 创建或更新聊天记录文件上传记录
            await createOrUpdateChatLogFileRecord(
              yesterday, 
              fileToUpload.groupKey, 
              fileToUpload.filePath, 
              fileToUpload.key, 
              fileSize, 
              recordCount,
              result.url,
              'uploaded'
            )
            
            // 上传成功后删除本地文件（根据保留天数配置）
            await handleFileRetention(fileToUpload.filePath, fileToUpload.groupKey, yesterday)
            
          } else {
            logger.error(`❌ 群组 ${fileToUpload.groupKey} 上传失败: ${result.error}`)
            
            // 记录失败状态
            const fileStats = await fs.stat(fileToUpload.filePath).catch(() => ({ size: 0 }))
            await createOrUpdateChatLogFileRecord(
              yesterday, 
              fileToUpload.groupKey, 
              fileToUpload.filePath, 
              fileToUpload.key, 
              fileStats.size, 
              0,
              undefined,
              'failed',
              result.error
            )
          }
          
          return resultWithMeta
        } catch (error: any) {
          logger.error(`处理文件 ${fileToUpload.groupKey} 时发生错误`, error)
          return { success: false, error: error.message, groupKey: fileToUpload.groupKey, filePath: fileToUpload.filePath }
        }
      })

      // 等待所有上传完成，使用allSettled避免单个失败影响其他上传
      const settledResults = await Promise.allSettled(uploadPromises)
      const finalResults = settledResults.map(result => 
        result.status === 'fulfilled' ? result.value : { success: false, error: '上传异常' }
      )

      // 统计上传结果
      const successCount = finalResults.filter(r => r.success).length
      const totalCount = finalResults.length
      logger.info(`聊天记录自动上传完成: ${successCount}/${totalCount} 个文件上传成功`)

    } catch (error: any) {
      logger.error('执行聊天记录自动上传时发生错误', error)
    }
  }

  // 设置定时上传任务
  const scheduleAutoUpload = (): void => {
    if (uploadScheduler) {
      clearTimeout(uploadScheduler)
    }

    const nextExecution = getNextExecutionTime(config.chatLog.autoUploadTime)
    const delay = nextExecution.getTime() - Date.now()

    // 只在调试模式下显示详细的下次执行时间
    if (config.debug) {
      logger.info(`下次聊天记录自动上传时间: ${nextExecution.toLocaleString('zh-CN')}`)
    }

    uploadScheduler = setTimeout(async () => {
      await executeAutoUpload()
      // 执行数据库清理
      await executeDatabaseCleanup()
      // 设置下一次执行
      scheduleAutoUpload()
    }, delay)
  }

  // 执行数据库清理
  const executeDatabaseCleanup = async (): Promise<void> => {
    try {
      if (config.debug) {
        logger.info('开始执行数据库清理')
      }

      const result = await dbOps.cleanupExpiredRecords(config.chatLog.dbRetentionHours)
      
      const totalDeleted = result.deletedChatRecords + result.deletedImageRecords + result.deletedFileRecords + result.deletedVideoRecords
      
      if (totalDeleted > 0) {
        logger.info(`数据库清理完成: 删除 ${result.deletedChatRecords} 条聊天记录, ${result.deletedImageRecords} 条图片记录, ${result.deletedFileRecords} 条文件记录, ${result.deletedVideoRecords} 条视频记录`)
      } else if (config.debug) {
        logger.info('数据库清理完成: 没有过期记录需要清理')
      }

      // 执行独立的本地文件清理
      await executeLocalFileCleanup()

    } catch (error: any) {
      logger.error('执行数据库清理时发生错误', error)
    }
  }

  // 执行独立的本地文件清理
  const executeLocalFileCleanup = async (): Promise<void> => {
    try {
      if (config.chatLog.retentionDays <= 0) {
        return // 如果保留天数为0或负数，跳过文件清理
      }

      const dataDir = getStorageDir('data')
      const files = await fs.readdir(dataDir).catch(() => [])
      
      if (files.length === 0) {
        return
      }

      const retentionDate = getCurrentTimeInUTC8()
      retentionDate.setDate(retentionDate.getDate() - config.chatLog.retentionDays)
      
      let deletedCount = 0
      let checkedCount = 0

      for (const fileName of files) {
        if (!fileName.endsWith('.jsonl')) {
          continue // 只处理.jsonl文件
        }

        const filePath = path.join(dataDir, fileName)
        
        try {
          const fileStats = await fs.stat(filePath)
          checkedCount++
          
          if (fileStats.mtime <= retentionDate) {
            await fs.unlink(filePath)
            deletedCount++
            
            if (config.debug) {
              logger.info(`已清理过期本地文件: ${fileName} (修改时间: ${fileStats.mtime.toLocaleString('zh-CN')})`)
            }
          }
        } catch (error: any) {
          if (config.debug) {
            logger.warn(`处理本地文件失败: ${fileName} - ${error.message}`)
          }
        }
      }

      if (deletedCount > 0) {
        logger.info(`本地文件清理完成: 检查 ${checkedCount} 个文件, 删除 ${deletedCount} 个过期文件 (保留${config.chatLog.retentionDays}天)`)
      } else if (config.debug) {
        logger.info(`本地文件清理完成: 检查 ${checkedCount} 个文件, 无过期文件需要删除`)
      }

    } catch (error: any) {
      logger.error('执行本地文件清理时发生错误', error)
    }
  }

  // 数据库清理调度器
  let cleanupScheduler: NodeJS.Timeout | null = null

  // 设置定时数据库清理任务（每小时执行一次）
  const scheduleDbCleanup = (): void => {
    if (cleanupScheduler) {
      clearInterval(cleanupScheduler)
    }

    // 每小时清理一次数据库
    cleanupScheduler = setInterval(async () => {
      await executeDatabaseCleanup()
    }, 60 * 60 * 1000) // 1小时 = 60分钟 × 60秒 × 1000毫秒

    if (config.debug) {
      logger.info('数据库清理任务已启动，每小时执行一次')
    }
  }

  // 获取群组的有效配置（合并默认值）
  const getEffectiveGroupConfig = (groupConfig: typeof config.monitor.groups[0]) => {
    const defaultSummaryTime = config.ai.defaultSummaryTime || '03:00'
    const defaultPushTime = config.ai.defaultPushTime || defaultSummaryTime

    return {
      groupId: groupConfig.groupId,
      name: groupConfig.name,
      monitorEnabled: groupConfig.monitorEnabled !== false, // 默认 true
      summaryEnabled: groupConfig.summaryEnabled !== undefined ? groupConfig.summaryEnabled : config.ai.enabled,
      summaryTime: groupConfig.summaryTime || defaultSummaryTime,
      pushEnabled: groupConfig.pushEnabled !== false, // 默认 true
      pushTime: groupConfig.pushTime || groupConfig.summaryTime || defaultPushTime,
      pushToSelf: groupConfig.pushToSelf !== false, // 默认 true
      forwardGroups: groupConfig.forwardGroups || [],
      systemPrompt: groupConfig.systemPrompt,
      userPromptTemplate: groupConfig.userPromptTemplate
    }
  }

  // 执行指定群组的AI总结生成
  const executeGroupSummary = async (groupId: string): Promise<string | undefined> => {
    if (!config.ai.enabled) {
      if (config.debug) {
        logger.info(`AI总结功能已禁用，跳过群组 ${groupId}`)
      }
      return
    }

    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化，无法执行自动总结')
      return
    }

    try {
      // 获取昨天的日期字符串（基于UTC+8时区）
      const yesterday = getCurrentTimeInUTC8()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = getDateStringInUTC8(yesterday.getTime())

      // 获取该群组的聊天记录文件
      const record = await dbOps.getChatLogFileForRetry(dateStr, groupId)

      if (!record) {
        if (config.debug) {
          logger.info(`群组 ${groupId} 在 ${dateStr} 没有需要生成AI总结的记录`)
        }
        return
      }

      // 检查是否已经生成过总结
      if (record.summaryImageUrl) {
        if (config.debug) {
          logger.info(`群组 ${groupId} 在 ${dateStr} 已生成过AI总结，跳过`)
        }
        return record.summaryImageUrl
      }

      logger.info(`开始为群组 ${groupId} 生成AI总结 (${dateStr})`)

      // 生成总结但不自动推送（推送由 pushScheduler 控制）
      const imageUrl = await generateSummaryForRecord(record, true)

      if (imageUrl) {
        logger.info(`群组 ${groupId} 的AI总结生成成功: ${imageUrl}`)
      }

      return imageUrl

    } catch (error: any) {
      logger.error(`为群组 ${groupId} 执行自动AI总结时发生错误`, error)
      return
    }
  }

  // 执行指定群组的总结推送
  const executeGroupPush = async (groupId: string): Promise<void> => {
    const groupConfig = config.monitor.groups.find(g => g.groupId === groupId)
    if (!groupConfig) {
      logger.warn(`未找到群组 ${groupId} 的配置，跳过推送`)
      return
    }

    const effectiveConfig = getEffectiveGroupConfig(groupConfig)
    if (!effectiveConfig.pushEnabled) {
      if (config.debug) {
        logger.info(`群组 ${groupId} 已禁用推送`)
      }
      return
    }

    try {
      // 获取昨天的日期字符串
      const yesterday = getCurrentTimeInUTC8()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = getDateStringInUTC8(yesterday.getTime())

      // 获取总结图片URL
      const summaryImageUrl = await dbOps.getSummaryImageUrl(dateStr, groupId)

      if (!summaryImageUrl) {
        logger.warn(`群组 ${groupId} 在 ${dateStr} 没有可推送的AI总结图片`)
        return
      }

      logger.info(`开始推送群组 ${groupId} 的AI总结`)

      // 推送到本群
      if (effectiveConfig.pushToSelf) {
        await pushSummaryToGroup(summaryImageUrl, groupId)
      }

      // 推送到转发群组
      if (effectiveConfig.forwardGroups.length > 0) {
        for (const target of effectiveConfig.forwardGroups) {
          await pushSummaryToGroup(summaryImageUrl, target.groupId)
        }
      }

    } catch (error: any) {
      logger.error(`推送群组 ${groupId} 的总结失败`, error)
    }
  }

  // 执行自动AI总结生成（兼容旧逻辑，用于手动触发）
  const executeAutoSummary = async (): Promise<void> => {
    if (!config.ai.enabled) {
      if (config.debug) {
        logger.info('自动总结功能已禁用，跳过执行')
      }
      return
    }

    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化，无法执行自动总结')
      return
    }

    try {
      logger.info('开始执行自动AI总结生成')

      // 获取昨天的日期字符串（基于UTC+8时区）
      const yesterday = getCurrentTimeInUTC8()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = getDateStringInUTC8(yesterday.getTime())

      // 获取需要生成AI总结的聊天记录文件
      const recordsToSummarize = await dbOps.getChatLogFilesForSummary(dateStr)

      if (recordsToSummarize.length === 0) {
        if (config.debug) {
          logger.info(`没有找到需要生成AI总结的记录 (${dateStr})`)
        }
        return
      }

      logger.info(`发现 ${recordsToSummarize.length} 个文件需要生成AI总结`)

      // 逐个处理每个群组的记录
      for (const record of recordsToSummarize) {
        try {
          await generateSummaryForRecord(record)
        } catch (error: any) {
          logger.error(`为记录 ${record.id} 生成AI总结失败`, error)
        }
      }

      logger.info('自动AI总结生成完成')

    } catch (error: any) {
      logger.error('执行自动AI总结时发生错误', error)
    }
  }

  // 过滤聊天记录，只保留文本消息用于AI总结
  const filterMessagesForSummary = async (jsonContent: string): Promise<string> => {
    try {
      const lines = jsonContent.split('\n').filter(line => line.trim())
      const filteredMessages: any[] = []
      
      for (const line of lines) {
        try {
          const record = JSON.parse(line)
          
          // 只保留文本类型的消息
          if (record.messageType === 'text' && record.content && record.content.trim()) {
            filteredMessages.push({
              time: record.time,
              username: record.username,
              content: record.content,
              guildId: record.guildId,
              messageType: record.messageType
            })
          }
        } catch {
          // 跳过解析失败的行
        }
      }
      
      // 转换为文本格式，类似于export命令的txt格式
      const textContent = filteredMessages.map(msg => {
        const time = msg.time.split(' ')[1] || msg.time // 只保留时间部分
        return `${time} ${msg.username}: ${msg.content}`
      }).join('\n')
      
      return textContent
    } catch (error) {
      logger.error('过滤聊天记录失败', error)
      return jsonContent // 失败时返回原始内容
    }
  }

  // 推送总结图片到群组
  const pushSummaryToGroup = async (
    imageUrl: string,
    groupId: string,
    channelId?: string,
    platform?: string
  ): Promise<boolean> => {
    // 带凭据取回图片内容再发送，不把存储桶地址交给聊天平台去下载
    const messageElements = [await buildStoredImageElement(s3Service.getUploader(), imageUrl, (error) => {
      logger.warn(`读取总结图片失败，改为按地址发送: ${error?.message || error}`)
    })]

    for (const bot of ctx.bots) {
      try {
        // 如果指定了平台，检查 bot 是否匹配
        if (platform && bot.platform !== platform) {
          continue
        }

        // 使用 channelId（如果提供）或 groupId 作为目标
        const targetId = channelId || groupId
        await bot.sendMessage(targetId, messageElements)

        logger.info(`成功推送总结到群 ${groupId}${channelId ? ` (频道: ${channelId})` : ''}`)
        return true
      } catch (err) {
        if (config.debug) {
          logger.warn(`Bot ${bot.sid} 推送到 ${groupId} 失败: ${err}`)
        }
      }
    }

    logger.error(`所有 Bot 均无法推送到群 ${groupId}`)
    return false
  }

  // 推送总结到配置的群组（新版本：根据群组配置决定推送目标）
  const pushSummaryToConfiguredGroups = async (
    imageUrl: string,
    sourceGroupId: string | undefined
  ): Promise<void> => {
    if (!sourceGroupId) {
      if (config.debug) {
        logger.info('源群组ID为空，跳过推送')
      }
      return
    }

    // 查找源群组的配置
    const groupConfig = config.monitor.groups.find(g => g.groupId === sourceGroupId)
    if (!groupConfig) {
      if (config.debug) {
        logger.info(`群组 ${sourceGroupId} 不在配置列表中，跳过推送`)
      }
      return
    }

    const effectiveConfig = getEffectiveGroupConfig(groupConfig)
    if (!effectiveConfig.pushEnabled) {
      if (config.debug) {
        logger.info(`群组 ${sourceGroupId} 已禁用推送`)
      }
      return
    }

    const targets: string[] = []

    // 推送到本群
    if (effectiveConfig.pushToSelf) {
      targets.push(sourceGroupId)
    }

    // 推送到转发群组
    if (effectiveConfig.forwardGroups.length > 0) {
      for (const target of effectiveConfig.forwardGroups) {
        targets.push(target.groupId)
      }
    }

    if (targets.length === 0) {
      if (config.debug) {
        logger.info(`群组 ${sourceGroupId} 没有配置推送目标`)
      }
      return
    }

    logger.info(`开始推送群组 ${sourceGroupId} 的总结到 ${targets.length} 个目标`)

    for (const targetGroupId of targets) {
      try {
        await pushSummaryToGroup(imageUrl, targetGroupId)
      } catch (error: any) {
        logger.error(`推送到群组 ${targetGroupId} 失败`, error)
      }
    }
  }

  // 为单个记录生成AI总结，返回生成的图片URL
  // skipPush: 是否跳过自动推送到群组（手动 retry 时应设为 true）
  const generateSummaryForRecord = async (record: ChatLogFileRecord, skipPush: boolean = false): Promise<string | undefined> => {
    if (!record.s3Url) {
      logger.warn(`记录 ${record.id} 没有S3 URL，跳过`)
      return
    }

    const s3Uploader = s3Service.getUploader()
    if (!s3Uploader) {
      logger.error('S3上传器未初始化')
      return
    }

    try {
      const groupInfo = record.guildId ? `群组 ${record.guildId}` : '私聊'
      logger.info(`正在为 ${groupInfo} 生成增强版AI总结 (${record.date})`)

      // 1. 下载聊天记录内容（带凭据从存储桶读取，不依赖公开地址）
      // 以上传成功时写下的地址为准：重传后 s3Url 会更新，s3Key 不会
      const logKey = s3Uploader.keyFromUrl(record.s3Url) || record.s3Key
      if (!logKey) {
        throw new Error('无法确定聊天记录文件在存储桶中的位置')
      }
      const response = (await s3Uploader.getObjectBuffer(logKey)).toString('utf-8')

      if (!response) {
        throw new Error('无法下载聊天记录文件')
      }

      // 2. 初始化服务
      const statisticsService = new StatisticsService(ctx.logger('chat-summarizer:statistics'))
      const aiService = new AIService(ctx, config)
      const cardRenderer = new CardRenderer(ctx)

      // 3. 解析消息并生成统计数据
      const messages = statisticsService.parseMessages(response)
      const statistics = statisticsService.generateStatistics(messages, 10)

      logger.info(`统计完成: ${statistics.basicStats.totalMessages} 条消息, ${statistics.basicStats.uniqueUsers} 位用户`)

      // 4. 过滤文本消息用于AI分析
      const filteredContent = await filterMessagesForSummary(response)

      // 5. 生成结构化AI总结
      const aiContent = await aiService.generateStructuredSummary(
        filteredContent,
        record.date,
        statistics.basicStats.totalMessages,
        record.guildId || 'private',
        statistics.basicStats.uniqueUsers
      )

      // 6. 组装完整的 DailyReport
      const dailyReport: DailyReport = {
        date: record.date,
        guildId: record.guildId || 'private',
        aiContent,
        statistics,
        metadata: {
          generatedAt: Date.now(),
          aiModel: config.ai.model || 'gpt-3.5-turbo'
        }
      }

      // 7. 渲染卡片式图片
      const imageBuffer = await cardRenderer.renderDailyReport(dailyReport)

      // 8. 上传图片到S3
      const imageKey = `summary-images/${record.date}/${record.guildId || 'private'}_${record.id}_${Date.now()}.png`
      const uploadResult = await s3Uploader.uploadBuffer(imageBuffer, imageKey, 'image/png')

      if (uploadResult.success && uploadResult.url) {
        // 更新数据库记录
        await dbOps.updateChatLogFileSummaryImage(record.id!, uploadResult.url)

        logger.info(`✅ ${groupInfo} 增强版AI总结生成成功: ${uploadResult.url}`)

        // 推送总结到配置的群组（手动 retry 时跳过推送）
        if (!skipPush) {
          await pushSummaryToConfiguredGroups(uploadResult.url, record.guildId)
        }

        return uploadResult.url
      } else {
        throw new Error(`图片上传失败: ${uploadResult.error}`)
      }

    } catch (error: any) {
      logger.error(`为记录 ${record.id} 生成AI总结失败`, error)
      throw error
    }
  }

  // 多时间点调度器：按时间分组的定时器
  const schedulers: Map<string, NodeJS.Timeout> = new Map()

  // 清理所有调度器
  const clearAllSchedulers = (): void => {
    for (const [time, timeout] of schedulers.entries()) {
      clearTimeout(timeout)
      if (config.debug) {
        logger.info(`已清理 ${time} 的调度器`)
      }
    }
    schedulers.clear()
  }

  // 获取所有配置的时间点及其对应的群组
  const getScheduleTimePoints = (): Map<string, { summaryGroups: string[], pushGroups: string[] }> => {
    const timePoints = new Map<string, { summaryGroups: string[], pushGroups: string[] }>()

    for (const groupConfig of config.monitor.groups) {
      const effective = getEffectiveGroupConfig(groupConfig)

      // 如果启用了总结功能
      if (effective.summaryEnabled) {
        const summaryTime = effective.summaryTime
        if (!timePoints.has(summaryTime)) {
          timePoints.set(summaryTime, { summaryGroups: [], pushGroups: [] })
        }
        timePoints.get(summaryTime)!.summaryGroups.push(effective.groupId)
      }

      // 如果启用了推送功能
      if (effective.pushEnabled) {
        const pushTime = effective.pushTime
        if (!timePoints.has(pushTime)) {
          timePoints.set(pushTime, { summaryGroups: [], pushGroups: [] })
        }
        timePoints.get(pushTime)!.pushGroups.push(effective.groupId)
      }
    }

    return timePoints
  }

  // 为单个时间点设置调度器
  const scheduleTimePoint = (time: string, tasks: { summaryGroups: string[], pushGroups: string[] }): void => {
    // 清除旧的同时间调度器
    if (schedulers.has(time)) {
      clearTimeout(schedulers.get(time)!)
    }

    const nextExecution = getNextExecutionTime(time)
    const delay = nextExecution.getTime() - Date.now()

    if (config.debug) {
      const summaryInfo = tasks.summaryGroups.length > 0 ? `总结: ${tasks.summaryGroups.join(', ')}` : ''
      const pushInfo = tasks.pushGroups.length > 0 ? `推送: ${tasks.pushGroups.join(', ')}` : ''
      const taskInfo = [summaryInfo, pushInfo].filter(Boolean).join(' | ')
      logger.info(`调度 ${time}: ${taskInfo} (下次执行: ${nextExecution.toLocaleString('zh-CN')})`)
    }

    const timeout = setTimeout(async () => {
      logger.info(`执行 ${time} 的定时任务`)

      // 执行总结任务
      if (tasks.summaryGroups.length > 0) {
        for (const groupId of tasks.summaryGroups) {
          try {
            await executeGroupSummary(groupId)
          } catch (error: any) {
            logger.error(`群组 ${groupId} 总结生成失败`, error)
          }
        }
      }

      // 执行推送任务
      if (tasks.pushGroups.length > 0) {
        for (const groupId of tasks.pushGroups) {
          try {
            await executeGroupPush(groupId)
          } catch (error: any) {
            logger.error(`群组 ${groupId} 推送失败`, error)
          }
        }
      }

      // 重新调度下一天
      scheduleTimePoint(time, tasks)
    }, delay)

    schedulers.set(time, timeout)
  }

  // 设置所有自动总结和推送任务
  const scheduleAllTasks = (): void => {
    if (!config.ai.enabled) {
      if (config.debug) {
        logger.info('AI功能未启用，跳过调度')
      }
      return
    }

    if (config.monitor.groups.length === 0) {
      if (config.debug) {
        logger.info('没有配置群组，跳过调度')
      }
      return
    }

    // 清除所有现有调度器
    clearAllSchedulers()

    // 获取所有时间点
    const timePoints = getScheduleTimePoints()

    if (timePoints.size === 0) {
      if (config.debug) {
        logger.info('没有需要调度的任务')
      }
      return
    }

    // 为每个时间点设置调度器
    for (const [time, tasks] of timePoints.entries()) {
      scheduleTimePoint(time, tasks)
    }

    logger.info(`已设置 ${timePoints.size} 个时间点的定时任务`)
  }

  // 兼容旧版本的调度函数（保留供外部调用）
  const scheduleAutoSummary = (): void => {
    scheduleAllTasks()
  }

  // 初始化插件
  const initializePlugin = async (): Promise<void> => {
    try {
      await initStorageDirs()
      s3Service.init()
      
      // 初始化命令处理器
      const commandHandler = new CommandHandler(
        ctx,
        config,
        dbOps,
        s3Service.getUploader(),
        getStorageDir,
        getNextExecutionTime,
        generateSummaryForRecord
      )
      commandHandler.registerCommands()
      
      // 启动定时上传任务
      if (config.chatLog.enabled && s3Service.getUploader()) {
        scheduleAutoUpload()
      }
      
      // 启动数据库清理任务
      if (config.chatLog.enabled) {
        scheduleDbCleanup()
        // 启动时执行一次清理
        setTimeout(() => executeDatabaseCleanup(), 5000) // 延迟5秒启动，避免启动时资源竞争
      }
      
      // 启动自动AI总结和推送任务（新版本调度器）
      if (config.ai.enabled && s3Service.getUploader() && config.monitor.groups.length > 0) {
        scheduleAllTasks()
      }

      // 显示初始化状态
      if (config.debug) {
        logger.info('插件初始化完成 (调试模式已开启)')
        logger.info(`数据库记录保留时间: ${config.chatLog.dbRetentionHours} 小时`)

        // 显示每个群组的配置
        for (const groupConfig of config.monitor.groups) {
          const effective = getEffectiveGroupConfig(groupConfig)
          const groupName = effective.name ? `${effective.name}(${effective.groupId})` : effective.groupId
          logger.info(`群组 ${groupName}: 监控=${effective.monitorEnabled}, 总结=${effective.summaryEnabled}@${effective.summaryTime}, 推送=${effective.pushEnabled}@${effective.pushTime}`)
        }
      } else {
        logger.info('插件初始化完成')
        if (config.monitor.groups.length > 0) {
          const summaryEnabledGroups = config.monitor.groups.filter(g =>
            getEffectiveGroupConfig(g).summaryEnabled
          ).length
          if (summaryEnabledGroups > 0) {
            logger.info(`自动AI总结已启用，${summaryEnabledGroups} 个群组已配置`)
          }
        }
      }
      
    } catch (error: any) {
      logger.error('插件初始化失败', error)
    }
  }

  // 主消息处理逻辑
  ctx.on('message', async (session: Session) => {
    if (!shouldMonitorMessage(session)) {
      return
    }

    try {
      const messageId = session.messageId || `${session.userId}_${Date.now()}`
      const timestamp = session.timestamp || Date.now()
             const username = session.username || '未知用户'
      const userId = messageService.normalizeUserId(session.userId)
      const guildId = session.guildId
      const channelId = session.channelId || session.userId

      const processed = messageService.processElements(session.elements)
      
      let content = processed.content
      content = await addReplyPrefix(content, session)

              const record: Omit<ChatRecord, 'id'> = {
          messageId,
          guildId,
          channelId,
          userId,
          username,
          content,
          originalElements: safeJsonStringify(session.elements),
          timestamp,
          messageType: processed.messageType,
          imageUrls: processed.imageUrls.length > 0 ? safeJsonStringify(processed.imageUrls) : undefined,
          fileUrls: processed.fileUrls.length > 0 ? safeJsonStringify(processed.fileUrls) : undefined,
          videoUrls: processed.videoUrls.length > 0 ? safeJsonStringify(processed.videoUrls) : undefined,
          isUploaded: false
        }

      // 保存到数据库
      await dbOps.createChatRecord(record)

      // 保存到本地文件
      await saveMessageToLocalFile(record)

      // 异步处理图片、文件和视频上传（不等待，避免阻塞消息处理）
      if (processed.imageUrls.length > 0 || processed.fileUrls.length > 0 || processed.videoUrls.length > 0) {
        // 🔑 关键修复：使用 Promise.resolve().then() 确保不阻塞，并捕获错误
        Promise.resolve().then(() => 
          processFileUploadsAsync(processed.imageUrls, processed.fileUrls, processed.videoUrls, messageId, guildId, record)
        ).catch(error => {
          logger.error('异步文件上传处理失败', error)
        })
      }

      // 简化非调试模式的消息处理日志
      if (config.debug) {
        logger.info(`消息处理完成: ${username} - ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`)
      }

    } catch (error: any) {
      logger.error('处理消息时发生错误', error)
    }
  })

  // 启动插件
  ctx.on('ready', initializePlugin)

  // 插件卸载时清理资源
  ctx.on('dispose', async () => {
    if (uploadScheduler) {
      clearTimeout(uploadScheduler)
      uploadScheduler = null
    }
    if (cleanupScheduler) {
      clearInterval(cleanupScheduler)
      cleanupScheduler = null
    }

    // 清理所有多时间点调度器
    clearAllSchedulers()

    // 等待所有文件写入操作完成并清理资源
    try {
      await fileWriter.flush()
      fileWriter.dispose()
      logger.info('所有文件写入操作已完成，文件写入器已清理')
    } catch (error: any) {
      logger.error('等待文件写入完成时发生错误', error)
    }

    logger.info('聊天记录插件已卸载，已清理所有定时任务')
  })
} 