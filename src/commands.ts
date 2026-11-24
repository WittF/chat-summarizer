import { Context, Session, h } from 'koishi'
import { Config, PluginStats } from './types'
import { DatabaseOperations } from './database'
import { S3Uploader } from './s3-uploader'
import { safeJsonParse, buildStoredImageElement, toTimedUrl } from './utils'
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
    private getNextExecutionTime: (targetTime: string) => Date,
    private generateSummaryForRecord: (record: any, skipPush?: boolean) => Promise<string | undefined>
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
    this.ctx.command('cs.export [guildId] [timeRange] [format]', '导出聊天记录（仅管理员可用）')
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

    // AI总结检查命令
    this.ctx.command('cs.summary.check [days]', '检查缺失的AI总结（仅管理员可用）')
      .example('cs.summary.check - 检查最近7天的缺失总结')
      .example('cs.summary.check 30 - 检查最近30天的缺失总结')
      .action(async ({ session }, days) => {
        await this.handleSummaryCheckCommand(session, days)
      })

    // AI总结重试命令
    this.ctx.command('cs.summary.retry <date> [guildId]', '重新生成指定日期的AI总结（仅管理员可用）')
      .example('cs.summary.retry 2024-01-01 - 重新生成2024-01-01所有群组的总结')
      .example('cs.summary.retry 2024-01-01 123456789 - 重新生成指定群组的总结')
      .example('cs.summary.retry 2024-01-01 private - 重新生成私聊的总结')
      .action(async ({ session }, date, guildId) => {
        await this.handleSummaryRetryCommand(session, date, guildId)
      })

    // AI总结获取命令
    this.ctx.command('cs.summary.get <date> [guildId]', '获取指定日期的AI总结图片（仅管理员可用）')
      .example('cs.summary.get 2024-01-01 - 获取2024-01-01当前群的AI总结图片（仅在群聊中有效）')
      .example('cs.summary.get 2024-01-01 123456789 - 获取指定群组的AI总结图片')
      .example('cs.summary.get 2024-01-01 private - 获取私聊的AI总结图片')
      .example('cs.summary.get yesterday - 获取昨天当前群的AI总结图片')
      .action(async ({ session }, date, guildId) => {
        await this.handleSummaryGetCommand(session, date, guildId)
      })

    // Markdown渲染测试命令
    this.ctx.command('cs.mdtest', '测试Markdown和Emoji渲染效果')
      .action(async ({ session }) => {
        await this.handleMdTestCommand(session)
      })

    // AI分析命令
    this.ctx.command('cs.analysis <query:text>', 'AI分析聊天记录（仅管理员可用）')
      .example('cs.analysis 昨天群里发生了什么大事？')
      .example('cs.analysis 最近一周大家聊了什么游戏？')
      .example('cs.analysis 今天谁最活跃？')
      .action(async ({ session }, query) => {
        await this.handleAnalysisCommand(session, query)
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
        responseContent += '🖼️ 图片链接（24小时内有效）:\n'
        imageRecords.forEach((img, index) => {
          responseContent += `${index + 1}. ${toTimedUrl(this.s3Uploader, img.s3Url, img.s3Key)}\n`
        })
        hasContent = true
      }

      // 处理文件链接
      if (fileRecords.length > 0) {
        if (hasContent) {
          responseContent += '\n'
        }
        responseContent += '📁 文件链接（24小时内有效）:\n'
        fileRecords.forEach((file, index) => {
          responseContent += `${index + 1}. ${file.fileName}\n${toTimedUrl(this.s3Uploader, file.s3Url, file.s3Key)}\n`
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
      statusText += `• 默认总结时间: ${this.config.ai.defaultSummaryTime || '03:00'}\n`
      statusText += `• 默认推送时间: ${this.config.ai.defaultPushTime || this.config.ai.defaultSummaryTime || '03:00'}\n`
      statusText += `• 连接状态: ${this.aiService.isEnabled() ? '✅ 已配置' : '❌ 未配置'}\n`
    }
    
    // 监控配置
    statusText += '\n👁️ 监控配置:\n'
    if (this.config.monitor.groups.length > 0) {
      statusText += `• 配置群组数: ${this.config.monitor.groups.length}\n`
      for (const group of this.config.monitor.groups) {
        const groupName = group.name ? `${group.name}(${group.groupId})` : group.groupId
        const parts: string[] = []
        if (group.monitorEnabled === false) parts.push('监控关')
        if (group.summaryEnabled === false) parts.push('总结关')
        else if (group.summaryTime) parts.push(`总结@${group.summaryTime}`)
        if (group.pushEnabled === false) parts.push('推送关')
        else if (group.pushTime) parts.push(`推送@${group.pushTime}`)
        if (group.pushToSelf === false) parts.push('不推本群')
        if (group.forwardGroups && group.forwardGroups.length > 0) {
          parts.push(`转发到${group.forwardGroups.length}群`)
        }
        if (group.systemPrompt) parts.push('自定义提示')
        const partsStr = parts.length > 0 ? ` (${parts.join(', ')})` : ''
        statusText += `  - ${groupName}${partsStr}\n`
      }
    } else {
      statusText += `• 监控群组: 所有群组（未配置自动总结）\n`
    }
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
    guildId?: string, 
    timeRange?: string, 
    format?: string, 
    types: string = '',
    enableSummarize: boolean = false,
    enableImageSummary: boolean = false
  ): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 如果没有提供参数，显示帮助信息
      if (!guildId || !timeRange) {
          const helpText = `🔧 命令格式：cs.export <群组> <时间范围> [格式] [选项]`
        await this.sendMessage(session, [h.text(helpText)])
        return
      }

      // 验证格式
      const validFormats = ['json', 'txt', 'csv']
      if (!validFormats.includes(format.toLowerCase())) {
        await this.sendMessage(session, [h.text(`❌ 无效的导出格式: ${format}\n\n支持的格式: ${validFormats.join(', ')}`)])
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

      // 检查AI总结功能
      if (enableSummarize && !this.aiService.isEnabled(targetGuildId)) {
        const guildInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
        await this.sendMessage(session, [h.text(`❌ AI总结功能未启用或配置不完整，或${guildInfo}已禁用AI功能，请检查AI配置`)])
        return
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
      responseMessage += `\n\n📥 下载链接（24小时内有效）: ${result.s3Url}`

      // 如果启用AI总结，生成总结
      if (enableSummarize) {
        let aiTempMessage: string[] = []
        try {
          aiTempMessage = await this.sendMessage(session, [h.text('📝 正在生成AI总结...')])
          
          // 直接使用刚导出的内容；拿不到时再按下载链接取
          const fileContent = result.content || await this.downloadExportContent(result.s3Url)
          
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
                
                // 图片生成失败，使用合并转发发送
                const errorMessage = responseMessage + '\n\n❌ 图片生成失败: ' + (error?.message || '未知错误')
                await this.sendSummaryAsForward(session, errorMessage, summary)
                // 清空responseMessage，避免重复发送
                responseMessage = ''
              }
            } else {
              // 使用合并转发发送AI总结
              await this.sendSummaryAsForward(session, responseMessage, summary)
              // 清空responseMessage，避免重复发送
              responseMessage = ''
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

      // 发送最终结果（如果没有使用合并转发）
      if (responseMessage.trim()) {
      await this.sendMessage(session, [h.text(responseMessage)])
      }

    } catch (error: any) {
      console.error('处理导出命令失败:', error)
      await this.sendMessage(session, [h.text(`❌ 导出过程中发生错误: ${error?.message || '未知错误'}`)])
    }
  }

  // 带凭据取图失败、退回按地址发送时留一条日志
  private warnImageFallback = (error: any) => {
    this.ctx.logger('chat-summarizer').warn(`读取总结图片失败，改为按地址发送: ${error?.message || error}`)
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

  // 使用合并转发发送AI总结
  private async sendSummaryAsForward(session: Session, exportMessage: string, summary: string): Promise<void> {
    try {
      // 构建合并转发消息
      const forwardMessages = [
        h('message', {}, [h.text('✅ 导出成功！')]),
        h('message', {}, [h.text(exportMessage)]),
        h('message', {}, [h.text('🤖 AI总结'), h.text('\n\n' + summary)])
      ]

      // 创建合并转发消息
      const forwardContent = h('message', { forward: true }, forwardMessages)

      // 发送合并转发消息
      await session.send(forwardContent)
      
    } catch (error: any) {
      // 如果合并转发失败，回退到普通发送
      const fullMessage = exportMessage + '\n\n🤖 AI总结:\n' + summary
      await this.sendMessage(session, [h.text(fullMessage)])
    }
  }

  // 处理AI总结检查命令
  private async handleSummaryCheckCommand(session: Session, days?: string): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 检查AI功能是否启用
      if (!this.aiService.isEnabled()) {
        await this.sendMessage(session, [h.text('❌ AI功能未启用，无法检查总结状态')])
        return
      }

      const checkDays = days ? parseInt(days) : 7
      if (isNaN(checkDays) || checkDays <= 0 || checkDays > 365) {
        await this.sendMessage(session, [h.text('❌ 无效的天数，请输入1-365之间的数字')])
        return
      }

      // 发送处理中消息
      const tempMessage = await this.sendMessage(session, [h.text('🔍 正在检查缺失的AI总结...')])

      // 计算日期范围
      const today = new Date()
      const endDate = today.toISOString().split('T')[0] // YYYY-MM-DD 格式
      const startDateObj = new Date(today)
      startDateObj.setDate(startDateObj.getDate() - checkDays + 1)
      const startDate = startDateObj.toISOString().split('T')[0]

      // 获取缺失总结的记录
      const missingSummaries = await this.dbOps.getMissingSummaryRecords(startDate, endDate)

      // 删除临时消息
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0])
      }

      if (missingSummaries.length === 0) {
        await this.sendMessage(session, [h.text(`✅ 最近${checkDays}天内所有已上传的聊天记录都已生成AI总结`)])
        return
      }

      // 按群组和日期整理缺失的记录
      const missingByGroup: Record<string, string[]> = {}
      missingSummaries.forEach(record => {
        const groupKey = record.guildId || 'private'
        if (!missingByGroup[groupKey]) {
          missingByGroup[groupKey] = []
        }
        missingByGroup[groupKey].push(record.date)
      })

      let responseText = `📊 最近${checkDays}天缺失AI总结的记录：\n\n`
      
      for (const [groupKey, dates] of Object.entries(missingByGroup)) {
        const groupName = groupKey === 'private' ? '私聊' : `群组 ${groupKey}`
        responseText += `🔸 ${groupName}：\n`
        responseText += `   📅 ${dates.join(', ')}\n\n`
      }

      responseText += `💡 使用命令重新生成：\n`
      responseText += `cs.summary.retry <日期> [群组ID]\n\n`
      responseText += `📝 示例：\n`
      responseText += `cs.summary.retry ${missingSummaries[0].date}\n`
      if (missingSummaries[0].guildId) {
        responseText += `cs.summary.retry ${missingSummaries[0].date} ${missingSummaries[0].guildId}`
      }

      await this.sendMessage(session, [h.text(responseText)])

    } catch (error: any) {
      console.error('检查AI总结失败:', error)
      await this.sendMessage(session, [h.text(`❌ 检查失败: ${error?.message || '未知错误'}`)])
    }
  }

  // 处理AI总结重试命令
  private async handleSummaryRetryCommand(session: Session, date: string, guildId?: string): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 检查AI功能是否启用
      if (!this.aiService.isEnabled()) {
        await this.sendMessage(session, [h.text('❌ AI功能未启用，无法生成总结')])
        return
      }

      // 验证日期格式
      if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        await this.sendMessage(session, [h.text('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式（如：2024-01-01）')])
        return
      }

      // 处理群组ID
      let targetGuildId: string | undefined
      if (guildId === 'private') {
        targetGuildId = undefined
      } else if (guildId) {
        targetGuildId = guildId
      }

      // 发送处理中消息
      const tempMessage = await this.sendMessage(session, [h.text('🔄 正在重新生成AI总结...')])

      // 如果指定了群组，处理单个群组
      if (targetGuildId !== undefined) {
        const record = await this.dbOps.getChatLogFileForRetry(date, targetGuildId)
        if (!record) {
          if (tempMessage && tempMessage[0]) {
            await session.bot.deleteMessage(session.channelId, tempMessage[0])
          }
          const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
          await this.sendMessage(session, [h.text(`❌ 未找到 ${groupInfo} 在 ${date} 的聊天记录文件`)])
          return
        }

        // 清除旧的总结记录
        if (record.summaryImageUrl) {
          await this.dbOps.clearSummaryImage(record.id!)
        }

        // 手动 retry 时跳过自动推送到群组
        const imageUrl = await this.generateSummaryForRecord(record, true)

        if (tempMessage && tempMessage[0]) {
          await session.bot.deleteMessage(session.channelId, tempMessage[0])
        }

        const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
        if (imageUrl) {
          await this.sendMessage(session, [
            h.text(`✅ ${groupInfo} 在 ${date} 的AI总结重新生成完成\n\n`),
            await buildStoredImageElement(this.s3Uploader, imageUrl, this.warnImageFallback)
          ])
        } else {
          await this.sendMessage(session, [h.text(`✅ ${groupInfo} 在 ${date} 的AI总结重新生成完成`)])
        }
      } else {
        // 处理该日期的所有群组
        const allRecords = await this.dbOps.getChatLogFilesForSummary(date)
        if (allRecords.length === 0) {
          if (tempMessage && tempMessage[0]) {
            await session.bot.deleteMessage(session.channelId, tempMessage[0])
          }
          await this.sendMessage(session, [h.text(`❌ 未找到 ${date} 的任何聊天记录文件`)])
          return
        }

        let successCount = 0
        let totalCount = allRecords.length
        const generatedUrls: Array<{ guildId: string | undefined; url: string }> = []

        for (const record of allRecords) {
          try {
            // 清除旧的总结记录
            if (record.summaryImageUrl) {
              await this.dbOps.clearSummaryImage(record.id!)
            }
            // 手动 retry 时跳过自动推送到群组
            const imageUrl = await this.generateSummaryForRecord(record, true)
            successCount++
            if (imageUrl) {
              generatedUrls.push({ guildId: record.guildId, url: imageUrl })
            }
          } catch (error: any) {
            console.error(`重新生成总结失败 (${record.guildId || 'private'}):`, error)
          }
        }

        if (tempMessage && tempMessage[0]) {
          await session.bot.deleteMessage(session.channelId, tempMessage[0])
        }

        // 构建消息：文本 + 所有生成的图片
        const messageElements: any[] = [
          h.text(`✅ ${date} 的AI总结重新生成完成：${successCount}/${totalCount} 个成功\n\n`)
        ]

        for (const item of generatedUrls) {
          const groupInfo = item.guildId ? `群组 ${item.guildId}` : '私聊'
          messageElements.push(h.text(`📸 ${groupInfo}:\n`))
          messageElements.push(await buildStoredImageElement(this.s3Uploader, item.url, this.warnImageFallback))
          messageElements.push(h.text('\n'))
        }

        await this.sendMessage(session, messageElements)
      }

    } catch (error: any) {
      console.error('重新生成AI总结失败:', error)
      await this.sendMessage(session, [h.text(`❌ 重新生成失败: ${error?.message || '未知错误'}`)])
    }
  }

  // 处理AI总结获取命令
  private async handleSummaryGetCommand(session: Session, date: string, guildId?: string): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 检查AI功能是否启用
      if (!this.aiService.isEnabled()) {
        await this.sendMessage(session, [h.text('❌ AI功能未启用，无法获取总结')])
        return
      }

      // 解析日期
      const parsedDate = this.parseDate(date)
      if (!parsedDate) {
        await this.sendMessage(session, [h.text('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式或预设值（如：yesterday、today）')])
        return
      }

      // 处理群组ID
      let targetGuildId: string | undefined
      if (guildId === 'current') {
        // 使用当前群组
        if (!session.guildId) {
          await this.sendMessage(session, [h.text('❌ 当前不在群聊中，无法使用 "current" 参数')])
          return
        }
        targetGuildId = session.guildId
      } else if (guildId === 'private') {
        // 私聊记录
        targetGuildId = undefined
      } else if (guildId) {
        // 具体群号
        targetGuildId = guildId
      } else {
        // 未指定群组，使用当前群组（如果在群聊中）
        if (session.guildId) {
          targetGuildId = session.guildId
        } else {
          await this.sendMessage(session, [h.text('❌ 请指定群组ID或在群聊中使用命令\n\n💡 使用方式：\n• cs.summary.get 2024-01-01 123456789\n• cs.summary.get 2024-01-01 private\n• 在群聊中：cs.summary.get 2024-01-01')])
          return
        }
      }

      // 发送处理中消息
      const tempMessage = await this.sendMessage(session, [h.text('🔍 正在获取AI总结图片...')])

      // 获取总结图片URL
      const summaryImageUrl = await this.dbOps.getSummaryImageUrl(parsedDate, targetGuildId)

      // 删除临时消息
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0])
      }

      if (!summaryImageUrl) {
        const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
        await this.sendMessage(session, [h.text(`❌ 未找到 ${groupInfo} 在 ${parsedDate} 的AI总结图片\n\n💡 可能原因：\n• 该日期没有聊天记录\n• 聊天记录尚未上传\n• AI总结尚未生成\n\n🔧 解决方法：\n• 使用 cs.summary.check 检查缺失的总结\n• 使用 cs.summary.retry ${parsedDate}${targetGuildId ? ` ${targetGuildId}` : ''} 重新生成`)])
        return
      }

      // 发送总结图片
      try {
        const groupInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
        await this.sendMessage(session, [
          h.text(`📊 ${groupInfo} - ${parsedDate} AI总结：`),
          await buildStoredImageElement(this.s3Uploader, summaryImageUrl, this.warnImageFallback)
        ])
      } catch (error: any) {
        console.error('发送总结图片失败:', error)
        await this.sendMessage(session, [h.text(`❌ 发送图片失败: ${error?.message || '未知错误'}\n\n🔗 图片链接（24小时内有效）: ${toTimedUrl(this.s3Uploader, summaryImageUrl)}`)])
      }

    } catch (error: any) {
      console.error('获取AI总结失败:', error)
      await this.sendMessage(session, [h.text(`❌ 获取失败: ${error?.message || '未知错误'}`)])
    }
  }

  // 解析日期字符串，支持预设值和具体日期
  private parseDate(dateInput: string): string | null {
    try {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      
      let targetDate: Date

      switch (dateInput.toLowerCase()) {
        case 'today':
          targetDate = today
          break
          
        case 'yesterday':
          targetDate = new Date(today)
          targetDate.setDate(targetDate.getDate() - 1)
          break
          
        case 'last7days':
          targetDate = new Date(today)
          targetDate.setDate(targetDate.getDate() - 7)
          break
          
        default:
          // 尝试解析具体日期
          if (dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // 完整格式：2024-01-01
            targetDate = new Date(dateInput + 'T00:00:00')
          } else if (dateInput.match(/^\d{2}-\d{2}$/)) {
            // 简化格式：01-01 (当年)
            targetDate = new Date(`${now.getFullYear()}-${dateInput}T00:00:00`)
          } else {
            return null
          }
      }

      // 验证日期是否有效
      if (isNaN(targetDate.getTime())) {
        return null
      }

      // 返回 YYYY-MM-DD 格式
      return targetDate.toISOString().split('T')[0]
    } catch {
      return null
    }
  }



  // 处理Markdown测试命令
  private async handleMdTestCommand(session: Session): Promise<void> {
    try {
      // 发送处理中消息
      const tempMessage = await this.sendMessage(session, [h.text('🔄 正在生成Markdown测试图片，请稍候...')])

      // 生成测试内容
      const testMarkdown = this.generateTestMarkdown()

      // 转换为图片
      const imageBuffer = await this.mdToImageService.convertToImage(testMarkdown)

      // 删除临时消息
      if (tempMessage && tempMessage[0]) {
        await session.bot.deleteMessage(session.channelId, tempMessage[0])
      }

      // 发送测试图片
      await this.sendMessage(session, [
        h.text('🎨 Markdown和Emoji渲染测试结果：'),
        h.image(imageBuffer, 'image/png')
      ])

    } catch (error: any) {
      console.error('Markdown测试失败:', error)
      await this.sendMessage(session, [h.text(`❌ Markdown测试失败: ${error?.message || '未知错误'}`)])
    }
  }

  // 生成测试Markdown内容
  private generateTestMarkdown(): string {
    const testMarkdown = [
      '# 🎯 Markdown渲染测试',
      '',
      '## 📝 文本格式测试',
      '',
      '这是**粗体文字**，这是*斜体文字*，这是***粗斜体文字***。',
      '',
      '## 😀 Emoji测试',
      '',
      '### 表情符号',
      '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳',
      '',
      '### 手势和人物',
      '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏',
      '',
      '### 动物和自然',
      '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪲 🐛 🦋 🐌 🐞 🐜 🪰 🪱 🦗',
      '',
      '### 食物和饮料',
      '🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠',
      '',
      '### 活动和物品',
      '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️',
      '',
      '## 📋 列表测试',
      '',
      '### 无序列表',
      '* 这是第一项 🥇',
      '* 这是第二项 🥈',
      '* 这是第三项 🥉',
      '',
      '### 有序列表',
      '1. 首先做这个 📝',
      '2. 然后做那个 ✅',
      '3. 最后完成 🎉',
      '',
      '## 💻 代码测试',
      '',
      '这是行内代码：`console.log(\'Hello World! 🌍\')`',
      '',
      '```javascript',
      '// 这是代码块测试',
      'function greet(name) {',
      '    return `Hello ${name}! 👋`;',
      '}',
      '',
      'const message = greet(\'世界\');',
      'console.log(message); // 输出: Hello 世界! 👋',
      '```',
      '',
      '```python',
      '# Python代码示例',
      'def calculate_emoji_count(text):',
      '    """计算文本中emoji的数量 📊"""',
      '    emoji_count = 0',
      '    for char in text:',
      '        if ord(char) > 0x1F600:  # 基本emoji范围',
      '            emoji_count += 1',
      '    return emoji_count',
      '',
      'text = "Hello 世界! 😊🎉🚀"',
      'count = calculate_emoji_count(text)',
      'print(f"Emoji数量: {count} 个")',
      '```',
      '',
      '## 🔗 链接测试',
      '',
      '这是一个链接：[Koishi官网](https://koishi.chat) 🌐',
      '',
      '## 🌍 多语言测试',
      '',
      '### 中文',
      '你好世界！这是中文测试内容。🇨🇳',
      '',
      '### English',
      'Hello World! This is English test content. 🇺🇸',
      '',
      '### 日本語',
      'こんにちは世界！これは日本語のテストコンテンツです。🇯🇵',
      '',
      '### 한국어',
      '안녕하세요 세계! 이것은 한국어 테스트 콘텐츠입니다. 🇰🇷',
      '',
      '## 🎨 符号和特殊字符',
      '',
      '### 箭头符号',
      '↑ ↓ ← → ↖ ↗ ↘ ↙ ⬆ ⬇ ⬅ ➡ ↩ ↪ ⤴ ⤵',
      '',
      '### 数学符号',
      '± × ÷ = ≠ ≈ ∞ ∫ ∑ √ ∆ ∇ ∂ ∞ ∅ ∈ ∉ ⊂ ⊃ ∩ ∪',
      '',
      '### 货币符号',
      '$ € ¥ £ ₹ ₽ ₿ ¢ ₩ ₪ ₫ ₡ ₵ ₼ ₴ ₦ ₨ ₱',
      '',
      '## ⭐ 结论',
      '',
      '如果你能看到以上所有内容都正确渲染，包括：',
      '- ✅ 各种emoji正确显示（非乱码）',
      '- ✅ 中英日韩文字正确显示',
      '- ✅ 代码块语法高亮',
      '- ✅ 列表格式正确',
      '- ✅ 粗体斜体效果正确',
      '',
      '那么Markdown渲染功能工作正常！🎉✨',
      '',
      '---',
      `*测试时间: ${new Date().toLocaleString('zh-CN')} ⏰*`
    ]

    return testMarkdown.join('\n')
  }

  // 处理AI分析命令
  private async handleAnalysisCommand(session: Session, query?: string): Promise<void> {
    try {
      // 检查权限
      if (!this.isAdmin(session.userId)) {
        await this.sendMessage(session, [h.text('权限不足，只有管理员才能使用此命令')])
        return
      }

      // 检查是否提供了查询内容
      if (!query || query.trim() === '') {
        await this.sendMessage(session, [h.text('请提供分析查询内容\n\n💡 示例：\ncs.analysis 昨天群里发生了什么大事？\ncs.analysis 最近一周大家聊了什么游戏？')])
        return
      }

      // 解析群组ID
      let targetGuildId: string | undefined
      if (session.guildId) {
        targetGuildId = session.guildId
      } else {
        // 私聊中使用，分析私聊记录
        targetGuildId = undefined
      }

      // 检查AI功能是否启用
      if (!this.aiService.isEnabled(targetGuildId || 'private')) {
        const guildInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
        await this.sendMessage(session, [h.text(`❌ AI功能未启用，或${guildInfo}已禁用AI功能，请检查AI配置`)])
        return
      }

      // 第一步：解析用户查询
      const parseMessage = await this.sendMessage(session, [h.text('🔍 正在解析您的查询...')])

      let parsedQuery: { timeRange: string; analysisPrompt: string }
      try {
        parsedQuery = await this.aiService.parseAnalysisQuery(query, targetGuildId || 'private')
      } catch (error: any) {
        // 删除临时消息
        if (parseMessage && parseMessage[0]) {
          await session.bot.deleteMessage(session.channelId, parseMessage[0])
        }
        await this.sendMessage(session, [h.text(`❌ 查询解析失败: ${error?.message || '未知错误'}`)])
        return
      }

      // 删除解析临时消息
      if (parseMessage && parseMessage[0]) {
        await session.bot.deleteMessage(session.channelId, parseMessage[0])
      }

      // 第二步：获取聊天记录
      const fetchMessage = await this.sendMessage(session, [h.text(`📥 正在获取聊天记录...`)])

      let chatContent: string
      let messageCount: number
      let dateRangeStr: string
      try {
        // AI 返回的是具体日期或日期列表，直接解析
        // 格式：单日 "2025-01-07" 或 多日 "2025-01-05,2025-01-06,2025-01-07"
        const dateStrings = parsedQuery.timeRange.split(',').map(d => d.trim())
        dateRangeStr = dateStrings.join(', ')

        const localFiles = await this.exportManager['checkLocalFiles'](targetGuildId, dateStrings)
        const s3Files = await this.exportManager['checkS3Files'](targetGuildId, dateStrings)

        // 如果本地和S3都没有数据，下载S3文件
        let filesToProcess = localFiles
        if (localFiles.length === 0 && s3Files.length > 0) {
          const downloadedFiles = await this.exportManager['downloadFromS3'](s3Files)
          filesToProcess = downloadedFiles
        }

        if (filesToProcess.length === 0) {
          // 删除临时消息
          if (fetchMessage && fetchMessage[0]) {
            await session.bot.deleteMessage(session.channelId, fetchMessage[0])
          }
          const guildInfo = targetGuildId ? `群组 ${targetGuildId}` : '私聊'
          await this.sendMessage(session, [h.text(`❌ 未找到 ${guildInfo} 在 ${dateRangeStr} 的聊天记录`)])
          return
        }

        // 解析消息文件
        const messages = await this.exportManager['parseMessageFiles'](filesToProcess)

        if (messages.length === 0) {
          // 删除临时消息
          if (fetchMessage && fetchMessage[0]) {
            await session.bot.deleteMessage(session.channelId, fetchMessage[0])
          }
          await this.sendMessage(session, [h.text(`❌ 该时间段没有聊天记录`)])
          return
        }

        messageCount = messages.length
        chatContent = this.exportManager['formatExportContent'](messages, 'txt')

      } catch (error: any) {
        // 删除临时消息
        if (fetchMessage && fetchMessage[0]) {
          await session.bot.deleteMessage(session.channelId, fetchMessage[0])
        }
        await this.sendMessage(session, [h.text(`❌ 获取聊天记录失败: ${error?.message || '未知错误'}`)])
        return
      }

      // 删除获取记录临时消息
      if (fetchMessage && fetchMessage[0]) {
        await session.bot.deleteMessage(session.channelId, fetchMessage[0])
      }

      // 第三步：AI分析
      const analyzeMessage = await this.sendMessage(session, [h.text('🤖 正在进行AI分析，请稍候...')])

      try {
        const analysisResult = await this.aiService.analyzeChat(
          chatContent,
          parsedQuery.analysisPrompt,
          dateRangeStr,
          messageCount,
          targetGuildId || 'private'
        )

        // 删除分析临时消息
        if (analyzeMessage && analyzeMessage[0]) {
          await session.bot.deleteMessage(session.channelId, analyzeMessage[0])
        }

        // 发送分析结果
        const resultMessage = `📊 AI分析结果：\n` +
                            `${analysisResult}\n` +
                            `────────────────\n` +
                            `📅 日期: ${dateRangeStr}\n` +
                            `📝 消息数量: ${messageCount} 条`

        await this.sendMessage(session, [h.text(resultMessage)])

      } catch (error: any) {
        // 删除分析临时消息
        if (analyzeMessage && analyzeMessage[0]) {
          await session.bot.deleteMessage(session.channelId, analyzeMessage[0])
        }
        await this.sendMessage(session, [h.text(`❌ AI分析失败: ${error?.message || '未知错误'}`)])
      }

    } catch (error: any) {
      console.error('处理分析命令失败:', error)
      await this.sendMessage(session, [h.text(`❌ 命令处理失败: ${error?.message || '未知错误'}`)])
    }
  }
} 