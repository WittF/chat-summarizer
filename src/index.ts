import { Context, Session, Element } from 'koishi'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Config, ChatRecord, ImageRecord, FileRecord } from './types'
import { name, inject, ConfigSchema } from './config'
import { extendDatabase, DatabaseOperations } from './database'
import { LoggerService, S3Service, MessageProcessorService } from './services'
import { CommandHandler } from './commands'
import { S3Uploader } from './s3-uploader'

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
    if (config.monitor.enabledGroups.length > 0) {
      if (!config.monitor.enabledGroups.includes(session.guildId)) {
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
  const addReplyPrefix = (content: string, session: Session): string => {
    if (!session.quote) {
      return content
    }

    const quoteAuthor = session.quote.user?.name || session.quote.user?.username || '某用户'
    const quoteContent = session.quote.content || ''
    const quoteId = session.quote.messageId || ''
    
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

  // URL替换函数
  const replaceImageUrl = (originalUrl: string): string => {
    // 替换 "cn-sy1.rains3.com/qqmsg" 为 "qqmsg.pan.wittf.ink"
    if (originalUrl.includes('cn-sy1.rains3.com/qqmsg')) {
      return originalUrl.replace('cn-sy1.rains3.com/qqmsg', 'qqmsg.pan.wittf.ink')
    }
    return originalUrl
  }

  // 保存消息到本地文件
  const saveMessageToLocalFile = async (record: ChatRecord): Promise<void> => {
    try {
      const date = new Date(record.timestamp)
      const dateStr = date.toISOString().split('T')[0]
      const groupKey = record.guildId || 'private'
      
      const logDir = getStorageDir('data')
      const fileName = `${groupKey}_${dateStr}.jsonl`
      const filePath = path.join(logDir, fileName)
      
      const logEntry = {
        timestamp: record.timestamp,
        time: date.toLocaleString('zh-CN'),
        messageId: record.messageId,
        guildId: record.guildId,
        channelId: record.channelId,
        userId: record.userId,
        username: record.username,
        content: record.content,
        messageType: record.messageType,
        imageUrls: record.imageUrls ? JSON.parse(record.imageUrls) : [],
        fileUrls: record.fileUrls ? JSON.parse(record.fileUrls) : [],
        originalElements: JSON.parse(record.originalElements)
      }
      
      const logLine = JSON.stringify(logEntry) + '\n'
      await fs.appendFile(filePath, logLine, 'utf8')
      
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

  // 异步处理图片和文件上传
  const processFileUploadsAsync = async (
    imageUrls: string[], 
    fileUrls: Array<{ url: string; fileName: string }>,
    messageId: string, 
    guildId: string | undefined,
    originalRecord: ChatRecord
  ): Promise<void> => {
    if (imageUrls.length === 0 && fileUrls.length === 0) {
      return
    }

    try {
      const urlMapping: Record<string, string> = {}
      const successfulImageUploads: string[] = []
      const successfulFileUploads: string[] = []

      // 处理图片上传
      if (imageUrls.length > 0) {
        const imageUploadPromises = imageUrls.map(imageUrl => 
          uploadImageToS3(imageUrl, messageId, guildId)
        )
        
        const imageUploadResults = await Promise.allSettled(imageUploadPromises)
        
        imageUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulImageUploads.push(result.value)
            urlMapping[imageUrls[index]] = result.value
          }
        })
      }

      // 处理文件上传
      if (fileUrls.length > 0) {
        const fileUploadPromises = fileUrls.map(fileInfo => 
          uploadFileToS3(fileInfo.url, fileInfo.fileName, messageId, guildId)
        )
        
        const fileUploadResults = await Promise.allSettled(fileUploadPromises)
        
        fileUploadResults.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value) {
            successfulFileUploads.push(result.value)
            urlMapping[fileUrls[index].url] = result.value
          }
        })
      }

      // 更新数据库记录
      if (successfulImageUploads.length > 0 || successfulFileUploads.length > 0) {
        // 更新content中的链接
        let updatedContent = originalRecord.content
        Object.entries(urlMapping).forEach(([originalUrl, newUrl]) => {
          updatedContent = updatedContent.replace(originalUrl, newUrl)
        })

        const updateData: Partial<ChatRecord> = {
          content: updatedContent
        }

        if (successfulImageUploads.length > 0) {
          updateData.imageUrls = JSON.stringify(successfulImageUploads)
        }

        if (successfulFileUploads.length > 0) {
          updateData.fileUrls = JSON.stringify(successfulFileUploads)
        }

        await dbOps.updateChatRecord(messageId, updateData)
        
        // 更新本地文件记录
        await updateLocalFileRecord({
          ...originalRecord,
          content: updatedContent,
          imageUrls: successfulImageUploads.length > 0 ? JSON.stringify(successfulImageUploads) : originalRecord.imageUrls,
          fileUrls: successfulFileUploads.length > 0 ? JSON.stringify(successfulFileUploads) : originalRecord.fileUrls
        })
      }
    } catch (error: any) {
      logger.error('批量上传文件时发生错误', error)
    }
  }

  // 更新本地文件记录
  const updateLocalFileRecord = async (record: ChatRecord): Promise<void> => {
    try {
      const date = new Date(record.timestamp)
      const dateStr = date.toISOString().split('T')[0]
      const groupKey = record.guildId || 'private'
      const fileName = `${groupKey}_${dateStr}.jsonl`
      const filePath = path.join(getStorageDir('data'), fileName)
      
      let existingContent = ''
      try {
        existingContent = await fs.readFile(filePath, 'utf8')
      } catch (error) {
        return
      }
      
      const lines = existingContent.split('\n').filter(line => line.trim())
      const updatedLines = lines.map(line => {
        try {
                  const lineRecord = JSON.parse(line)
        if (lineRecord.messageId === record.messageId) {
          return JSON.stringify({
            ...lineRecord,
            content: record.content,
            imageUrls: record.imageUrls ? JSON.parse(record.imageUrls) : [],
            fileUrls: record.fileUrls ? JSON.parse(record.fileUrls) : []
          })
        }
          return line
        } catch (error) {
          return line
        }
      })
      
      await fs.writeFile(filePath, updatedLines.join('\n') + '\n', 'utf8')
      
      // 只在调试模式下记录详细信息
      if (config.debug) {
        logger.info(`已更新本地文件记录: ${fileName}`)
      }
      
    } catch (error: any) {
      logger.error('更新本地文件记录失败', error)
    }
  }

  // 获取下次执行时间
  const getNextExecutionTime = (targetTime: string): Date => {
    const now = new Date()
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
        const retentionDate = new Date()
        retentionDate.setDate(retentionDate.getDate() - config.chatLog.retentionDays)
        
        if (uploadDate <= retentionDate) {
          await fs.unlink(filePath)
          
          // 只在调试模式下记录详细信息
          if (config.debug) {
            logger.info(`已删除过期文件: ${path.basename(filePath)} (保留${config.chatLog.retentionDays}天)`)
          }
        } else {
          // 只在调试模式下记录详细信息
          if (config.debug) {
            logger.info(`保留文件: ${path.basename(filePath)} (还需保留${Math.ceil((uploadDate.getTime() - retentionDate.getTime()) / (1000 * 60 * 60 * 24))}天)`)
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
      const startTime = new Date(date)
      startTime.setHours(0, 0, 0, 0)
      
      const endTime = new Date(date)
      endTime.setHours(23, 59, 59, 999)
      
      // 查询该日期和群组的记录
      const guildIdCondition = groupKey === 'private' ? undefined : groupKey
      
      // 检查是否有该日期的记录
      const totalRecords = await ctx.database.get('chat_records', {
        timestamp: { $gte: startTime.getTime(), $lte: endTime.getTime() },
        guildId: guildIdCondition
      })

      // 如果没有任何记录，说明该日期该群组没有消息，跳过
      if (totalRecords.length === 0) {
        logger.debug(`群组 ${groupKey} 在 ${date.toISOString().split('T')[0]} 没有消息记录`)
        return true // 返回true表示"跳过上传"
      }

      // 检查是否已经全部上传
      const unuploadedRecords = await ctx.database.get('chat_records', {
        timestamp: { $gte: startTime.getTime(), $lte: endTime.getTime() },
        guildId: guildIdCondition,
        isUploaded: false
      })

      const isFullyUploaded = unuploadedRecords.length === 0
      
      if (isFullyUploaded) {
        logger.debug(`群组 ${groupKey} 在 ${date.toISOString().split('T')[0]} 的 ${totalRecords.length} 条记录已全部上传`)
      } else {
        logger.debug(`群组 ${groupKey} 在 ${date.toISOString().split('T')[0]} 还有 ${unuploadedRecords.length}/${totalRecords.length} 条未上传记录`)
      }

      return isFullyUploaded
    } catch (error: any) {
      logger.error(`检查上传状态失败 (群组: ${groupKey})`, error)
      return false // 出错时允许上传，避免阻塞
    }
  }

  // 标记指定日期和群组的记录为已上传
  const markDateRecordsAsUploaded = async (date: Date, groupKey: string): Promise<void> => {
    try {
      const startTime = new Date(date)
      startTime.setHours(0, 0, 0, 0)
      
      const endTime = new Date(date)
      endTime.setHours(23, 59, 59, 999)
      
      // 查询该日期和群组的记录
      const guildIdCondition = groupKey === 'private' ? undefined : groupKey
      const records = await ctx.database.get('chat_records', {
        timestamp: { $gte: startTime.getTime(), $lte: endTime.getTime() },
        guildId: guildIdCondition,
        isUploaded: false
      })

      if (records.length > 0) {
        const recordIds = records.map(r => r.id!).filter(id => id)
        await dbOps.markAsUploaded(recordIds)
        
        // 只在调试模式下记录详细信息
        if (config.debug) {
          logger.info(`已标记 ${records.length} 条记录为已上传 (群组: ${groupKey}, 日期: ${date.toISOString().split('T')[0]})`)
        }
      }
    } catch (error: any) {
      logger.error(`标记记录为已上传失败 (群组: ${groupKey})`, error)
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

      // 获取昨天的日期字符串
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const dateStr = yesterday.toISOString().split('T')[0] // YYYY-MM-DD

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
      const uploadResults: any[] = []

      for (const fileToUpload of filesToUpload) {
        try {
          // 简化非调试模式的上传日志
          if (config.debug) {
            logger.info(`正在上传: ${path.basename(fileToUpload.filePath)} -> ${fileToUpload.key}`)
          }
          
          // 直接上传本地JSONL文件
          const result = await s3Uploader.uploadFile(
            fileToUpload.filePath, 
            fileToUpload.key, 
            'application/x-ndjson; charset=utf-8'
          )
          
          uploadResults.push({ ...result, groupKey: fileToUpload.groupKey, filePath: fileToUpload.filePath })

          if (result.success) {
            // 简化非调试模式的成功日志
            if (config.debug) {
              logger.info(`✅ 群组 ${fileToUpload.groupKey} 上传成功: ${result.url}`)
            }
            
            // 上传成功后删除本地文件（根据保留天数配置）
            await handleFileRetention(fileToUpload.filePath, fileToUpload.groupKey, yesterday)
            
            // 标记数据库中对应日期的记录为已上传
            await markDateRecordsAsUploaded(yesterday, fileToUpload.groupKey)
            
          } else {
            logger.error(`❌ 群组 ${fileToUpload.groupKey} 上传失败: ${result.error}`)
          }
        } catch (error: any) {
          logger.error(`处理文件 ${fileToUpload.groupKey} 时发生错误`, error)
        }
      }

      // 统计上传结果
      const successCount = uploadResults.filter(r => r.success).length
      const totalCount = uploadResults.length
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
      // 设置下一次执行
      scheduleAutoUpload()
    }, delay)
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
        getNextExecutionTime
      )
      commandHandler.registerCommands()
      
      // 启动定时上传任务
      if (config.chatLog.enabled && s3Service.getUploader()) {
        scheduleAutoUpload()
      }
      
      // 显示初始化状态
      if (config.debug) {
        logger.info('插件初始化完成 (调试模式已开启)')
      } else {
        logger.info('插件初始化完成')
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
      content = addReplyPrefix(content, session)

      const record: Omit<ChatRecord, 'id'> = {
        messageId,
        guildId,
        channelId,
        userId,
        username,
        content,
        originalElements: JSON.stringify(session.elements),
        timestamp,
        messageType: processed.messageType,
        imageUrls: processed.imageUrls.length > 0 ? JSON.stringify(processed.imageUrls) : undefined,
        fileUrls: processed.fileUrls.length > 0 ? JSON.stringify(processed.fileUrls) : undefined,
        isUploaded: false
      }

      // 保存到数据库
      await dbOps.createChatRecord(record)

      // 保存到本地文件
      await saveMessageToLocalFile(record)

      // 异步处理图片和文件上传
      if (processed.imageUrls.length > 0 || processed.fileUrls.length > 0) {
        processFileUploadsAsync(processed.imageUrls, processed.fileUrls, messageId, guildId, record)
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
  ctx.on('dispose', () => {
    if (uploadScheduler) {
      clearTimeout(uploadScheduler)
      uploadScheduler = null
    }
    logger.info('聊天记录插件已卸载，已清理所有定时任务')
  })
} 