import { Context, Logger } from 'koishi'
import { Config, AISummaryOutput } from './types'
import { handleError } from './utils'
import { STRUCTURED_SYSTEM_PROMPT } from './config'

export class AIService {
  private logger: Logger
  private globalConfig: Config

  constructor(private ctx: Context, config: Config) {
    this.logger = ctx.logger('chat-summarizer:ai')
    this.globalConfig = config
  }

  /**
   * 获取全局AI配置
   */
  private get config(): Config['ai'] {
    return this.globalConfig.ai
  }

  /**
   * 获取群组专用的AI配置
   */
  private getGroupAIConfig(guildId: string): {
    systemPrompt?: string
    userPromptTemplate?: string
    enabled?: boolean
  } {
    const groupConfig = this.globalConfig.monitor.groups.find(
      group => group.groupId === guildId
    )

    return {
      systemPrompt: groupConfig?.systemPrompt || this.config.systemPrompt,
      userPromptTemplate: groupConfig?.userPromptTemplate || this.config.userPromptTemplate,
      enabled: groupConfig?.summaryEnabled !== undefined ? groupConfig.summaryEnabled : this.config.enabled
    }
  }

  /**
   * 检查AI服务是否已启用并配置正确
   */
  isEnabled(guildId?: string): boolean {
    const globalEnabled = this.config.enabled && 
                          !!this.config.apiUrl && 
                          !!this.config.apiKey
    
    if (!globalEnabled) return false
    
    // 如果提供了群组ID，检查群组专用配置
    if (guildId) {
      const groupConfig = this.getGroupAIConfig(guildId)
      return groupConfig.enabled !== false // 只有明确设置为false才禁用
    }
    
    return true
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
    // 检查群组级别的AI启用状态
    if (!this.isEnabled(guildId)) {
      throw new Error('AI总结功能未启用或该群组已禁用AI功能')
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI配置不完整，请检查API URL和密钥')
    }

    try {
      // 获取群组专用配置
      const groupConfig = this.getGroupAIConfig(guildId)
      
      // 构建系统提示词（优先使用群组配置）
      const systemPrompt = groupConfig.systemPrompt || this.getDefaultSystemPrompt()
      
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
        
        const userPromptTemplate = groupConfig.userPromptTemplate || this.getDefaultUserPromptTemplate()
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
    
    // 获取群组专用配置
    const groupConfig = this.getGroupAIConfig(guildId)
    
    // 如果群组有自定义的用户提示词模板，使用它
    if (groupConfig.userPromptTemplate) {
      return this.replaceTemplate(groupConfig.userPromptTemplate, {
        timeRange,
        messageCount: messageCount.toString(),
        groupInfo,
        content: '' // 在文件模式下，内容会在外部添加
      })
    }
    
    // 否则使用默认的文件模式提示词
    return `请分析以下群聊天记录：

📊 **基本信息：**
- 时间范围：${timeRange}
- 消息数量：${messageCount} 条
- 聊天群组：${groupInfo}

💬 **分析要求：**
请根据下方的聊天记录内容，生成一份有趣的群日报。聊天记录已按时间顺序整理，请仔细阅读并分析。`
  }

  /**
   * 获取默认系统提示词（作为备用）
   */
  private getDefaultSystemPrompt(): string {
    return `你是专业聊天记录分析助手。你的任务是分析群友们的聊天记录，并生成简洁有趣的总结。

请按照以下要求进行分析：

1. **群友动态**：统计活跃的群友，关注他们的互动和贡献
2. **日常闲聊**：不要忽略日常生活话题，这些也是群友感情交流的重要部分
3. **群内氛围**：分析群内的整体氛围（如：欢乐、激烈讨论、温馨互助等）
4. **重要事件**：提取值得关注的群内公告、活动、决定等

输出格式要求：
- 使用表达清晰的语调，符合群聊的氛围
- 结构清晰，用emoji和标题分段，便于快速阅读
- 控制在500字以内，重点突出，信息准确
- 如果聊天内容较少，说明"今天大家比较安静，主要是日常交流"
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
    return `请分析以下群聊天记录：

📊 **基本信息：**
- 时间范围：{timeRange}
- 消息数量：{messageCount} 条
- 聊天群组：{groupInfo}

💬 **聊天内容：**
{content}

请根据上述聊天记录，生成一份有趣的群日报～`
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

  /**
   * 解析用户的自然语言分析查询
   * 返回时间范围和分析提示词
   */
  async parseAnalysisQuery(userQuery: string, guildId: string): Promise<{
    timeRange: string
    analysisPrompt: string
  }> {
    if (!this.isEnabled(guildId)) {
      throw new Error('AI功能未启用或该群组已禁用AI功能')
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI配置不完整，请检查API URL和密钥')
    }

    try {
      // 获取当前日期信息
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]

      const systemPrompt = `你是一个聊天记录分析助手。用户会用自然语言提出对聊天记录的分析需求。
你需要解析用户的需求，并返回JSON格式的结果，包含两个字段：
1. timeRange: 需要分析的时间范围，必须是具体日期格式
   - 单日：使用 YYYY-MM-DD 格式（如：2025-01-07）
   - 多日：使用逗号分隔的日期列表（如：2025-01-05,2025-01-06,2025-01-07）
   - 注意：必须返回具体日期，不要返回 "yesterday"、"last7days" 等相对时间
2. analysisPrompt: 根据用户需求生成的简洁分析提示词，用于指导后续的聊天记录分析

请确保返回的是有效的JSON格式，不要包含其他内容。

示例输入（今天是 2025-01-08）："昨天群里发生了什么大事？"
示例输出：
{
  "timeRange": "2025-01-07",
  "analysisPrompt": "找出聊天记录中的重要事件、热门话题和重要决定，简洁列出。"
}

示例输入（今天是 2025-01-08）："最近3天大家聊了什么游戏？"
示例输出：
{
  "timeRange": "2025-01-06,2025-01-07,2025-01-08",
  "analysisPrompt": "找出所有关于游戏的讨论，列出提到的游戏名称和主要讨论内容。"
}

示例输入（今天是 2025-01-08）："昨天的金句"
示例输出：
{
  "timeRange": "2025-01-07",
  "analysisPrompt": "找出聊天记录中最有趣、最精彩或最有哲理的一句话，只返回这一句话和发送者信息。"
}

注意：
- 如果用户没有明确指定时间，默认使用昨天的日期
- analysisPrompt 要简洁、具体，指导AI给出不超过100字的分析结果
- 必须返回有效的JSON格式，不要添加任何解释性文字`

      const userPrompt = `当前日期信息：
- 今天：${today}
- 昨天：${yesterdayStr}

用户查询：${userQuery}

请根据当前日期，将用户查询中的相对时间转换为具体日期，然后返回JSON格式的结果。`

      const requestBody = {
        model: this.config.model || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      }

      if (this.config.maxTokens && this.config.maxTokens > 0) {
        requestBody['max_tokens'] = this.config.maxTokens
      }

      this.logger.debug('发送查询解析请求', {
        url: this.config.apiUrl,
        userQuery
      })

      const response = await this.ctx.http.post(this.config.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        timeout: (this.config.timeout || 30) * 1000
      })

      if (!response || !response.choices || response.choices.length === 0) {
        throw new Error('AI接口未返回有效响应')
      }

      const content = response.choices[0].message?.content?.trim()
      if (!content) {
        throw new Error('AI返回内容为空')
      }

      // 解析JSON响应
      let parsedResult: any
      try {
        // 尝试提取JSON（可能被包裹在markdown代码块中）
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          throw new Error('响应中未找到JSON格式')
        }
        parsedResult = JSON.parse(jsonMatch[0])
      } catch (parseError) {
        this.logger.error('解析AI返回的JSON失败', { content, error: parseError })
        throw new Error(`解析AI响应失败: ${parseError.message}`)
      }

      // 验证返回的字段
      if (!parsedResult.timeRange || !parsedResult.analysisPrompt) {
        throw new Error('AI返回的JSON缺少必需字段')
      }

      this.logger.info('查询解析成功', {
        userQuery,
        timeRange: parsedResult.timeRange,
        analysisPromptLength: parsedResult.analysisPrompt.length
      })

      return {
        timeRange: parsedResult.timeRange,
        analysisPrompt: parsedResult.analysisPrompt
      }

    } catch (error) {
      this.logger.error('解析用户查询失败', {
        error: error.message,
        stack: error.stack
      })
      throw new Error(`解析查询失败: ${error.message}`)
    }
  }

  /**
   * 执行聊天记录分析
   */
  async analyzeChat(
    content: string,
    analysisPrompt: string,
    timeRange: string,
    messageCount: number,
    guildId: string
  ): Promise<string> {
    if (!this.isEnabled(guildId)) {
      throw new Error('AI功能未启用或该群组已禁用AI功能')
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI配置不完整，请检查API URL和密钥')
    }

    try {
      const systemPrompt = `你是专业的聊天记录分析助手。你需要根据用户的分析需求，仔细阅读聊天记录并提供简洁的分析结果。

分析要求：
1. 准确理解用户的分析需求
2. 仔细阅读聊天记录，提取相关信息
3. 回答简洁明了，不超过100字
4. 如果聊天记录中没有相关内容，如实说明

输出格式：
- 使用纯文本格式，不使用 Markdown、加粗、斜体等特殊格式
- 直接给出分析结果，不需要标题或结构化排版
- 语言精炼，一针见血
- 如果是引用消息，格式为：用户名(ID:用户ID): 消息内容`

      const groupInfo = this.getGroupInfo(guildId)
      const userPrompt = `分析任务：${analysisPrompt}

日期：${timeRange}
消息数量：${messageCount} 条
聊天群组：${groupInfo}

聊天记录：
${content}

请根据上述分析任务和聊天记录，提供简洁的分析结果（不超过100字，使用纯文本格式）。`

      const requestBody = {
        model: this.config.model || 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      }

      if (this.config.maxTokens && this.config.maxTokens > 0) {
        requestBody['max_tokens'] = this.config.maxTokens
      }

      this.logger.debug('发送分析请求', {
        url: this.config.apiUrl,
        contentLength: content.length,
        timeRange
      })

      const timeoutMs = (this.config.timeout || 60) * 1000

      const response = await this.ctx.http.post(this.config.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        timeout: timeoutMs
      })

      if (!response || !response.choices || response.choices.length === 0) {
        throw new Error('AI接口未返回有效响应')
      }

      const analysisResult = response.choices[0].message?.content?.trim()
      if (!analysisResult) {
        throw new Error('AI返回内容为空')
      }

      this.logger.info('分析完成', {
        inputLength: content.length,
        outputLength: analysisResult.length
      })

      return analysisResult

    } catch (error) {
      this.logger.error('聊天记录分析失败', {
        error: error.message,
        stack: error.stack
      })
      throw new Error(`分析失败: ${error.message}`)
    }
  }

  /**
   * 生成结构化的 AI 总结
   * 返回固定格式的 JSON 数据，由前端代码负责渲染
   */
  async generateStructuredSummary(
    content: string,
    timeRange: string,
    messageCount: number,
    guildId: string,
    uniqueUsers: number
  ): Promise<AISummaryOutput> {
    if (!this.isEnabled(guildId)) {
      throw new Error('AI总结功能未启用或该群组已禁用AI功能')
    }

    if (!this.config.apiUrl || !this.config.apiKey) {
      throw new Error('AI配置不完整，请检查API URL和密钥')
    }

    const maxRetries = 2
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const groupInfo = this.getGroupInfo(guildId)

        const userPrompt = `请分析以下群聊天记录，并输出结构化JSON：

📊 基本信息：
- 时间范围：${timeRange}
- 消息数量：${messageCount} 条
- 参与人数：${uniqueUsers} 人
- 聊天群组：${groupInfo}

💬 聊天内容：
${content}

请严格按照系统提示词要求的JSON格式输出分析结果。`

        const requestBody: any = {
          model: this.config.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: STRUCTURED_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5, // 降低温度以获得更稳定的 JSON 输出
          stream: false
        }

        if (this.config.maxTokens && this.config.maxTokens > 0) {
          requestBody.max_tokens = this.config.maxTokens
        }

        this.logger.debug(`发送结构化总结请求 (尝试 ${attempt}/${maxRetries})`, {
          url: this.config.apiUrl,
          model: requestBody.model,
          contentLength: content.length
        })

        const timeoutMs = Math.max((this.config.timeout || 120) * 1000, 120000)

        const response = await this.ctx.http.post(this.config.apiUrl, requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          timeout: timeoutMs
        })

        if (!response) {
          throw new Error('AI接口未返回响应')
        }

        // 提取响应内容
        let responseContent: string = ''

        if (response.choices && response.choices.length > 0) {
          const choice = response.choices[0]
          if (choice.message && choice.message.content) {
            responseContent = choice.message.content.trim()
          } else if (choice.text) {
            responseContent = choice.text.trim()
          }
        } else if (response.content) {
          responseContent = response.content.trim()
        } else if (response.message) {
          responseContent = response.message.trim()
        } else if (response.text) {
          responseContent = response.text.trim()
        }

        if (!responseContent) {
          throw new Error('AI响应内容为空')
        }

        // 解析 JSON 响应
        const parsed = this.parseStructuredResponse(responseContent)

        this.logger.info('结构化AI总结生成成功', {
          inputLength: content.length,
          hotTopicsCount: parsed.hotTopics.length,
          quotesCount: parsed.quotes.length
        })

        return parsed

      } catch (error: any) {
        lastError = error
        this.logger.warn(`结构化总结生成失败 (尝试 ${attempt}/${maxRetries})`, {
          error: error.message
        })

        if (attempt < maxRetries) {
          // 等待一会儿再重试
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    }

    // 所有重试都失败，返回默认结构
    this.logger.error('结构化总结生成最终失败，使用默认结构', {
      error: lastError?.message
    })

    return this.getDefaultAISummaryOutput()
  }

  /**
   * 解析结构化响应
   */
  private parseStructuredResponse(content: string): AISummaryOutput {
    try {
      // 尝试提取 JSON（可能被包裹在 markdown 代码块中）
      let jsonStr = content

      // 移除可能的 markdown 代码块标记
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim()
      } else {
        // 尝试直接找到 JSON 对象
        const objMatch = content.match(/\{[\s\S]*\}/)
        if (objMatch) {
          jsonStr = objMatch[0]
        }
      }

      const parsed = JSON.parse(jsonStr)

      // 验证并补全必需字段
      return this.validateAndNormalizeOutput(parsed)

    } catch (parseError) {
      this.logger.error('解析AI结构化响应失败', {
        content: content.substring(0, 500),
        error: parseError.message
      })
      throw new Error(`JSON解析失败: ${parseError.message}`)
    }
  }

  /**
   * 验证并规范化输出结构
   */
  private validateAndNormalizeOutput(parsed: any): AISummaryOutput {
    // 确保 summary 字段存在
    const summary = parsed.summary || {}

    const output: AISummaryOutput = {
      summary: {
        overview: summary.overview || '今日群内互动平稳，主要以日常交流为主。',
        highlights: Array.isArray(summary.highlights) ? summary.highlights : [],
        atmosphere: summary.atmosphere || '轻松日常'
      },
      hotTopics: [],
      importantInfo: [],
      quotes: []
    }

    // 处理 hotTopics
    if (Array.isArray(parsed.hotTopics)) {
      output.hotTopics = parsed.hotTopics
        .filter((t: any) => t && t.topic)
        .map((t: any) => ({
          topic: t.topic || '',
          description: t.description || '',
          participants: Array.isArray(t.participants) ? t.participants : [],
          heatLevel: ['high', 'medium', 'low'].includes(t.heatLevel) ? t.heatLevel : 'medium'
        }))
        .slice(0, 5)
    }

    // 处理 importantInfo
    if (Array.isArray(parsed.importantInfo)) {
      output.importantInfo = parsed.importantInfo
        .filter((i: any) => i && i.content)
        .map((i: any) => ({
          type: ['announcement', 'link', 'resource', 'decision', 'other'].includes(i.type) ? i.type : 'other',
          content: i.content || '',
          source: i.source
        }))
        .slice(0, 10)
    }

    // 处理 quotes
    if (Array.isArray(parsed.quotes)) {
      output.quotes = parsed.quotes
        .filter((q: any) => q && q.content && q.author)
        .map((q: any) => ({
          content: q.content || '',
          author: q.author || '匿名'
        }))
        .slice(0, 5)
    }

    return output
  }

  /**
   * 获取默认的 AI 总结输出
   */
  private getDefaultAISummaryOutput(): AISummaryOutput {
    return {
      summary: {
        overview: '今日群内互动情况已记录，AI分析暂时不可用。',
        highlights: ['群内有日常交流活动'],
        atmosphere: '日常'
      },
      hotTopics: [],
      importantInfo: [],
      quotes: []
    }
  }
}
