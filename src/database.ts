import { Context } from 'koishi'
import { ChatRecord, ImageRecord, FileRecord, VideoRecord, PluginStats } from './types'

// 扩展数据库模型
export function extendDatabase(ctx: Context) {
  ctx.model.extend('chat_records', {
    id: 'unsigned',
    messageId: 'string',
    guildId: 'string',
    channelId: 'string',
    userId: 'string',
    username: 'string',
    content: 'text',
    originalElements: 'text',
    timestamp: 'unsigned',
    messageType: 'string',
    imageUrls: 'text',
    fileUrls: 'text',
    videoUrls: 'text',
    uploadedAt: 'unsigned',
    isUploaded: 'boolean'
  }, {
    autoInc: true,
  })

  ctx.model.extend('image_records', {
    id: 'unsigned',
    originalUrl: 'string',
    s3Url: 'string',
    s3Key: 'string',
    fileSize: 'unsigned',
    uploadedAt: 'unsigned',
    messageId: 'string'
  }, {
    autoInc: true,
  })

  ctx.model.extend('file_records', {
    id: 'unsigned',
    originalUrl: 'string',
    s3Url: 'string',
    s3Key: 'string',
    fileName: 'string',
    fileSize: 'unsigned',
    uploadedAt: 'unsigned',
    messageId: 'string'
  }, {
    autoInc: true,
  })

  ctx.model.extend('video_records', {
    id: 'unsigned',
    originalUrl: 'string',
    s3Url: 'string',
    s3Key: 'string',
    fileName: 'string',
    fileSize: 'unsigned',
    uploadedAt: 'unsigned',
    messageId: 'string'
  }, {
    autoInc: true,
  })
}

// 数据库操作类
export class DatabaseOperations {
  constructor(private ctx: Context) {}

  // 创建聊天记录
  async createChatRecord(record: Omit<ChatRecord, 'id'>): Promise<ChatRecord> {
    const result = await this.ctx.database.create('chat_records', record)
    return (result as any)[0] as ChatRecord
  }

  // 创建图片记录
  async createImageRecord(record: Omit<ImageRecord, 'id'>): Promise<ImageRecord> {
    const result = await this.ctx.database.create('image_records', record)
    return (result as any)[0] as ImageRecord
  }

  // 创建文件记录
  async createFileRecord(record: Omit<FileRecord, 'id'>): Promise<FileRecord> {
    const result = await this.ctx.database.create('file_records', record)
    return (result as any)[0] as FileRecord
  }

  // 创建视频记录
  async createVideoRecord(record: Omit<VideoRecord, 'id'>): Promise<VideoRecord> {
    const result = await this.ctx.database.create('video_records', record)
    return (result as any)[0] as VideoRecord
  }

  // 更新聊天记录
  async updateChatRecord(messageId: string, updates: Partial<ChatRecord>): Promise<void> {
    await this.ctx.database.set('chat_records', { messageId }, updates)
  }

  // 获取未上传的记录
  async getUnuploadedRecords(startTime: number, endTime: number): Promise<ChatRecord[]> {
    return await this.ctx.database.get('chat_records', {
      timestamp: { $gte: startTime, $lte: endTime },
      isUploaded: false
    })
  }

  // 批量标记为已上传
  async markAsUploaded(recordIds: number[]): Promise<void> {
    if (recordIds.length > 0) {
      await this.ctx.database.set('chat_records', 
        { id: { $in: recordIds } }, 
        {
          isUploaded: true,
          uploadedAt: Date.now()
        }
      )
    }
  }

  // 获取插件统计信息
  async getPluginStats(): Promise<PluginStats> {
    try {
      const totalMessages = await this.ctx.database.get('chat_records', {}).then(records => records.length)
      
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayMessages = await this.ctx.database.get('chat_records', {
        timestamp: { $gte: today.getTime() }
      }).then(records => records.length)
      
      const imageRecords = await this.ctx.database.get('image_records', {}).then(records => records.length)
      
      const uploadedMessages = await this.ctx.database.get('chat_records', {
        isUploaded: true
      }).then(records => records.length)
      
      return {
        totalMessages,
        todayMessages,
        imageRecords,
        uploadedMessages
      }
    } catch (error: any) {
      return {
        totalMessages: 0,
        todayMessages: 0,
        imageRecords: 0,
        uploadedMessages: 0
      }
    }
  }

  // 清理过期的数据库记录
  async cleanupExpiredRecords(retentionHours: number): Promise<{ 
    deletedChatRecords: number, 
    deletedImageRecords: number, 
    deletedFileRecords: number,
    deletedVideoRecords: number 
  }> {
    try {
      const cutoffTime = Date.now() - (retentionHours * 60 * 60 * 1000)
      
      // 查找需要删除的聊天记录
      const expiredChatRecords = await this.ctx.database.get('chat_records', {
        timestamp: { $lt: cutoffTime }
      })
      
      const expiredMessageIds = expiredChatRecords.map(record => record.messageId)
      
      // 删除聊天记录
      await this.ctx.database.remove('chat_records', {
        timestamp: { $lt: cutoffTime }
      })
      
      // 删除关联的图片记录
      let deletedImageRecords = 0
      if (expiredMessageIds.length > 0) {
        const imageRecordsToDelete = await this.ctx.database.get('image_records', {
          messageId: { $in: expiredMessageIds }
        })
        deletedImageRecords = imageRecordsToDelete.length
        
        if (deletedImageRecords > 0) {
          await this.ctx.database.remove('image_records', {
            messageId: { $in: expiredMessageIds }
          })
        }
      }
      
      // 删除关联的文件记录
      let deletedFileRecords = 0
      if (expiredMessageIds.length > 0) {
        const fileRecordsToDelete = await this.ctx.database.get('file_records', {
          messageId: { $in: expiredMessageIds }
        })
        deletedFileRecords = fileRecordsToDelete.length
        
        if (deletedFileRecords > 0) {
          await this.ctx.database.remove('file_records', {
            messageId: { $in: expiredMessageIds }
          })
        }
      }
      
      // 删除关联的视频记录
      let deletedVideoRecords = 0
      if (expiredMessageIds.length > 0) {
        const videoRecordsToDelete = await this.ctx.database.get('video_records', {
          messageId: { $in: expiredMessageIds }
        })
        deletedVideoRecords = videoRecordsToDelete.length
        
        if (deletedVideoRecords > 0) {
          await this.ctx.database.remove('video_records', {
            messageId: { $in: expiredMessageIds }
          })
        }
      }
      
      return {
        deletedChatRecords: expiredChatRecords.length,
        deletedImageRecords,
        deletedFileRecords,
        deletedVideoRecords
      }
    } catch (error: any) {
      throw new Error(`清理过期记录失败: ${error?.message || '未知错误'}`)
    }
  }
} 