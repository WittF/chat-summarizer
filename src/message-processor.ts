import { Element } from 'koishi'

export interface ProcessedMessage {
  content: string
  messageType: 'text' | 'image' | 'mixed' | 'other'
  imageUrls: string[]
  fileUrls: Array<{ url: string; fileName: string }>
  videoUrls: Array<{ url: string; fileName: string }>
}

export class MessageProcessor {
  private includeImages: boolean

  constructor(includeImages: boolean = true) {
    this.includeImages = includeImages
  }

  /**
   * 处理消息元素数组
   */
  processElements(elements: Element[]): ProcessedMessage {
    let content = ''
    let hasText = false
    let hasImage = false
    const imageUrls: string[] = []
    const fileUrls: Array<{ url: string; fileName: string }> = []
    const videoUrls: Array<{ url: string; fileName: string }> = []

    for (const element of elements) {
      switch (element.type) {
        case 'text':
          const textContent = element.attrs?.content || ''
          content += textContent
          if (textContent.trim()) {
            hasText = true
          }
          break

        case 'image':
        case 'img':  // 支持 QQ 的 img 元素类型
          const imageUrl = element.attrs?.src || element.attrs?.url || ''
          if (imageUrl) {
            if (this.includeImages) {
              imageUrls.push(imageUrl)
              // 检查是否是表情包
              const summary = element.attrs?.summary || ''
              const isEmoji = summary.includes('[动画表情]') || summary.includes('[表情]')
              
              if (isEmoji) {
                content += `[表情包: ${imageUrl}]`
              } else {
                content += `[图片: ${imageUrl}]`
              }
            } else {
              content += '[图片]'
            }
            hasImage = true
          }
          break

        case 'at':
          const atId = element.attrs?.id || element.attrs?.user || element.attrs?.uid || 
                      element.attrs?.target || element.attrs?.qq || element.attrs?.userId || ''
          const atName = element.attrs?.name || element.attrs?.username || 
                        element.attrs?.nick || element.attrs?.nickname || 
                        element.attrs?.displayName || atId
          
          if (atId) {
            content += `@${atName}`
          } else {
            content += '@某人'
          }
          hasText = true
          break

        case 'face':
          const faceId = element.attrs?.id || ''
          const faceName = element.attrs?.name || ''
          
          // 优先使用友好的表情名称，否则回退到ID
          if (faceName) {
            content += `[表情:${faceName}]`
          } else if (faceId) {
            content += `[表情:${faceId}]`
          } else {
            content += '[表情]'
          }
          hasText = true
          break

        case 'dice':
          const diceResult = element.attrs?.result || ''
          if (diceResult) {
            content += `[骰子:点数${diceResult}]`
          } else {
            content += '[骰子]'
          }
          hasText = true
          break

        case 'rps':
          const rpsResult = element.attrs?.result || ''
          if (rpsResult) {
            let rpsName = ''
            switch (rpsResult) {
              case '1':
              case 1:
                rpsName = '包'
                break
              case '2':
              case 2:
                rpsName = '剪'
                break
              case '3':
              case 3:
                rpsName = '锤'
                break
              default:
                rpsName = rpsResult.toString()
                break
            }
            content += `[包剪锤:${rpsName}]`
          } else {
            content += '[包剪锤]'
          }
          hasText = true
          break

        case 'audio':
          const audioUrl = element.attrs?.src || element.attrs?.url || ''
          if (audioUrl) {
            content += `[语音: ${audioUrl}]`
          } else {
            content += '[语音]'
          }
          hasText = true
          break

        case 'video':
          const videoUrl = element.attrs?.src || element.attrs?.url || ''
          const videoFileName = element.attrs?.file || element.attrs?.name || 
                               (videoUrl ? videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4' : 'video.mp4')
          
          if (videoUrl) {
            videoUrls.push({ url: videoUrl, fileName: videoFileName })
            content += `[视频: ${videoUrl}]`
          } else {
            content += '[视频]'
          }
          hasText = true
          break

        case 'file':
          const fileName = element.attrs?.name || element.attrs?.file || '未知文件'
          const fileUrl = element.attrs?.src || element.attrs?.url || ''
          if (fileUrl) {
            fileUrls.push({ url: fileUrl, fileName })
            content += `[文件: ${fileName} - ${fileUrl}]`
          } else {
            content += `[文件: ${fileName}]`
          }
          hasText = true
          break

        case 'quote':
          // 处理引用消息
          const quoteId = element.attrs?.id || ''
          const quoteContent = element.attrs?.content || ''
          
          if (quoteContent) {
            content += `[回复: ${quoteContent}] `
          } else if (quoteId) {
            content += `[回复消息:${quoteId}] `
          } else {
            content += '[回复某条消息] '
          }
          hasText = true
          break

        case 'share':
          const shareTitle = element.attrs?.title || ''
          const shareUrl = element.attrs?.url || ''
          if (shareTitle && shareUrl) {
            content += `[分享: ${shareTitle} - ${shareUrl}]`
          } else if (shareTitle) {
            content += `[分享: ${shareTitle}]`
          } else if (shareUrl) {
            content += `[分享: ${shareUrl}]`
          } else {
            content += '[分享]'
          }
          hasText = true
          break

        case 'location':
          const locationName = element.attrs?.name || ''
          const lat = element.attrs?.lat || element.attrs?.latitude || ''
          const lon = element.attrs?.lon || element.attrs?.longitude || ''
          
          if (locationName) {
            content += `[位置: ${locationName}]`
          } else if (lat && lon) {
            content += `[位置: ${lat}, ${lon}]`
          } else {
            content += '[位置]'
          }
          hasText = true
          break

        case 'json':
          // JSON消息，可能包含复杂结构
          try {
            const jsonData = element.attrs?.data || element.attrs?.content || ''
            if (jsonData) {
              content += `[JSON: ${typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData)}]`
            } else {
              content += '[JSON消息]'
            }
          } catch (error) {
            content += '[JSON消息]'
          }
          hasText = true
          break

        case 'reply':
          // 处理回复消息
          const replyId = element.attrs?.id || ''
          const replyContent = element.attrs?.content || ''
          
          if (replyContent) {
            content += `[回复: ${replyContent}] `
          } else if (replyId) {
            content += `[回复消息:${replyId}] `
          } else {
            content += '[回复某条消息] '
          }
          hasText = true
          break

        case 'forward':
          // 转发消息
          content += '[转发消息]'
          hasText = true
          break

        case 'node':
          // 节点消息（通常在合并转发中）
          const nodeContent = element.attrs?.content || ''
          if (nodeContent) {
            content += `[节点: ${nodeContent}]`
          } else {
            content += '[节点消息]'
          }
          hasText = true
          break

        default:
          // 其他未知类型的元素
          content += `[${element.type}]`
          hasText = true
          break
      }
    }

    // 确定消息类型
    let messageType: ProcessedMessage['messageType']
    if (hasImage && hasText) {
      messageType = 'mixed'
    } else if (hasImage) {
      messageType = 'image'
    } else if (hasText) {
      messageType = 'text'
    } else {
      messageType = 'other'
    }

    return {
      content: content.trim(),
      messageType,
      imageUrls,
      fileUrls,
      videoUrls
    }
  }

  /**
   * 检查消息是否包含图片
   */
  hasImages(elements: Element[]): boolean {
    return elements.some(element => element.type === 'image' || element.type === 'img')
  }

  /**
   * 检查消息是否包含文件
   */
  hasFiles(elements: Element[]): boolean {
    return elements.some(element => element.type === 'file')
  }

  /**
   * 检查消息是否包含视频
   */
  hasVideos(elements: Element[]): boolean {
    return elements.some(element => element.type === 'video')
  }

  /**
   * 提取所有图片URL
   */
  extractImageUrls(elements: Element[]): string[] {
    const imageUrls: string[] = []
    
    for (const element of elements) {
      if (element.type === 'image' || element.type === 'img') {
        const imageUrl = element.attrs?.src || element.attrs?.url || ''
        if (imageUrl) {
          imageUrls.push(imageUrl)
        }
      }
    }
    
    return imageUrls
  }

  /**
   * 提取所有文件URL
   */
  extractFileUrls(elements: Element[]): Array<{ url: string; fileName: string }> {
    const fileUrls: Array<{ url: string; fileName: string }> = []
    
    for (const element of elements) {
      if (element.type === 'file') {
        const fileUrl = element.attrs?.src || element.attrs?.url || ''
        const fileName = element.attrs?.name || element.attrs?.file || '未知文件'
        if (fileUrl) {
          fileUrls.push({ url: fileUrl, fileName })
        }
      }
    }
    
    return fileUrls
  }

  /**
   * 提取所有视频URL
   */
  extractVideoUrls(elements: Element[]): Array<{ url: string; fileName: string }> {
    const videoUrls: Array<{ url: string; fileName: string }> = []
    
    for (const element of elements) {
      if (element.type === 'video') {
        const videoUrl = element.attrs?.src || element.attrs?.url || ''
        const videoFileName = element.attrs?.file || element.attrs?.name || 
                             (videoUrl ? videoUrl.split('/').pop()?.split('?')[0] || 'video.mp4' : 'video.mp4')
        if (videoUrl) {
          videoUrls.push({ url: videoUrl, fileName: videoFileName })
        }
      }
    }
    
    return videoUrls
  }

  /**
   * 获取纯文本内容（去除所有非文本元素）
   */
  getPlainText(elements: Element[]): string {
    let content = ''
    
    for (const element of elements) {
      if (element.type === 'text') {
        content += element.attrs?.content || ''
      }
    }
    
    return content.trim()
  }

  /**
   * 检查消息是否只包含文本
   */
  isTextOnly(elements: Element[]): boolean {
    return elements.every(element => element.type === 'text')
  }

  /**
   * 检查消息是否为空
   */
  isEmpty(elements: Element[]): boolean {
    if (elements.length === 0) return true
    
    const processed = this.processElements(elements)
    return processed.content.trim() === ''
  }
} 