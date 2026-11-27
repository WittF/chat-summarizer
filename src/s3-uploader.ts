import * as crypto from 'crypto'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import * as fs from 'fs/promises'
import * as path from 'path'
import axios from 'axios'
import { getDateStringInUTC8, handleError, delay } from './utils'
import { contentTypeForExt, forwardMediaKey, sniffAudioExt, sniffExt } from './media-extra'
import { listAllObjects } from './s3-list'

export interface S3Config {
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
  pathPrefix: string
}

export interface UploadResult {
  success: boolean
  url?: string
  key?: string
  error?: string
  fileSize?: number
}

export class S3Uploader {
  private client: S3Client
  private config: S3Config

  constructor(config: S3Config) {
    this.config = config
    
    const clientConfig: any = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // 🔑 关键修复：在S3Client层面设置超时，避免底层网络操作卡住
      requestHandler: {
        requestTimeout: 120000, // 2分钟请求超时
        connectionTimeout: 30000, // 30秒连接超时
      },
      maxAttempts: 3, // 最多重试3次
    }

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint
      clientConfig.forcePathStyle = true
    }

    this.client = new S3Client(clientConfig)
  }

  /**
   * 上传文件缓冲区到S3
   */
  public async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string = 'application/octet-stream'
  ): Promise<UploadResult> {
    try {
      // 智能处理路径前缀
      let fullKey = key
      if (this.config.pathPrefix && this.config.pathPrefix.trim() !== '') {
        // 去除pathPrefix开头和结尾的多余斜杠，然后正确拼接
        const cleanPrefix = this.config.pathPrefix.replace(/^\/+|\/+$/g, '')
        if (cleanPrefix) {
          fullKey = `${cleanPrefix}/${key}`
        }
      }
      
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.config.bucket,
          Key: fullKey,
          Body: buffer,
          ContentType: contentType,
        },
      })

      // 🔑 关键修复：强制超时控制，使用多重保护机制
      const uploadPromise = upload.done()
      
      let timeoutId: NodeJS.Timeout | null = null
      let isCompleted = false
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!isCompleted) {
            isCompleted = true
            
            // 1. 强制取消上传操作
            upload.abort().catch(() => {
              // 忽略取消失败的错误
            })
            
            // 2. 强制抛出错误
            reject(new Error('S3上传超时（90秒）'))
          }
        }, 90000) // 90秒超时
      })
      
      try {
        const result = await Promise.race([uploadPromise, timeoutPromise])
        isCompleted = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        
        const url = this.generatePublicUrl(fullKey)

        return {
          success: true,
          url,
          key: fullKey,
          fileSize: buffer.length
        }
      } catch (error: any) {
        isCompleted = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        
        // 确保上传操作被取消
        try {
          await upload.abort()
        } catch {
          // 忽略取消失败的错误
        }
        
        throw error
      }
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || '上传失败'
      }
    }
  }

  /**
   * 上传本地文件到S3
   */
  public async uploadFile(
    filePath: string,
    key: string,
    contentType?: string
  ): Promise<UploadResult> {
    try {
      const buffer = await fs.readFile(filePath)
      
      if (!contentType) {
        contentType = this.getContentTypeFromExtension(path.extname(filePath))
      }

      return await this.uploadBuffer(buffer, key, contentType)
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || '读取文件失败'
      }
    }
  }

  /**
   * 上传文本内容到S3
   */
  public async uploadText(
    content: string,
    key: string,
    contentType: string = 'text/plain; charset=utf-8'
  ): Promise<UploadResult> {
    const buffer = Buffer.from(content, 'utf-8')
    return await this.uploadBuffer(buffer, key, contentType)
  }

  /**
   * 从URL下载图片并上传到S3（使用axios确保兼容性）
   */
  public async uploadImageFromUrl(
    imageUrl: string,
    key: string,
    httpService?: any,
    maxSize?: number
  ): Promise<UploadResult> {
    try {
      // 使用axios下载图片，确保对各种URL格式的兼容性
      const downloadConfig = {
        responseType: 'arraybuffer' as const,
        timeout: 60000, // 60秒超时
        maxContentLength: maxSize || 50 * 1024 * 1024, // 默认50MB限制
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }

      const response = await axios.get(imageUrl, downloadConfig)

      if (!response.data) {
        return {
          success: false,
          error: '下载图片失败：响应数据为空'
        }
      }

      // 将ArrayBuffer转换为Buffer
      const buffer = Buffer.from(response.data)
      
      // 检查文件大小
      if (maxSize && buffer.length > maxSize) {
        return {
          success: false,
          error: `图片文件过大: ${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`
        }
      }

      // 确定内容类型
      const contentType = this.getImageContentType(imageUrl, response.headers?.['content-type'])

      return await this.uploadBuffer(buffer, key, contentType)
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '下载或上传图片失败')
      }
    }
  }

  /**
   * 从URL下载文件并上传到S3
   */
  public async uploadFileFromUrl(
    fileUrl: string,
    key: string,
    fileName?: string,
    maxSize?: number
  ): Promise<UploadResult> {
    try {
      // 使用axios下载文件，确保对各种URL格式的兼容性
      const downloadConfig = {
        responseType: 'arraybuffer' as const,
        timeout: 120000, // 2分钟超时（文件可能比图片大）
        maxContentLength: maxSize || 100 * 1024 * 1024, // 默认100MB限制
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }

      const response = await axios.get(fileUrl, downloadConfig)

      if (!response.data) {
        return {
          success: false,
          error: '下载文件失败：响应数据为空'
        }
      }

      // 将ArrayBuffer转换为Buffer
      const buffer = Buffer.from(response.data)
      
      // 检查文件大小
      if (maxSize && buffer.length > maxSize) {
        return {
          success: false,
          error: `文件过大: ${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`
        }
      }

      // 确定内容类型
      const contentType = this.getFileContentType(fileUrl, fileName, response.headers?.['content-type'])

      return await this.uploadBuffer(buffer, key, contentType)
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '下载或上传文件失败')
      }
    }
  }

  /**
   * 从URL下载视频并上传到S3
   */
  public async uploadVideoFromUrl(
    videoUrl: string,
    key: string,
    fileName?: string,
    maxSize?: number
  ): Promise<UploadResult> {
    try {
      // 使用axios下载视频，确保对各种URL格式的兼容性
      const downloadConfig = {
        responseType: 'arraybuffer' as const,
        timeout: 300000, // 5分钟超时（视频文件可能很大）
        maxContentLength: maxSize || 500 * 1024 * 1024, // 默认500MB限制
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      }

      const response = await axios.get(videoUrl, downloadConfig)

      if (!response.data) {
        return {
          success: false,
          error: '下载视频失败：响应数据为空'
        }
      }

      // 将ArrayBuffer转换为Buffer
      const buffer = Buffer.from(response.data)
      
      // 检查文件大小
      if (maxSize && buffer.length > maxSize) {
        return {
          success: false,
          error: `视频文件过大: ${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`
        }
      }

      // 确定内容类型
      const contentType = this.getVideoContentType(videoUrl, fileName, response.headers?.['content-type'])

      return await this.uploadBuffer(buffer, key, contentType)
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '下载或上传视频失败')
      }
    }
  }

  /**
   * 加上 pathPrefix 之后的完整键名（和 uploadBuffer 里的拼法一致）
   */
  private withPrefix(key: string): string {
    if (!this.config.pathPrefix || this.config.pathPrefix.trim() === '') {
      return key
    }
    const cleanPrefix = this.config.pathPrefix.replace(/^\/+|\/+$/g, '')
    return cleanPrefix ? `${cleanPrefix}/${key}` : key
  }

  /**
   * 桶里有没有这个对象。有返回大小；没有、或者查不了（网络、权限、有的桶对不存在的对象回 403）都返回 -1。
   * 只用来决定「要不要省掉一次下载」，查不了就当没有、照常下载上传，同样内容再传一遍没有害处。
   */
  public async objectSize(key: string): Promise<number> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: this.withPrefix(key) }))
      return head.ContentLength ?? 0
    } catch {
      return -1
    }
  }

  /**
   * 下载到内存，带总时限（axios 自带的 timeout 只管「多久没动静」，慢速滴流会一直拖着）。
   * 空内容算失败：存一个 0 字节的对象进去，以后「已存在就跳过」会一直拿它当真。
   */
  private async downloadToBuffer(url: string, maxSize: number, timeout: number): Promise<Buffer> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer' as const,
        timeout,
        maxContentLength: maxSize,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })
      const buffer: Buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data || [])
      if (buffer.length === 0) {
        throw new Error('下载失败：内容为空')
      }
      if (buffer.length > maxSize) {
        throw new Error(`文件过大: ${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(maxSize / 1024 / 1024)}MB`)
      }
      return buffer
    } catch (error: any) {
      if (controller.signal.aborted) {
        throw new Error(`下载超时（${Math.round(timeout / 1000)}秒）`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 合并转发里的图片 / 视频：按内容寻址存放（forward-media/<md5 前两位>/<md5>.<扩展名>）。
   * 桶里已经有同一个文件（且不是空的）就不再下载、不覆盖，直接返回它的键名。
   * md5 取自片段的文件名；文件名不是 md5 形状时用下载内容现算。
   * verifyMd5：下载后核对内容的 md5 和文件名里的是否一致，不一致就按实际内容的 md5 存，
   * 免得源头回了别的东西却占住原图的键名。图片开，视频不开（大文件现算会卡住进程）。
   */
  public async uploadForwardMediaFromUrl(
    url: string,
    opts: { md5?: string | null; ext?: string | null; maxSize: number; timeout: number; verifyMd5?: boolean }
  ): Promise<UploadResult> {
    try {
      const existing = async (key: string): Promise<UploadResult | null> => {
        const size = await this.objectSize(key)
        return size > 0
          ? { success: true, key: this.withPrefix(key), url: this.generatePublicUrl(this.withPrefix(key)), fileSize: size }
          : null
      }

      if (opts.md5 && opts.ext) {
        const hit = await existing(forwardMediaKey(opts.md5, opts.ext))
        if (hit) return hit
      }

      const buffer = await this.downloadToBuffer(url, opts.maxSize, opts.timeout)

      let md5 = opts.md5 || ''
      let computed = false
      if (!md5 || opts.verifyMd5) {
        const actual = crypto.createHash('md5').update(buffer).digest('hex')
        computed = actual !== md5.toLowerCase()
        md5 = actual
      }
      const ext = opts.ext || sniffExt(buffer)
      const key = forwardMediaKey(md5, ext)
      // 键名和开头查过的那个不一样（现算的 md5，或扩展名是现猜的）才需要再查一次
      if (computed || !opts.ext) {
        const hit = await existing(key)
        if (hit) return hit
      }
      return await this.uploadBuffer(buffer, key, contentTypeForExt(ext))
    } catch (error: any) {
      return { success: false, error: handleError(error, '下载或上传转发媒体失败') }
    }
  }

  /**
   * 语音：下载原文件原样存（QQ 的语音是 SILK，扩展名按文件头定，不在这里转码）。
   * keyBase 不带扩展名。
   */
  public async uploadAudioFromUrl(url: string, keyBase: string, fallbackExt: string = 'amr'): Promise<UploadResult> {
    try {
      const buffer = await this.downloadToBuffer(url, 50 * 1024 * 1024, 60000)
      const ext = sniffAudioExt(buffer) || fallbackExt
      return await this.uploadBuffer(buffer, `${keyBase}.${ext}`, contentTypeForExt(ext))
    } catch (error: any) {
      return { success: false, error: handleError(error, '下载或上传语音失败') }
    }
  }

  /**
   * 批量上传聊天记录文件
   */
  public async uploadChatLogFiles(
    files: Array<{
      filePath: string
      key: string
    }>
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = []
    
    for (const file of files) {
      const result = await this.uploadFile(file.filePath, file.key, 'text/plain; charset=utf-8')
      results.push(result)
      
      // 避免请求过于频繁
      if (files.length > 1) {
        await delay(100)
      }
    }

    return results
  }

  /**
   * 生成公共URL
   */
  private generatePublicUrl(key: string): string {
    if (this.config.endpoint) {
      // 自定义端点（如MinIO）
      const endpoint = this.config.endpoint.replace(/\/$/, '')
      // 确保key不以/开头，避免双斜杠
      const cleanKey = key.startsWith('/') ? key.substring(1) : key
      return `${endpoint}/${this.config.bucket}/${cleanKey}`
    } else {
      // AWS S3
      const cleanKey = key.startsWith('/') ? key.substring(1) : key
      return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${cleanKey}`
    }
  }

  /**
   * 根据文件扩展名获取内容类型
   */
  private getContentTypeFromExtension(ext: string): string {
    const extension = ext.toLowerCase()
    const mimeTypes: Record<string, string> = {
      // 图片类型
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      
      // 文本类型
      '.txt': 'text/plain; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.log': 'text/plain; charset=utf-8',
      '.xml': 'application/xml; charset=utf-8',
      '.yml': 'text/plain; charset=utf-8',
      '.yaml': 'text/plain; charset=utf-8',
      '.ini': 'text/plain; charset=utf-8',
      '.cfg': 'text/plain; charset=utf-8',
      '.conf': 'text/plain; charset=utf-8',
      
      // 文档类型
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.rtf': 'application/rtf',
      
      // 压缩文件
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.bz2': 'application/x-bzip2',
      
      // 音频类型
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.wma': 'audio/x-ms-wma',
      
      // 视频类型
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.webm': 'video/webm',
      '.m4v': 'video/mp4',
      
      // 程序文件
      '.exe': 'application/x-msdownload',
      '.msi': 'application/x-msdownload',
      '.dmg': 'application/x-apple-diskimage',
      '.deb': 'application/x-debian-package',
      '.rpm': 'application/x-rpm'
    }

    return mimeTypes[extension] || 'application/octet-stream'
  }

  /**
   * 获取图片内容类型
   */
  private getImageContentType(url: string, headerContentType?: string): string {
    // 优先使用响应头中的内容类型
    if (headerContentType && headerContentType.startsWith('image/')) {
      return headerContentType
    }

    // 从URL推断
    const extension = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1]
    if (extension) {
      const contentType = this.getContentTypeFromExtension(`.${extension}`)
      if (contentType.startsWith('image/')) {
        return contentType
      }
    }

    // 默认为JPEG
    return 'image/jpeg'
  }

  /**
   * 获取文件内容类型
   */
  private getFileContentType(url: string, fileName?: string, headerContentType?: string): string {
    // 优先使用响应头中的内容类型
    if (headerContentType && headerContentType !== 'application/octet-stream') {
      return headerContentType
    }

    // 从文件名推断
    if (fileName) {
      const extension = path.extname(fileName).toLowerCase()
      if (extension) {
        return this.getContentTypeFromExtension(extension)
      }
    }

    // 从URL推断
    const extension = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1]
    if (extension) {
      return this.getContentTypeFromExtension(`.${extension}`)
    }

    // 默认为二进制流
    return 'application/octet-stream'
  }

  /**
   * 获取视频内容类型
   */
  private getVideoContentType(url: string, fileName?: string, headerContentType?: string): string {
    // 优先使用响应头中的内容类型
    if (headerContentType && headerContentType.startsWith('video/')) {
      return headerContentType
    }

    // 从文件名推断
    if (fileName) {
      const extension = path.extname(fileName).toLowerCase()
      if (extension) {
        const contentType = this.getContentTypeFromExtension(extension)
        if (contentType.startsWith('video/')) {
          return contentType
        }
      }
    }

    // 从URL推断
    const extension = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/)?.[1]
    if (extension) {
      const contentType = this.getContentTypeFromExtension(`.${extension}`)
      if (contentType.startsWith('video/')) {
        return contentType
      }
    }

    // 默认为MP4
    return 'video/mp4'
  }

  /**
   * 生成用于存储的S3键名
   */
  public static generateImageKey(messageId: string, originalUrl: string, guildId?: string, index: number = 0): string {
    const extension = S3Uploader.getImageExtension(originalUrl)
    const now = Date.now()
    const dateStr = getDateStringInUTC8(now)
    const suffix = index > 0 ? `_${index}` : ''
    
    // 构建路径：images/日期/群号(或private)/消息ID_时间戳.扩展名
    const groupPath = guildId || 'private'
    
    return `images/${dateStr}/${groupPath}/${messageId}_${now}${suffix}.${extension}`
  }

  /**
   * 生成用于文件存储的S3键名
   */
  public static generateFileKey(messageId: string, originalUrl: string, fileName?: string, guildId?: string, index: number = 0): string {
    const extension = S3Uploader.getFileExtension(originalUrl, fileName)
    const now = Date.now()
    const dateStr = getDateStringInUTC8(now)
    const suffix = index > 0 ? `_${index}` : ''
    
    // 构建路径：files/日期/群号(或private)/消息ID_时间戳.扩展名
    const groupPath = guildId || 'private'
    
    return `files/${dateStr}/${groupPath}/${messageId}_${now}${suffix}.${extension}`
  }

  /**
   * 生成用于视频存储的S3键名
   */
  public static generateVideoKey(messageId: string, originalUrl: string, fileName?: string, guildId?: string, index: number = 0): string {
    const extension = S3Uploader.getVideoExtension(originalUrl, fileName)
    const now = Date.now()
    const dateStr = getDateStringInUTC8(now)
    const suffix = index > 0 ? `_${index}` : ''
    
    // 构建路径：videos/日期/群号(或private)/消息ID_时间戳.扩展名
    const groupPath = guildId || 'private'
    
    return `videos/${dateStr}/${groupPath}/${messageId}_${now}${suffix}.${extension}`
  }

  /**
   * 生成聊天记录文件的S3键名（JSON格式）
   */
  public static generateChatLogKey(date: Date, guildId?: string): string {
    const timestamp = date.getTime()
    const dateStr = getDateStringInUTC8(timestamp)
    
    if (guildId) {
      return `chat-logs/${dateStr}/guild_${guildId}_${timestamp}.json`
    } else {
      return `chat-logs/${dateStr}/private_${timestamp}.json`
    }
  }

  /**
   * 提取图片文件扩展名
   */
  private static getImageExtension(url: string): string {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname.toLowerCase()
      const match = pathname.match(/\.([a-z0-9]+)$/i)
      return match ? match[1] : 'jpg'
    } catch {
      return 'jpg'
    }
  }

  /**
   * 提取文件扩展名
   */
  private static getFileExtension(url: string, fileName?: string): string {
    // 优先从文件名提取扩展名
    if (fileName) {
      const fileExt = path.extname(fileName).toLowerCase().substring(1)
      if (fileExt) {
        return fileExt
      }
    }

    // 从URL提取扩展名
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname.toLowerCase()
      const match = pathname.match(/\.([a-z0-9]+)$/i)
      return match ? match[1] : 'bin'
    } catch {
      return 'bin'
    }
  }

  /**
   * 提取视频文件扩展名
   */
  private static getVideoExtension(url: string, fileName?: string): string {
    // 优先从文件名提取扩展名
    if (fileName) {
      const fileExt = path.extname(fileName).toLowerCase().substring(1)
      if (fileExt) {
        return fileExt
      }
    }

    // 从URL提取扩展名
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname.toLowerCase()
      const match = pathname.match(/\.([a-z0-9]+)$/i)
      return match ? match[1] : 'mp4'
    } catch {
      return 'mp4'
    }
  }

  /**
   * 检查是否支持的图片格式
   */
  public static isSupportedImageFormat(url: string, allowedTypes: string[]): boolean {
    const extension = this.getImageExtension(url).toLowerCase()
    return allowedTypes.map(type => type.toLowerCase()).includes(extension)
  }

  /**
   * 测试S3连接
   */
  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // 尝试上传一个小的测试文件
      const testContent = 'koishi-chat-summarizer-test'
      const testKey = `test/${Date.now()}.txt`
      
      const result = await this.uploadText(testContent, testKey, 'text/plain')
      
      if (result.success) {
        // 测试成功，可以选择删除测试文件
        return { success: true }
      } else {
        return { success: false, error: result.error }
      }
    } catch (error: any) {
      return { success: false, error: handleError(error, 'S3连接测试失败') }
    }
  }

  /**
   * 获取S3存储桶中的文件列表
   */
  public async listFiles(prefix?: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    try {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
      
      // 处理路径前缀
      let fullPrefix = prefix || ''
      if (this.config.pathPrefix && this.config.pathPrefix.trim() !== '') {
        const cleanPrefix = this.config.pathPrefix.replace(/^\/+|\/+$/g, '')
        if (cleanPrefix) {
          fullPrefix = fullPrefix ? `${cleanPrefix}/${fullPrefix}` : cleanPrefix
        }
      }

      // 一次最多回 1000 个，要翻页才能列全
      const contents = await listAllObjects(token => this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: fullPrefix,
        MaxKeys: 1000,
        ContinuationToken: token
      })))

      if (contents.length > 0) {
        const files = contents
          .filter(obj => obj.Key && obj.Size && obj.Size > 0) // 过滤掉空文件和目录
          .map(obj => obj.Key!)
          .filter(key => {
            // 去除路径前缀，只返回相对路径
            if (this.config.pathPrefix) {
              const cleanPrefix = this.config.pathPrefix.replace(/^\/+|\/+$/g, '')
              if (cleanPrefix && key.startsWith(cleanPrefix + '/')) {
                return key.substring(cleanPrefix.length + 1)
              }
            }
            return key
          })

        return { success: true, files }
      }

      return { success: true, files: [] }
    } catch (error: any) {
      return { success: false, error: handleError(error, '获取文件列表失败') }
    }
  }

  /**
   * 给键名补上配置的路径前缀（已带前缀的不重复加）
   */
  private resolveFullKey(key: string): string {
    const cleanKey = key.replace(/^\/+/, '')
    if (this.config.pathPrefix && this.config.pathPrefix.trim() !== '') {
      const cleanPrefix = this.config.pathPrefix.replace(/^\/+|\/+$/g, '')
      if (cleanPrefix && !cleanKey.startsWith(cleanPrefix + '/')) {
        return `${cleanPrefix}/${cleanKey}`
      }
    }
    return cleanKey
  }

  /**
   * 从本插件生成的对象地址里取出对象键。
   * 不是本存储桶的地址（比如腾讯的原始地址）返回 null。
   */
  public keyFromUrl(url?: string | null): string | null {
    if (!url) return null
    const prefixes: string[] = []
    if (this.config.endpoint) {
      prefixes.push(`${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}/`)
    } else {
      prefixes.push(`https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/`)
    }
    for (const prefix of prefixes) {
      if (url.startsWith(prefix)) {
        return url.substring(prefix.length) || null
      }
    }
    return null
  }

  /**
   * 带凭据读取对象内容（存储桶不需要公开读）
   */
  public async getObjectBuffer(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: this.resolveFullKey(key)
    }))
    const body = response.Body as any
    if (!body) {
      throw new Error('对象内容为空')
    }
    if (typeof body.transformToByteArray === 'function') {
      return Buffer.from(await body.transformToByteArray())
    }
    const chunks: Buffer[] = []
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  /**
   * 生成带时效的下载地址（SigV4 预签名 GET），存储桶不需要公开读。
   * @param key 对象键
   * @param expiresIn 有效期（秒），默认 24 小时，最长 7 天
   */
  public getPresignedUrl(key: string, expiresIn: number = 86400, now: Date = new Date()): string {
    const fullKey = this.resolveFullKey(key)
    const encodeRfc3986 = (value: string) =>
      encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    const encodedKey = fullKey.split('/').map(encodeRfc3986).join('/')

    let origin: string
    let host: string
    let canonicalPath: string
    if (this.config.endpoint) {
      const endpointUrl = new URL(this.config.endpoint)
      origin = endpointUrl.origin
      host = endpointUrl.host
      const basePath = endpointUrl.pathname.replace(/\/+$/, '')
      canonicalPath = `${basePath}/${encodeRfc3986(this.config.bucket)}/${encodedKey}`
    } else {
      host = `${this.config.bucket}.s3.${this.config.region}.amazonaws.com`
      origin = `https://${host}`
      canonicalPath = `/${encodedKey}`
    }

    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.substring(0, 8)
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(Math.min(Math.max(Math.floor(expiresIn), 1), 604800)),
      'X-Amz-SignedHeaders': 'host'
    }
    const canonicalQuery = Object.keys(query).sort()
      .map(name => `${encodeRfc3986(name)}=${encodeRfc3986(query[name])}`)
      .join('&')
    const canonicalRequest = ['GET', canonicalPath, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n')

    const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest()
    let signingKey: Buffer = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp)
    for (const part of [this.config.region, 's3', 'aws4_request']) {
      signingKey = hmac(signingKey, part)
    }
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    return `${origin}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`
  }

  /**
   * 下载S3文件到本地
   */
  public async downloadFile(s3Key: string, localPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3')
      
      // 处理完整的S3键名
      let fullKey = s3Key
      if (this.config.pathPrefix && this.config.pathPrefix.trim() !== '') {
        const cleanPrefix = this.config.pathPrefix.replace(/^\/+|\/+$/g, '')
        if (cleanPrefix && !s3Key.startsWith(cleanPrefix + '/')) {
          fullKey = `${cleanPrefix}/${s3Key}`
        }
      }

      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: fullKey
      })

      const response = await this.client.send(command)
      
      if (response.Body) {
        // 将流转换为Buffer
        const chunks: Uint8Array[] = []
        const reader = response.Body as any
        
        if (reader.getReader) {
          // ReadableStream
          const readerInstance = reader.getReader()
          while (true) {
            const { done, value } = await readerInstance.read()
            if (done) break
            chunks.push(value)
          }
        } else if (reader.read) {
          // Node.js stream
          const fs = await import('fs')
          const stream = fs.createWriteStream(localPath)
          reader.pipe(stream)
          return new Promise((resolve) => {
            stream.on('finish', () => resolve({ success: true }))
            stream.on('error', (error) => resolve({ success: false, error: error.message }))
          })
        } else {
          // Buffer or string
          chunks.push(new Uint8Array(Buffer.from(response.Body as any)))
        }

        const buffer = Buffer.concat(chunks)
        const fs = await import('fs/promises')
        await fs.writeFile(localPath, buffer)
        
        return { success: true }
      }

      return { success: false, error: '下载内容为空' }
    } catch (error: any) {
      return { success: false, error: handleError(error, '下载文件失败') }
    }
  }
} 