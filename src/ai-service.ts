import { Context, Logger } from 'koishi'
import { Config } from './types'
import { handleError } from './utils'

export class AIService {
  private logger: Logger
  private config: Config['ai']

  constructor(private ctx: Context, config: Config) {
    this.logger = ctx.logger('chat-summarizer:ai')
    this.config = config.ai
  }

  /**
   * 检查AI服务是否已启用并配置正确
   */
  isEnabled(): boolean {
    return this.config.enabled && 
           !!this.config.apiUrl && 
           !!this.config.apiKey
  }

  /**
   * 替换模板变量
   */
  private replaceTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return variables[key] || match
    })
  }

  /**
   * 获取群组信息描述
   */
  private getGroupInfo(guildId: string): string {
    if (guildId === 'private') return '私聊记录'
    return `群组 ${guildId}`
  }

  /**
   * 生成聊天记录总结
   */
  async generateSummary(
    content: string,
    timeRange: string,
    messageCount: number,
    guildId: string
  ): Promise<string> {
    if (!this.config.enabled) {
      throw new Error('AI总结功能未启用')
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI配置不完整，请检查API URL和密钥')
    }

    try {
      // 构建系统提示词
      const systemPrompt = this.config.systemPrompt || this.getDefaultSystemPrompt()
      
      let requestBody: any

      if (this.config.useFileMode) {
        // 文件模式：使用云雾API的聊天+读取文件接口格式
        this.logger.debug('使用文件模式发送请求')
        
        // 构建文件模式的用户提示词，将内容直接包含在文本中
        const filePrompt = this.buildFilePrompt(timeRange, messageCount, guildId)
        const fullPrompt = `${filePrompt}\n\n📄 **聊天记录内容：**\n\n${content}`
        
        requestBody = {
          model: this.config.model || 'gemini-2.5-flash-all',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: fullPrompt }
          ],
          temperature: 0.7,
          stream: false
        }

        // 只有当maxTokens大于0时才添加限制
        if (this.config.maxTokens && this.config.maxTokens > 0) {
          requestBody.max_tokens = this.config.maxTokens
        }
      } else {
        // 传统模式：直接发送文本内容
        this.logger.debug('使用传统模式发送请求')
        
        const userPromptTemplate = this.config.userPromptTemplate || this.getDefaultUserPromptTemplate()
        const userPrompt = this.replaceTemplate(userPromptTemplate, {
          timeRange,
          messageCount: messageCount.toString(),
          groupInfo: this.getGroupInfo(guildId),
          content
        })

        requestBody = {
          model: this.config.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7
        }

        // 只有当maxTokens大于0时才添加限制
        if (this.config.maxTokens && this.config.maxTokens > 0) {
          requestBody.max_tokens = this.config.maxTokens
        }
      }

      this.logger.debug('发送AI请求', { 
        url: this.config.apiUrl, 
        model: requestBody.model,
        fileMode: this.config.useFileMode,
        contentLength: content.length,
        hasFile: !!(this.config.useFileMode && content),
        timeout: this.config.timeout || 60
      })

      // 文件模式需要更长的超时时间
      const timeoutMs = this.config.useFileMode 
        ? Math.max((this.config.timeout || 120) * 1000, 120000) // 文件模式最少2分钟
        : (this.config.timeout || 60) * 1000

      this.logger.debug(`设置超时时间: ${timeoutMs}ms`)

      const response = await this.ctx.http.post(this.config.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        timeout: timeoutMs
      })

      this.logger.debug('AI接口响应', { 
        hasResponse: !!response,
        responseKeys: response ? Object.keys(response) : [],
        data: response ? JSON.stringify(response, null, 2) : 'null'
      })

      if (!response) {
        throw new Error('AI接口未返回响应')
      }

      // 检测是否返回了HTML页面而不是JSON
      if (typeof response === 'string' && response.trim().startsWith('<!DOCTYPE html>')) {
        this.logger.error('API返回HTML页面，可能是URL配置错误', {
          apiUrl: this.config.apiUrl,
          responseStart: response.substring(0, 200)
        })
        throw new Error(`API URL配置错误: ${this.config.apiUrl} 返回的是网页而不是API接口。请检查API URL是否正确，通常应该是 /v1/chat/completions 结尾`)
      }

      // 尝试不同的响应格式
      let summary: string = ''
      
      if (response.choices && response.choices.length > 0) {
        // 标准OpenAI格式
        const choice = response.choices[0]
        if (choice.message && choice.message.content !== undefined) {
          summary = choice.message.content.trim()
          
          // 检查是否因为token限制导致内容被截断
          if (!summary && choice.finish_reason === 'length') {
            const tokenInfo = this.config.maxTokens && this.config.maxTokens > 0 
              ? `当前设置的最大token限制: ${this.config.maxTokens}`
              : '当前未设置token限制，可能是API端限制'
            throw new Error(`AI响应内容为空，原因：达到token限制。${tokenInfo}。建议减少输入内容长度或检查API设置`)
          }
          
          if (!summary && choice.finish_reason) {
            throw new Error(`AI响应内容为空，finish_reason: ${choice.finish_reason}`)
          }
          
        } else if (choice.text) {
          // 某些API可能在choice中直接返回text
          summary = choice.text.trim()
        } else {
          this.logger.error('AI响应消息格式错误', { 
            choice: JSON.stringify(choice, null, 2),
            hasMessage: !!choice.message,
            hasText: !!choice.text,
            contentType: typeof choice.message?.content,
            finishReason: choice.finish_reason
          })
          throw new Error(`AI响应消息格式错误: ${JSON.stringify(choice, null, 2)}`)
        }
      } else if (response.content) {
        // 某些API可能直接返回content字段
        summary = response.content.trim()
      } else if (response.message) {
        // 某些API可能直接返回message字段
        summary = response.message.trim()
      } else if (response.text) {
        // 某些API可能直接返回text字段
        summary = response.text.trim()
      } else if (response.data && response.data.content) {
        // 某些API可能在data字段中返回content
        summary = response.data.content.trim()
      } else {
        this.logger.error('AI响应格式错误', { 
          response: JSON.stringify(response, null, 2),
          hasChoices: !!response.choices,
          choicesLength: response.choices?.length,
          hasContent: !!response.content,
          hasMessage: !!response.message,
          hasText: !!response.text,
          hasData: !!response.data
        })
        throw new Error(`AI响应格式错误: ${JSON.stringify(response, null, 2)}`)
      }

      if (!summary) {
        throw new Error('AI响应内容为空')
      }

      this.logger.info('AI总结生成成功', { 
        inputLength: content.length,
        outputLength: summary.length,
        fileMode: this.config.useFileMode
      })

      return summary

    } catch (error) {
      // 增强错误信息处理
      let errorMessage = error.message || '未知错误'
      let suggestion = ''

      if (errorMessage.includes('context disposed')) {
        suggestion = `建议：文件模式请求被中断。可能原因：
1. 请求时间过长，建议减少聊天记录内容长度
2. 网络连接不稳定，建议重试
3. 尝试切换到文本模式：设置 useFileMode: false`
      } else if (errorMessage.includes('Service Unavailable')) {
        suggestion = '建议：API服务暂时不可用，请稍后重试或检查服务状态'
      } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        suggestion = '建议：API密钥无效，请检查配置中的apiKey是否正确'
      } else if (errorMessage.includes('Forbidden') || errorMessage.includes('403')) {
        suggestion = '建议：API密钥权限不足，请检查密钥是否有访问该模型的权限'
      } else if (errorMessage.includes('Not Found') || errorMessage.includes('404')) {
        suggestion = '建议：API接口地址错误，请检查apiUrl配置是否正确'
      } else if (errorMessage.includes('timeout')) {
        suggestion = this.config.useFileMode 
          ? '建议：文件模式请求超时，可尝试减少内容长度或增加timeout配置，或切换到文本模式'
          : '建议：请求超时，可以尝试增加timeout配置或检查网络连接'
      } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
        suggestion = '建议：网络连接失败，请检查网络连接和API地址是否可访问'
      } else if (errorMessage.includes('Rate limit') || errorMessage.includes('Too Many Requests')) {
        suggestion = '建议：API调用频率过高，请稍后重试'
      }

      this.logger.error('AI总结生成失败', { 
        error: errorMessage,
        suggestion,
        stack: error.stack,
        config: {
          apiUrl: this.config.apiUrl,
          model: this.config.model,
          fileMode: this.config.useFileMode,
          hasApiKey: !!this.config.apiKey,
          timeout: this.config.timeout,
          contentLength: content.length
        }
      })

      const finalMessage = suggestion 
        ? `AI总结生成失败: ${errorMessage}\n\n${suggestion}`
        : `AI总结生成失败: ${errorMessage}`
      
      throw new Error(finalMessage)
    }
  }

  /**
   * 构建文件模式的用户提示词
   */
  private buildFilePrompt(timeRange: string, messageCount: number, guildId: string): string {
    const groupInfo = this.getGroupInfo(guildId)
    
    return `请分析以下籽岷主播舰长群的聊天记录：

📊 **基本信息：**
- 时间范围：${timeRange}
- 消息数量：${messageCount} 条
- 聊天群组：${groupInfo}

💬 **分析要求：**
请根据下方的聊天记录内容，生成一份有趣的舰长群日报。聊天记录已按时间顺序整理，请仔细阅读并分析。`
  }

  /**
   * 获取默认系统提示词（作为备用）
   */
  private getDefaultSystemPrompt(): string {
    return `你是籽岷主播舰长群的专业聊天记录分析助手。你的任务是分析舰长们的聊天记录，并生成简洁有趣的总结。

请按照以下要求进行分析：

1. **游戏话题**：重点关注游戏相关的讨论，包括游戏攻略、新游戏推荐、游戏体验分享等
2. **主播互动**：识别与籽岷主播相关的话题，如直播内容讨论、粉丝互动、直播时间等
3. **舰长动态**：统计活跃的舰长，关注他们的互动和贡献
4. **日常闲聊**：不要忽略日常生活话题，这些也是群友感情交流的重要部分
5. **群内氛围**：分析群内的整体氛围（如：欢乐、激烈讨论、温馨互助等）
6. **重要事件**：提取值得关注的群内公告、活动、决定等

输出格式要求：
- 使用活泼有趣但表达清晰的语调，符合游戏群的氛围
- 结构清晰，用emoji和标题分段，便于快速阅读
- 控制在500字以内，重点突出，信息准确
- 如果聊天内容较少，说明"今天舰长们比较安静，主要是日常交流"
- 保护隐私，不透露具体的个人信息
- **重要：在风趣幽默的同时，确保信息传达准确清晰，避免过度使用网络梗或难懂的表达**

写作风格：
- 用词生动但不晦涩，让所有读者都能轻松理解
- 适当使用二次元/游戏文化用语，但不影响信息的清晰表达
- 重点信息用简洁明了的语言描述，辅以轻松的语调
- 结构化呈现，让读者一目了然

记住：幽默是调料，清晰是主菜！确保每个人都能快速理解群内动态。`
  }

  /**
   * 获取默认用户提示词模板（作为备用）
   */
  private getDefaultUserPromptTemplate(): string {
    return `请分析以下籽岷主播舰长群的聊天记录：

📊 **基本信息：**
- 时间范围：{timeRange}
- 消息数量：{messageCount} 条
- 聊天群组：{groupInfo}

💬 **聊天内容：**
{content}

请根据上述聊天记录，生成一份有趣的舰长群日报～`
  }

  /**
   * 测试AI接口连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.isEnabled()) {
      return {
        success: false,
        error: 'AI功能未启用或配置不完整'
      }
    }

    try {
      const result = await this.generateSummary(
        '用户A: 你好\n用户B: 你好，今天天气不错',
        '测试',
        2,
        'private'
      )
      
      if (result) {
        return { success: true }
      } else {
        return {
          success: false,
          error: '测试失败'
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: handleError(error, '连接测试失败')
      }
    }
  }
}
