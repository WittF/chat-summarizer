import { Context } from 'koishi'
import * as fs from 'fs/promises'
import * as path from 'path'
import { S3Uploader } from './s3-uploader'
import { safeJsonParse, getDateStringInUTC8, formatDateInUTC8, replaceImageUrl, formatDateSimple } from './utils'

export interface ExportRequest {
  guildId?: string       // 群组ID，undefined表示私聊
  timeRange: string      // 时间范围
  format: 'json' | 'txt' | 'csv'
  messageTypes?: string[] // 要导出的消息类型，默认为所有类型
}

export interface ExportResult {
  success: boolean
  s3Url?: string          // 带时效的下载地址
  content?: string        // 导出的文本内容
  error?: string
  message?: string
}

export interface ParsedTimeRange {
  startDate: Date
  endDate: Date
  dateStrings: string[]  // 需要的日期字符串列表
}

export interface ChatMessage {
  time: string
  username: string
  content: string
  guildId?: string
  messageType: string
}

export class ExportManager {
  constructor(
    private ctx: Context,
    private s3Uploader: S3Uploader | null,
    private getStorageDir: (subDir: string) => string
  ) {}

  /**
   * 解析时间范围
   */
  parseTimeRange(timeRange: string): ParsedTimeRange {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    let startDate: Date
    let endDate: Date

    switch (timeRange.toLowerCase()) {
      case 'today':
        startDate = new Date(today)
        endDate = new Date(today)
        endDate.setDate(endDate.getDate() + 1)
        endDate.setMilliseconds(-1)
        break
        
      case 'yesterday':
        startDate = new Date(today)
        startDate.setDate(startDate.getDate() - 1)
        endDate = new Date(today)
        endDate.setMilliseconds(-1)
        break
        
      case 'last7days':
        startDate = new Date(today)
        startDate.setDate(startDate.getDate() - 7)
        endDate = new Date(today)
        endDate.setMilliseconds(-1)
        break
        
      case 'lastweek':
        // 上周一到上周日
        const lastWeekEnd = new Date(today)
        lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay() - 1)
        lastWeekEnd.setHours(23, 59, 59, 999)
        
        startDate = new Date(lastWeekEnd)
        startDate.setDate(startDate.getDate() - 6)
        startDate.setHours(0, 0, 0, 0)
        
        endDate = lastWeekEnd
        break
        
      case 'thismonth':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        break
        
      case 'lastmonth':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
        break
        
      default:
        // 处理具体日期格式
        if (timeRange.includes(',')) {
          // 日期范围：2024-01-01,2024-01-31 或 01-01,01-31
          const [start, end] = timeRange.split(',')
          startDate = this.parseDate(start.trim())
          endDate = this.parseDate(end.trim())
          endDate.setHours(23, 59, 59, 999)
        } else {
          // 单个日期：2024-01-01 或 01-01
          startDate = this.parseDate(timeRange)
          endDate = new Date(startDate)
          endDate.setHours(23, 59, 59, 999)
        }
    }

    // 生成日期字符串列表
    const dateStrings: string[] = []
    const currentDate = new Date(startDate)
    
    while (currentDate <= endDate) {
      dateStrings.push(getDateStringInUTC8(currentDate.getTime()))
      currentDate.setDate(currentDate.getDate() + 1)
    }

    return { startDate, endDate, dateStrings }
  }

  /**
   * 解析日期字符串
   */
  private parseDate(dateStr: string): Date {
    const now = new Date()
    
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // 完整格式：2024-01-01
      return new Date(dateStr + 'T00:00:00')
    } else if (dateStr.match(/^\d{2}-\d{2}$/)) {
      // 简化格式：01-01 (当年)
      return new Date(`${now.getFullYear()}-${dateStr}T00:00:00`)
    } else {
      throw new Error(`无效的日期格式: ${dateStr}`)
    }
  }

  /**
   * 检查本地文件是否存在
   */
  private async checkLocalFiles(guildId: string | undefined, dateStrings: string[]): Promise<string[]> {
    const existingFiles: string[] = []
    const groupKey = guildId || 'private'
    const dataDir = this.getStorageDir('data')

    for (const dateStr of dateStrings) {
      const fileName = `${groupKey}_${dateStr}.jsonl`
      const filePath = path.join(dataDir, fileName)
      
      try {
        await fs.access(filePath)
        existingFiles.push(filePath)
      } catch {
        // 文件不存在
      }
    }

    return existingFiles
  }

  /**
   * 检查S3文件是否存在
   */
  private async checkS3Files(guildId: string | undefined, dateStrings: string[]): Promise<string[]> {
    if (!this.s3Uploader) {
      return []
    }

    const existingFiles: string[] = []
    
    // 获取chat-logs目录下的文件列表
    const result = await this.s3Uploader.listFiles('chat-logs/')
    if (!result.success || !result.files) {
      return []
    }

    const groupKey = guildId || 'private'
    
    for (const dateStr of dateStrings) {
      // 查找匹配的文件
      const matchingFile = result.files.find(file => {
        // 文件路径格式：chat-logs/2024-01-01/guild_123456_timestamp.json
        // 或：chat-logs/2024-01-01/private_timestamp.json
        const pattern = guildId 
          ? new RegExp(`chat-logs/${dateStr}/guild_${guildId}_\\d+\\.json$`)
          : new RegExp(`chat-logs/${dateStr}/private_\\d+\\.json$`)
        return pattern.test(file)
      })
      
      if (matchingFile) {
        existingFiles.push(matchingFile)
      }
    }

    return existingFiles
  }

  /**
   * 从S3下载文件到本地临时目录
   */
  private async downloadFromS3(s3Files: string[]): Promise<string[]> {
    if (!this.s3Uploader) {
      return []
    }

    const downloadedFiles: string[] = []
    const tempDir = path.join(this.getStorageDir('temp'))
    
    // 确保临时目录存在
    try {
      await fs.mkdir(tempDir, { recursive: true })
    } catch {
      // 目录已存在
    }

    for (const s3File of s3Files) {
      const fileName = path.basename(s3File)
      const localPath = path.join(tempDir, fileName)
      
      const result = await this.s3Uploader.downloadFile(s3File, localPath)
      if (result.success) {
        downloadedFiles.push(localPath)
      }
    }

    return downloadedFiles
  }

  /**
   * 读取和解析聊天记录文件
   */
  private async parseMessageFiles(filePaths: string[], messageTypes?: string[]): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = []
    
    // 默认导出所有类型的消息
    const allowedTypes = messageTypes && messageTypes.length > 0 
      ? messageTypes 
      : ['text', 'image', 'mixed', 'other']

    for (const filePath of filePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const lines = content.split('\n').filter(line => line.trim())
        
        for (const line of lines) {
          try {
            const record = safeJsonParse(line, null)
            if (record && record.timestamp && record.username && record.content) {
              const messageType = record.messageType || 'text'
              
              // 只导出指定类型的消息
              if (allowedTypes.includes(messageType)) {
                messages.push({
                  time: formatDateInUTC8(record.timestamp),
                  username: record.username,
                  content: record.content,
                  guildId: record.guildId,
                  messageType: messageType
                })
              }
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      } catch {
        // 跳过读取失败的文件
      }
    }

    // 按时间排序
    return messages.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
  }

  /**
   * 格式化导出内容
   */
  private formatExportContent(messages: ChatMessage[], format: string): string {
    if (messages.length === 0) {
      return ''
    }

    switch (format) {
      case 'txt':
        return messages.map(msg => {
          // 简化TXT格式：使用简化时间格式，去除消息种类信息
          const time = formatDateSimple(new Date(msg.time).getTime())
          return `${time} ${msg.username}: ${msg.content}`
        }).join('\n')
        
      case 'csv':
        const csvHeader = 'Time,Username,Content\n'
        const csvRows = messages.map(msg => 
          `"${msg.time}","${msg.username}","${msg.content.replace(/"/g, '""')}"`
        ).join('\n')
        return csvHeader + csvRows
        
      case 'json':
      default:
        return JSON.stringify(messages, null, 2)
    }
  }

  /**
   * 清理临时文件
   */
  private async cleanupTempFiles(tempFiles: string[]): Promise<void> {
    for (const file of tempFiles) {
      try {
        await fs.unlink(file)
      } catch {
        // 忽略删除失败
      }
    }
  }

  /**
   * 执行导出
   */
  public async exportChatData(request: ExportRequest): Promise<ExportResult> {
    try {
      // 解析时间范围
      const timeRange = this.parseTimeRange(request.timeRange)
      
      // 🔑 完全重写：为每个日期选择唯一的数据源，优先本地文件
      const groupKey = request.guildId || 'private'
      const filesToProcess: string[] = []
      const s3FilesToDownload: string[] = []
      const missingDates: string[] = []
      let localFileCount = 0
      let s3FileCount = 0
      
      // 🔑 性能优化：只调用一次S3 listFiles
      let s3FilesList: string[] = []
      if (this.s3Uploader) {
        const s3Result = await this.s3Uploader.listFiles('chat-logs/')
        if (s3Result.success && s3Result.files) {
          s3FilesList = s3Result.files
        }
      }
      
      // 对每个日期，按优先级选择数据源：本地 > S3
      for (const dateStr of timeRange.dateStrings) {
        // 1. 优先检查本地文件
        const localFileName = `${groupKey}_${dateStr}.jsonl`
        const localFilePath = path.join(this.getStorageDir('data'), localFileName)
        
        try {
          const stats = await fs.stat(localFilePath)
          // 检查文件存在且不为空
          if (stats.size > 0) {
            // 本地文件存在且有内容，使用本地文件
            filesToProcess.push(localFilePath)
            localFileCount++
            continue
          }
          // 文件为空，继续检查S3
        } catch {
          // 本地文件不存在，检查S3
        }
        
        // 2. 检查S3文件（使用已获取的文件列表）
        if (s3FilesList.length > 0) {
          const s3File = s3FilesList.find(file => {
            const pattern = request.guildId 
              ? new RegExp(`chat-logs/${dateStr}/guild_${request.guildId}_\\d+\\.json$`)
              : new RegExp(`chat-logs/${dateStr}/private_\\d+\\.json$`)
            return pattern.test(file)
          })
          
          if (s3File) {
            // S3文件存在，标记为需要下载
            s3FilesToDownload.push(s3File)
            s3FileCount++
            continue
          }
        }
        
        // 3. 本地和S3都没有，记录为缺失
        missingDates.push(dateStr)
      }
      
      // 检查数据完整性
      if (missingDates.length > 0) {
        const groupText = request.guildId ? `群组 ${request.guildId}` : '私聊'
        return {
          success: false,
          error: `❌ 数据不完整，拒绝部分导出\n\n` +
                 `📅 缺失日期: ${missingDates.join(', ')}\n` +
                 `💾 本地文件: ${localFileCount} 个\n` +
                 `☁️ S3文件: ${s3FileCount} 个\n\n` +
                 `请确保所有日期的数据都可用后再尝试导出。`
        }
      }
      
      if (localFileCount === 0 && s3FileCount === 0) {
        const groupText = request.guildId ? `群组 ${request.guildId}` : '私聊'
        return {
          success: false,
          error: `❌ 未找到 ${groupText} 在指定时间范围内的聊天记录\n\n` +
                 `📅 请求时间: ${timeRange.dateStrings.join(', ')}`
        }
      }
      
      // 下载S3文件（如果有的话）
      const downloadedFiles = s3FilesToDownload.length > 0 ? await this.downloadFromS3(s3FilesToDownload) : []
      
      // 解析所有消息，应用消息类型过滤
      const allFiles = [...filesToProcess, ...downloadedFiles]
      const messages = await this.parseMessageFiles(allFiles, request.messageTypes)
      
      if (messages.length === 0) {
        const typeFilter = request.messageTypes && request.messageTypes.length > 0 
          ? ` (消息类型: ${request.messageTypes.join(', ')})` 
          : ''
        return {
          success: false,
          error: `❌ 虽然找到了数据文件，但没有解析到有效的聊天记录${typeFilter}`
        }
      }

      // 格式化导出内容
      const exportContent = this.formatExportContent(messages, request.format)
      
      // 生成导出文件名
      const exportGroupKey = request.guildId || 'private'
      const timeStr = request.timeRange.replace(/[,\s]/g, '_')
      const typeStr = request.messageTypes && request.messageTypes.length > 0 
        ? `_${request.messageTypes.join('-')}` 
        : ''
      const exportFileName = `export_${exportGroupKey}_${timeStr}${typeStr}_${Date.now()}.${request.format}`
      
      // 上传到S3
      if (this.s3Uploader) {
        const uploadKey = `exports/${exportFileName}`
        const result = await this.s3Uploader.uploadText(
          exportContent, 
          uploadKey, 
          this.getContentType(request.format)
        )
        
        // 清理临时文件
        await this.cleanupTempFiles(downloadedFiles)
        
        if (result.success) {
          // 生成带时效的下载地址（24 小时），存储桶不需要公开读
          const finalUrl = result.key
            ? this.s3Uploader.getPresignedUrl(result.key, 86400)
            : replaceImageUrl(result.url)
          
          const typeInfo = request.messageTypes && request.messageTypes.length > 0 
            ? `📋 消息类型: ${request.messageTypes.join(', ')}\n` 
            : ''
          
          return {
            success: true,
            s3Url: finalUrl,
            content: exportContent,
            message: `✅ 导出成功！\n\n` +
                     `📊 消息数量: ${messages.length} 条\n` +
                     `📅 时间范围: ${timeRange.dateStrings.join(', ')}\n` +
                     `📄 格式: ${request.format.toUpperCase()}\n` +
                     typeInfo +
                     `💾 数据来源: ${localFileCount} 个本地文件 + ${s3FileCount} 个S3文件`
          }
        } else {
          return {
            success: false,
            error: `❌ 上传导出文件失败: ${result.error}`
          }
        }
      } else {
        return {
          success: false,
          error: '❌ S3上传器未初始化，无法上传导出文件'
        }
      }

    } catch (error: any) {
      return {
        success: false,
        error: `❌ 导出过程中发生错误: ${error?.message || '未知错误'}`
      }
    }
  }

  /**
   * 获取内容类型
   */
  private getContentType(format: string): string {
    switch (format) {
      case 'txt':
        return 'text/plain; charset=utf-8'
      case 'csv':
        return 'text/csv; charset=utf-8'
      case 'json':
      default:
        return 'application/json; charset=utf-8'
    }
  }
} 