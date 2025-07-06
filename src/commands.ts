import { Context, Session, h } from 'koishi'
import { Config, PluginStats } from './types'
import { DatabaseOperations } from './database'
import { S3Uploader } from './s3-uploader'
import { safeJsonParse } from './utils'
import { ExportManager, ExportRequest } from './export'
import { AIService } from './ai-service'
import { MarkdownToImageService } from './md-to-image'
import axios from 'axios'

// 命令处理类
export class CommandHandler {
  private exportManager: ExportManager
  private aiService: AIService
  private mdToImageService: MarkdownToImageService

  constructor(
    private ctx: Context,
    private config: Config,
    private dbOps: DatabaseOperations,
    private s3Uploader: S3Uploader | null,
    private getStorageDir: (subDir: string) => string,
    private getNextExecutionTime: (targetTime: string) => Date
  ) {
    this.exportManager = new ExportManager(ctx, s3Uploader, getStorageDir)
    this.aiService = new AIService(ctx, config)
    this.mdToImageService = new MarkdownToImageService(ctx)
  }

  // 处理用户ID，去除平台前缀，只保留QQ号
  private normalizeQQId(userId: string): string {
    if (!userId) return ''
    const colonIndex = userId.indexOf(':')
    if (colonIndex !== -1) {
      return userId.substring(colonIndex + 1)
    }
    return userId
  }

  // 检查是否为管理员
  private isAdmin(userId: string): boolean {
    const normalizedId = this.normalizeQQId(userId)
    return this.config.admin.adminIds.includes(normalizedId)
  }

  // 封装发送消息的函数，处理私聊和群聊的不同格式
  private async sendMessage(session: Session, content: any[]): Promise<string[]> {
    try {
      const promptMessage = session.channelId?.startsWith('private:')
        ? [h.quote(session.messageId), ...content]
        : [h.quote(session.messageId), h.at(session.userId), '\n', ...content]

      return await session.send(promptMessage)
    } catch (error: any) {
      const normalizedUserId = this.normalizeQQId(session.userId)
      console.error(`向QQ(${normalizedUserId})发送消息失败: ${error?.message || '未知错误'}`)
      return []
    }
  }

  // 注册所有命令
  registerCommands(): void {
    // 状态命令
    this.ctx.command('cs.status', '查看插件状态')
      .action(async ({ session }) => {
        return this.handleStatusCommand()
      })

    // 获取URL命令
    this.ctx.command('cs.geturl', '获取回复消息中图片/文件的S3链接（仅管理员可用）')
      .action(async ({ session }) => {
        await this.handleGetUrlCommand(session)
      })

    // 导出命令
    this.ctx.command('cs.export <guildId> <timeRange> [format]', '导出聊天记录（仅管理员可用）')
      .option('format', '-f <format:string>', { fallback: 'json' })
      .option('types', '-t <types:string>', { fallback: '' })
      .option('summarize', '-s, --summarize', { type: 'boolean', fallback: false })
      .option('image', '-i, --image', { type: 'boolean', fallback: false })
      .example('cs.export current yesterday - 导出当前群昨天的记录')
      .example('cs.export 123456789 2024-01-01,2024-01-31 txt - 导出指定群1月份记录为文本格式')
      .example('cs.export current last7days csv - 导出当前群最近7天记录为CSV格式')
      .example('cs.export current today txt -t text - 只导出文本类型消息')
      .example('cs.export current yesterday json -t text,image - 导出文本和图片消息')
      .example('cs.export current yesterday txt --summarize - 导出并生成AI总结')
      .example('cs.export current yesterday txt --summarize --image - 导出并生成AI总结图片')
      .action(async ({ session, options }, guildId, timeRange, format) => {
        await this.handleExportCommand(
          session, 
          guildId, 
          timeRange, 
          format || options?.format || 'json',
          options?.types || '',
          !!options?.summarize,
          !!options?.image
        )
      })
  }

  // 处理获取URL命令
  private async handleGetUrlCommand(session: Session): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 检查是否是回复消息
      if (!session.quote) {
        await this.sendMessage(session, [h.text('请回复包含图片或文件的消息后使用此命令')])
        return
      }

      const quotedMessageId = session.quote.messageId
      if (!quotedMessageId) {
        await this.sendMessage(session, [h.text('无法获取被回复消息的ID')])
        return
      }

      // 查找被回复消息的记录
      const chatRecords = await this.ctx.database.get('chat_records', {
        messageId: quotedMessageId
      })

      if (chatRecords.length === 0) {
        const retentionHours = this.config.chatLog.dbRetentionHours
        await this.sendMessage(session, [h.text(
          `❌ 未找到被回复消息的记录\n\n` +
          `💡 说明：数据库仅保留最近 ${retentionHours} 小时的消息记录作为缓存。\n` +
          `如果被回复的消息超过 ${retentionHours} 小时，记录可能已被自动清理。\n\n` +
          `建议：请回复最近 ${retentionHours} 小时内包含图片或文件的消息。`
        )])
        return
      }

      const record = chatRecords[0]
      const imageUrls = safeJsonParse(record.imageUrls, [])
      const fileUrls = safeJsonParse(record.fileUrls, [])

      // 查找图片记录
      const imageRecords = await this.ctx.database.get('image_records', {
        messageId: quotedMessageId
      })

      // 查找文件记录
      const fileRecords = await this.ctx.database.get('file_records', {
        messageId: quotedMessageId
      })

      let responseContent = ''
      let hasContent = false

      // 处理图片链接
      if (imageRecords.length > 0) {
        responseContent += '🖼️ 图片链接:\n'
        imageRecords.forEach((img, index) => {
          responseContent += `${index + 1}. ${img.s3Url}\n`
        })
        hasContent = true
      }

      // 处理文件链接
      if (fileRecords.length > 0) {
        if (hasContent) {
          responseContent += '\n'
        }
        responseContent += '📁 文件链接:\n'
        fileRecords.forEach((file, index) => {
          responseContent += `${index + 1}. ${file.fileName}\n${file.s3Url}\n`
          if (index < fileRecords.length - 1) {
            responseContent += '\n'
          }
        })
        hasContent = true
      }

      if (!hasContent) {
        await this.sendMessage(session, [h.text(
          `❌ 被回复的消息中没有找到已上传的图片或文件\n\n` +
          `💡 可能原因：\n` +
          `• 该消息不包含图片或文件\n` +
          `• 图片/文件尚未上传到S3\n` +
          `• 上传过程中出现错误\n\n` +
          `说明：只能查询已成功上传到S3的图片和文件链接。`
        )])
        return
      }

      // 发送链接信息
      await this.sendMessage(session, [h.text(responseContent.trim())])

    } catch (error: any) {
      console.error('处理获取URL命令失败:', error)
      await this.sendMessage(session, [h.text(`获取链接失败: ${error?.message || '未知错误'}`)])
    }
  }

  // 处理状态命令
  private async handleStatusCommand(): Promise<string> {
    const stats = await this.dbOps.getPluginStats()
    
    let statusText = '📊 聊天记录插件状态\n\n'
    
    // 基础配置
    statusText += '⚙️ 配置状态:\n'
    statusText += `• 聊天记录: ${this.config.chatLog.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
    statusText += `• S3存储: ${this.config.s3.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
    statusText += `• AI总结: ${this.config.ai.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
    statusText += `• 图片上传: ✅ 已启用\n`
    statusText += `• 调试模式: ${this.config.debug ? '✅ 已启用' : '❌ 已禁用'}\n`
    statusText += `• 数据库缓存: ${this.config.chatLog.dbRetentionHours} 小时\n`
    
    // S3配置详情
    if (this.config.s3.enabled) {
      statusText += '\n🌐 S3配置:\n'
      statusText += `• 端点: ${this.config.s3.endpoint || '未配置'}\n`
      statusText += `• 存储桶: ${this.config.s3.bucket}\n`
      statusText += `• 路径前缀: ${this.config.s3.pathPrefix}\n`
      statusText += `• 连接状态: ${this.s3Uploader ? '✅ 已连接' : '❌ 未连接'}\n`
    }
    
    // AI配置详情
    if (this.config.ai.enabled) {
      statusText += '\n🤖 AI配置:\n'
      statusText += `• API地址: ${this.config.ai.apiUrl || '未配置'}\n`
      statusText += `• 模型: ${this.config.ai.model || 'gpt-3.5-turbo'}\n`
      statusText += `• 最大Token: ${this.config.ai.maxTokens || 2000}\n`
      statusText += `• 连接状态: ${this.aiService.isEnabled() ? '✅ 已配置' : '❌ 未配置'}\n`
    }
    
    // 监控配置
    statusText += '\n👁️ 监控配置:\n'
    statusText += `• 监控群组: ${this.config.monitor.enabledGroups.length > 0 ? this.config.monitor.enabledGroups.join(', ') : '所有群组'}\n`
    statusText += `• 排除用户: ${this.config.monitor.excludedUsers.length > 0 ? this.config.monitor.excludedUsers.join(', ') : '无'}\n`
    statusText += `• 排除机器人: ${this.config.monitor.excludeBots ? '✅ 是' : '❌ 否'}\n`
    
    // 管理员配置
    statusText += '\n👨‍💼 管理员配置:\n'
    statusText += `• 管理员数量: ${this.config.admin.adminIds.length}\n`
    statusText += `• 管理员列表: ${this.config.admin.adminIds.length > 0 ? this.config.admin.adminIds.join(', ') : '无'}\n`
    
    // 统计信息
    statusText += '\n📈 统计信息:\n'
    statusText += `• 总消息数: ${stats.totalMessages}\n`
    statusText += `• 今日消息数: ${stats.todayMessages}\n`
    statusText += `• 图片记录数: ${stats.imageRecords}\n`
    statusText += `• 已上传消息数: ${stats.uploadedMessages}\n`
    
    // 存储路径
    statusText += '\n📁 存储路径:\n'
    statusText += `• 数据目录: ${this.getStorageDir('data')}\n`

    // 下次上传时间
    if (this.config.chatLog.enabled && this.s3Uploader) {
      const nextUpload = this.getNextExecutionTime(this.config.chatLog.autoUploadTime)
      statusText += `\n⏰ 下次自动上传: ${nextUpload.toLocaleString('zh-CN')}\n`
    }
    
    return statusText
  }

  // 处理导出命令
  private async handleExportCommand(
    session: Session, 
    guildId: string, 
    timeRange: string, 
    format: string, 
    types: string,
    enableSummarize: boolean,
    enableImageSummary: boolean
  ): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 验证格式
      const validFormats = ['json', 'txt', 'csv']
      if (!validFormats.includes(format.toLowerCase())) {
        await this.sendMessage(session, [h.text(`❌ 无效的导出格式: ${format}\n\n支持的格式: ${validFormats.join(', ')}`)])
        return
      }

      // 检查AI总结功能
      if (enableSummarize && !this.aiService.isEnabled()) {
        await this.sendMessage(session, [h.text('❌ AI总结功能未启用或配置不完整，请检查AI配置')])
        return
      }

      // 解析群组ID
      let targetGuildId: string | undefined
      
      if (guildId.toLowerCase() === 'current') {
        // 使用当前群组
        if (!session.guildId) {
          await this.sendMessage(session, [h.text('❌ 当前不在群聊中，无法使用 "current" 参数')])
          return
        }
        targetGuildId = session.guildId
      } else if (guildId.toLowerCase() === 'private') {
        // 私聊记录
        targetGuildId = undefined
      } else {
        // 具体群号
        targetGuildId = guildId
      }

      // 发送处理中消息
      const processingMessage = enableSummarize 
        ? '🔄 正在导出聊天记录并生成AI总结，请稍候...' 
        : '🔄 正在处理导出请求，请稍候...'
      const tempMessage = await this.sendMessage(session, [h.text(processingMessage)])

      // 构建导出请求
      const exportRequest: ExportRequest = {
        guildId: targetGuildId,
        timeRange: timeRange,
        format: format.toLowerCase() as 'json' | 'txt' | 'csv',
        messageTypes: types ? types.split(',').map(t => t.trim()).filter(t => t) : undefined
      }

      // 执行导出
      const result = await this.exportManager.exportChatData(exportRequest)

      if (!result.success || !result.s3Url) {
        // 删除临时消息
        if (tempMessage && tempMessage[0]) {
          await session.bot.deleteMessage(session.channelId, tempMessage[0])
        }
        // 导出失败
        await this.sendMessage(session, [h.text(result.error || '导出失败')])
        return
      }

      // 基础导出成功消息
      let responseMessage = result.message || '导出成功！'
      responseMessage += `\n\n📥 下载链接: ${result.s3Url}`

      // 如果启用AI总结，生成总结
      if (enableSummarize) {
        let aiTempMessage: string[] = []
        try {
          aiTempMessage = await this.sendMessage(session, [h.text('📝 正在生成AI总结...')])
          
          // 下载导出的文件内容
          const fileContent = await this.downloadExportContent(result.s3Url)
          
          if (!fileContent) {
            responseMessage += '\n\n⚠️ 无法下载导出文件进行AI总结'
          } else {
            // 生成AI总结
            const summary = await this.aiService.generateSummary(
              fileContent,
              timeRange,
              this.extractMessageCount(result.message || ''),
              targetGuildId || 'private'
            )
            
            // 如果启用图片总结，转换为图片发送
            if (enableImageSummary) {
              let imgTempMessage: string[] = []
              try {
                imgTempMessage = await this.sendMessage(session, [h.text('🖼️ 正在生成总结图片...')])
                
                const imageBuffer = await this.mdToImageService.convertToImage(summary)
                
                // 删除图片生成临时消息
                if (imgTempMessage && imgTempMessage[0]) {
                  await session.bot.deleteMessage(session.channelId, imgTempMessage[0])
                }
                
                // 发送图片
                await this.sendMessage(session, [h.image(imageBuffer, 'image/png')])
                
                // 不在文本消息中包含总结内容，只包含基础信息
                responseMessage += '\n\n✅ AI总结已生成并发送为图片'
              } catch (error: any) {
                // 删除图片生成临时消息(如果存在)
                if (imgTempMessage && imgTempMessage[0]) {
                  await session.bot.deleteMessage(session.channelId, imgTempMessage[0])
                }
                responseMessage += '\n\n❌ 图片生成失败: ' + (error?.message || '未知错误')
                responseMessage += '\n\n🤖 AI总结:\n' + summary
              }
            } else {
              responseMessage += '\n\n🤖 AI总结:\n' + summary
            }
            
            // 删除AI总结临时消息
            if (aiTempMessage && aiTempMessage[0]) {
              await session.bot.deleteMessage(session.channelId, aiTempMessage[0])
            }
          }
                  } catch (error: any) {
            // 删除AI总结临时消息
            if (aiTempMessage && aiTempMessage[0]) {
              await session.bot.deleteMessage(session.channelId, aiTempMessage[0])
            }
            responseMessage += '\n\n❌ AI总结过程中发生错误: ' + (error?.message || '未知错误')
          }
      }

      // 删除初始的临时消息
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0])
      }

      // 发送最终结果
      await this.sendMessage(session, [h.text(responseMessage)])

    } catch (error: any) {
      console.error('处理导出命令失败:', error)
      await this.sendMessage(session, [h.text(`❌ 导出过程中发生错误: ${error?.message || '未知错误'}`)])
    }
  }

  // 下载导出文件内容
  private async downloadExportContent(url: string): Promise<string | null> {
    try {
      const response = await axios.get(url, { 
        timeout: 30000,
        responseType: 'text'
      })
      return response.data
    } catch (error) {
      console.error('下载导出文件失败:', error)
      return null
    }
  }

  // 从导出结果消息中提取消息数量
  private extractMessageCount(message: string): number {
    const match = message.match(/📊 消息数量: (\d+) 条/)
    return match ? parseInt(match[1]) : 0
  }
} 