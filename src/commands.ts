import { Context } from 'koishi'
import { Config, PluginStats } from './types'
import { DatabaseOperations } from './database'
import { S3Uploader } from './s3-uploader'

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

  // 注册所有命令
  registerCommands(): void {
    // 状态命令
    this.ctx.command('cs.status', '查看插件状态')
      .action(async ({ session }) => {
        return this.handleStatusCommand()
      })
  }

  // 处理状态命令
  private async handleStatusCommand(): Promise<string> {
    const stats = await this.dbOps.getPluginStats()
    
    let statusText = '📊 聊天记录插件状态\n\n'
    
    // 基础配置
    statusText += '⚙️ 配置状态:\n'
    statusText += `• 聊天记录: ${this.config.chatLog.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
    statusText += `• S3存储: ${this.config.s3.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
    statusText += `• 图片上传: ${this.config.imageUpload.enabled ? '✅ 已启用' : '❌ 已禁用'}\n`
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