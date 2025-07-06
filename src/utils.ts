/**
 * 公共工具函数模块
 */

/**
 * 将时间戳格式化为 UTC+8 可读时间
 */
export const formatDateInUTC8 = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

/**
 * 获取 UTC+8 时区的日期字符串 (YYYY-MM-DD)
 */
export const getDateStringInUTC8 = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).replace(/\//g, '-')
}

/**
 * 获取当前 UTC+8 时间的 Date 对象
 */
export const getCurrentTimeInUTC8 = (): Date => {
  const now = new Date()
  // 获取UTC+8时间的Date对象
  const utc8Time = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  return utc8Time
}

/**
 * 统一的错误处理器
 */
export const handleError = (error: any, defaultMessage: string = '操作失败'): string => {
  if (error?.code === 'ECONNRESET' || error?.code === 'ECONNABORTED') {
    return '网络连接中断'
  } else if (error?.code === 'ENOTFOUND') {
    return '无法解析地址'
  } else if (error?.response?.status === 404) {
    return '资源不存在（404）'
  } else if (error?.response?.status === 403) {
    return '访问被拒绝（403）'
  } else if (error?.response?.status >= 400) {
    return `请求失败（HTTP ${error.response.status}）`
  } else if (error?.message) {
    return error.message
  }
  return defaultMessage
}

/**
 * 安全的 JSON 解析
 */
export const safeJsonParse = <T>(jsonString: string | null | undefined, defaultValue: T): T => {
  if (!jsonString) {
    return defaultValue
  }
  try {
    return JSON.parse(jsonString)
  } catch {
    return defaultValue
  }
}

/**
 * 安全的 JSON 序列化
 */
export const safeJsonStringify = (obj: any): string => {
  try {
    return JSON.stringify(obj)
  } catch {
    return '{}'
  }
}

/**
 * 延迟执行函数
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 文件大小单位常量
 */
const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB']

/**
 * 文件大小格式化
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + FILE_SIZE_UNITS[i]
}

/**
 * 批量处理函数，支持并发限制
 */
export const processBatch = async <T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> => {
  const results: R[] = []
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(
      batch.map(item => processor(item))
    )
    
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results[i + index] = result.value
      }
    })
    
    // 避免过于频繁的请求
    if (i + concurrency < items.length) {
      await delay(100)
    }
  }
  
  return results
} 