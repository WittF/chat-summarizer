import * as fs from 'fs/promises'
import * as path from 'path'
import { Logger } from 'koishi'

export class SafeFileWriter {
  private writeChains = new Map<string, Promise<any>>()
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  async safeAppend(filePath: string, content: string): Promise<void> {
    return this.enqueueWrite(filePath, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.appendFile(filePath, content, 'utf8')
    })
  }

  async safeUpdate(filePath: string, messageId: string, newContent: string): Promise<void> {
    return this.enqueueWrite(filePath, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      
      let content = ''
      try {
        content = await fs.readFile(filePath, 'utf8')
      } catch {
        // 文件不存在，直接写入新内容
        await fs.writeFile(filePath, newContent, 'utf8')
        return
      }

      // 优化的文件更新逻辑
      const lines = content.split('\n')
      let found = false
      const cleanContent = newContent.replace(/\n$/, '')
      
      const updated = lines.map(line => {
        if (!line.trim()) return line
        try {
          const record = JSON.parse(line)
          if (record.messageId === messageId) {
            found = true
            return cleanContent
          }
          return line
        } catch {
          return line
        }
      })
      
      if (!found) {
        // 找到最后一个非空行的位置插入
        let lastNonEmptyIndex = -1
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].trim()) {
            lastNonEmptyIndex = i
            break
          }
        }
        if (lastNonEmptyIndex >= 0) {
          updated.splice(lastNonEmptyIndex + 1, 0, cleanContent)
        } else {
          updated.push(cleanContent)
        }
      }
      
      // 确保文件以换行符结尾
      const finalContent = updated.filter(line => line !== '').join('\n') + '\n'
      await fs.writeFile(filePath, finalContent, 'utf8')
    })
  }

  // 真正的并行读取，无需链管理
  async safeRead(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch (error) {
      this.logger.error(`文件读取操作失败: ${filePath}`, error)
      throw error
    }
  }

  private async enqueueWrite(filePath: string, operation: () => Promise<void>): Promise<void> {
    const existingChain = this.writeChains.get(filePath) || Promise.resolve()
    
    const newChain = existingChain
      .then(operation)
      .catch(error => {
        this.logger.error(`文件写入操作失败: ${filePath}`, error)
        throw error
      })
      .finally(() => {
        // 自动清理已完成的链
        if (this.writeChains.get(filePath) === newChain) {
          this.writeChains.delete(filePath)
        }
      })

    this.writeChains.set(filePath, newChain)
    return newChain
  }

  async flush(): Promise<void> {
    const allChains = Array.from(this.writeChains.values())
    if (allChains.length > 0) {
      await Promise.allSettled(allChains)
    }
    this.writeChains.clear()
  }

  dispose(): void {
    this.writeChains.clear()
  }
} 