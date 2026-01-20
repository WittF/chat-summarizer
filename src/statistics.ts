import { Logger } from 'koishi'
import { InteractionStatistics, ParsedMessage } from './types'

export class StatisticsService {
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /**
   * 解析 JSONL 内容为消息数组
   */
  parseMessages(jsonlContent: string): ParsedMessage[] {
    const lines = jsonlContent.split('\n').filter(line => line.trim())
    const messages: ParsedMessage[] = []

    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        messages.push({
          timestamp: record.timestamp,
          time: record.time,
          messageId: record.messageId,
          guildId: record.guildId,
          channelId: record.channelId,
          userId: record.userId,
          username: record.username,
          content: record.content,
          messageType: record.messageType,
          imageUrls: record.imageUrls || [],
          fileUrls: record.fileUrls || [],
          videoUrls: record.videoUrls || []
        })
      } catch (error) {
        // 跳过解析失败的行
        this.logger.debug(`解析消息行失败: ${line.substring(0, 50)}...`)
      }
    }

    return messages
  }

  /**
   * 生成完整的统计数据
   */
  generateStatistics(messages: ParsedMessage[], topN: number = 10): InteractionStatistics {
    const activityRanking = this.calculateActivityRanking(messages, topN)
    const hourlyDistribution = this.calculateHourlyDistribution(messages)
    const interactions = this.calculateInteractions(messages)
    const basicStats = this.calculateBasicStats(messages, hourlyDistribution)

    return {
      activityRanking,
      hourlyDistribution,
      interactions,
      basicStats
    }
  }

  /**
   * 统计每个用户发言数量，排序取 TOP N
   */
  calculateActivityRanking(
    messages: ParsedMessage[],
    topN: number = 10
  ): Array<{ username: string; messageCount: number; rank: number }> {
    // 统计每个用户的消息数量
    const userMessageCount = new Map<string, { username: string; count: number }>()

    for (const msg of messages) {
      const key = msg.userId
      const existing = userMessageCount.get(key)
      if (existing) {
        existing.count++
      } else {
        userMessageCount.set(key, { username: msg.username, count: 1 })
      }
    }

    // 转换为数组并排序
    const sorted = Array.from(userMessageCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)

    // 添加排名
    return sorted.map((item, index) => ({
      username: item.username,
      messageCount: item.count,
      rank: index + 1
    }))
  }

  /**
   * 按小时统计消息数量分布
   */
  calculateHourlyDistribution(
    messages: ParsedMessage[]
  ): Array<{ hour: number; count: number; percentage: number }> {
    // 初始化24小时数组
    const hourCounts: number[] = new Array(24).fill(0)

    for (const msg of messages) {
      // 从时间戳中提取小时（UTC+8）
      const date = new Date(msg.timestamp)
      // 转换为 UTC+8 时区
      const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000)
      const hour = utc8Date.getUTCHours()
      hourCounts[hour]++
    }

    const total = messages.length || 1 // 避免除以零

    return hourCounts.map((count, hour) => ({
      hour,
      count,
      percentage: Math.round((count / total) * 100 * 10) / 10 // 保留一位小数
    }))
  }

  /**
   * 解析 @/回复 关系，统计互动频次
   */
  calculateInteractions(messages: ParsedMessage[]): {
    mentions: Array<{ from: string; to: string; count: number }>
    replies: Array<{ from: string; to: string; count: number }>
  } {
    const mentionMap = new Map<string, number>() // key: "from->to"
    const replyMap = new Map<string, number>()

    // 正则匹配 @ 提及
    const mentionRegex = /@([^\s@]+)/g

    // 正则匹配回复标记 [回复 xxx: ...] 或 [回复 xxx 的消息]
    const replyRegex = /\[回复\s+([^:\]]+)/

    for (const msg of messages) {
      const fromUser = msg.username

      // 处理 @ 提及
      let mentionMatch
      while ((mentionMatch = mentionRegex.exec(msg.content)) !== null) {
        const toUser = mentionMatch[1]
        if (toUser && toUser !== fromUser) {
          const key = `${fromUser}->${toUser}`
          mentionMap.set(key, (mentionMap.get(key) || 0) + 1)
        }
      }

      // 处理回复
      const replyMatch = msg.content.match(replyRegex)
      if (replyMatch) {
        const toUser = replyMatch[1].trim()
        if (toUser && toUser !== fromUser) {
          const key = `${fromUser}->${toUser}`
          replyMap.set(key, (replyMap.get(key) || 0) + 1)
        }
      }
    }

    // 转换为数组并排序
    const mentions = Array.from(mentionMap.entries())
      .map(([key, count]) => {
        const [from, to] = key.split('->')
        return { from, to, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10) // 取前10

    const replies = Array.from(replyMap.entries())
      .map(([key, count]) => {
        const [from, to] = key.split('->')
        return { from, to, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10) // 取前10

    return { mentions, replies }
  }

  /**
   * 计算基础统计指标
   */
  calculateBasicStats(
    messages: ParsedMessage[],
    hourlyDistribution: Array<{ hour: number; count: number; percentage: number }>
  ): {
    totalMessages: number
    uniqueUsers: number
    avgMessagesPerUser: number
    peakHour: number
  } {
    const totalMessages = messages.length
    const uniqueUsers = new Set(messages.map(m => m.userId)).size
    const avgMessagesPerUser = uniqueUsers > 0
      ? Math.round((totalMessages / uniqueUsers) * 10) / 10
      : 0

    // 找出消息最多的小时
    let peakHour = 0
    let maxCount = 0
    for (const item of hourlyDistribution) {
      if (item.count > maxCount) {
        maxCount = item.count
        peakHour = item.hour
      }
    }

    return {
      totalMessages,
      uniqueUsers,
      avgMessagesPerUser,
      peakHour
    }
  }

  /**
   * 格式化小时为显示字符串
   */
  formatHour(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`
  }

  /**
   * 获取时段描述
   */
  getPeriodDescription(hour: number): string {
    if (hour >= 6 && hour < 12) return '上午'
    if (hour >= 12 && hour < 14) return '中午'
    if (hour >= 14 && hour < 18) return '下午'
    if (hour >= 18 && hour < 22) return '晚上'
    return '深夜'
  }

  /**
   * 生成活跃时段摘要
   */
  generatePeakHourSummary(
    hourlyDistribution: Array<{ hour: number; count: number; percentage: number }>
  ): string {
    // 找出前3个最活跃的时段
    const sorted = [...hourlyDistribution]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .filter(item => item.count > 0)

    if (sorted.length === 0) {
      return '今日暂无活跃时段'
    }

    const descriptions = sorted.map(item => {
      const period = this.getPeriodDescription(item.hour)
      return `${period} ${this.formatHour(item.hour)} (${item.count}条)`
    })

    return `高峰时段：${descriptions.join('、')}`
  }
}
