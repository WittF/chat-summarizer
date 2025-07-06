import { Context, Session, h } from 'koishi'
import { Config, PluginStats } from './types'
import { DatabaseOperations } from './database'
import { S3Uploader } from './s3-uploader'
import { safeJsonParse } from './utils'

// 命令处理类
export class CommandHandler {
  constructor(
    private ctx: Context,
    private config: Config,
    private dbOps: DatabaseOperations,
    private s3Uploader: S3Uploader | null,
    private getStorageDir: (subDir: string) => string,
    private getNextExecutionTime: (targetTime: string) => Date
  ) {}

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
  private async sendMessage(session: Session, content: any[]): Promise<void> {
    try {
      const promptMessage = session.channelId?.startsWith('private:')
        ? [h.quote(session.messageId), ...content]
        : [h.quote(session.messageId), h.at(session.userId), '\n', ...content]

      await session.send(promptMessage)
    } catch (error: any) {
      const normalizedUserId = this.normalizeQQId(session.userId)
      console.error(`向QQ(${normalizedUserId})发送消息失败: ${error?.message || '未知错误'}`)
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
        await this.sendMessage(session, [h.text('未找到被回复消息的记录')])
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

      let responseContent = '📋 S3链接信息:\n\n'
      let hasContent = false

      // 处理图片链接
      if (imageRecords.length > 0) {
        responseContent += '🖼️ 图片链接:\n'
        imageRecords.forEach((img, index) => {
          responseContent += `${index + 1}. ${img.s3Url}\n`
        })
        responseContent += '\n'
        hasContent = true
      }

      // 处理文件链接
      if (fileRecords.length > 0) {
        responseContent += '📁 文件链接:\n'
        fileRecords.forEach((file, index) => {
          responseContent += `${index + 1}. ${file.fileName}\n${file.s3Url}\n\n`
        })
        hasContent = true
      }

      if (!hasContent) {
        await this.sendMessage(session, [h.text('被回复的消息中没有找到已上传的图片或文件')])
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
    statusText += `• 图片上传: ✅ 已启用\n`
    statusText += `• 调试模式: ${this.config.debug ? '✅ 已启用' : '❌ 已禁用'}\n`
    
    // S3配置详情
    if (this.config.s3.enabled) {
      statusText += '\n🌐 S3配置:\n'
      statusText += `• 端点: ${this.config.s3.endpoint || '未配置'}\n`
      statusText += `• 存储桶: ${this.config.s3.bucket}\n`
      statusText += `• 路径前缀: ${this.config.s3.pathPrefix}\n`
      statusText += `• 连接状态: ${this.s3Uploader ? '✅ 已连接' : '❌ 未连接'}\n`
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
} 