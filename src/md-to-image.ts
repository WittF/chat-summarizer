import { Context, Logger } from 'koishi'
import { readFileSync } from 'fs'
import { join } from 'path'

export class MarkdownToImageService {
  private logger: Logger

  constructor(private ctx: Context) {
    this.logger = ctx.logger('chat-summarizer:md-to-image')
  }

  /**
   * 获取本地字体的base64编码
   */
  private getFontBase64(fontFileName: string): string {
    try {
      // 使用正确的包名路径
      const fontPath = join(process.cwd(), 'node_modules', 'koishi-plugin-chat-summarizer', 'lib', 'assets', 'fonts', fontFileName)
      this.logger.debug(`尝试读取字体文件: ${fontPath}`)
      
      const fontBuffer = readFileSync(fontPath)
      const base64Data = fontBuffer.toString('base64')
      
      this.logger.debug(`字体文件 ${fontFileName} 读取成功，大小: ${fontBuffer.length} bytes`)
      return base64Data
    } catch (error) {
      this.logger.warn(`无法读取字体文件 ${fontFileName}`, error)
      
      // 尝试备用路径
      try {
        const altFontPath = join(__dirname, 'assets', 'fonts', fontFileName)
        this.logger.debug(`尝试备用路径: ${altFontPath}`)
        
        const fontBuffer = readFileSync(altFontPath)
        const base64Data = fontBuffer.toString('base64')
        
        this.logger.debug(`字体文件 ${fontFileName} 从备用路径读取成功，大小: ${fontBuffer.length} bytes`)
        return base64Data
      } catch (altError) {
        this.logger.warn(`备用路径也无法读取字体文件 ${fontFileName}`, altError)
        
        // 如果缺少NotoSansCJKsc-Regular.otf，尝试使用Bold版本
        if (fontFileName === 'NotoSansCJKsc-Regular.otf') {
          this.logger.info('尝试使用NotoSansCJKsc-Bold.otf作为fallback')
          return this.getFontBase64('NotoSansCJKsc-Bold.otf')
        }
        return ''
      }
    }
  }

  /**
   * 生成字体CSS - hybrid策略，平衡性能和可靠性
   */
  private generateFontCSS(): string {
    // 英文字体（小文件，优先加载）
    const interRegular = this.getFontBase64('Inter-Regular.woff2')
    const interBold = this.getFontBase64('Inter-Bold.woff2')
    
    // Emoji字体（大文件，但关键）
    const notoColorEmoji = this.getFontBase64('NotoColorEmoji.ttf')
    
    // 至少保留一个中文字体作为fallback
    const notoSansCJKscRegular = this.getFontBase64('NotoSansCJKsc-Regular.otf')

    // 检查字体数据是否成功读取
    const fontStatus = {
      interRegular: interRegular.length > 0,
      interBold: interBold.length > 0,
      notoColorEmoji: notoColorEmoji.length > 0,
      notoSansCJKscRegular: notoSansCJKscRegular.length > 0,
    }
    
    this.logger.info('字体文件读取状态:', fontStatus)

    // 如果emoji字体读取失败，记录警告
    if (!fontStatus.notoColorEmoji) {
      this.logger.warn('Emoji字体文件读取失败，将完全依赖系统字体，可能在某些环境下显示异常')
    }

    return `
      ${interRegular ? `
      /* 英文字体 */
      @font-face {
        font-family: 'Inter';
        src: url(data:font/woff2;base64,${interRegular}) format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }` : ''}
      
      ${interBold ? `
      @font-face {
        font-family: 'Inter';
        src: url(data:font/woff2;base64,${interBold}) format('woff2');
        font-weight: bold;
        font-style: normal;
        font-display: swap;
      }` : ''}
      
      ${notoColorEmoji ? `
      /* Emoji字体 - 关键字体 */
      @font-face {
        font-family: 'NotoColorEmoji';
        src: url(data:font/truetype;base64,${notoColorEmoji}) format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: fallback;
        unicode-range: U+1F300-1F5FF, U+1F600-1F64F, U+1F680-1F6FF, U+1F700-1F77F, U+1F780-1F7FF, U+1F800-1F8FF, U+1F900-1F9FF, U+1FA00-1FA6F, U+1FA70-1FAFF, U+2600-26FF, U+2700-27BF, U+FE00-FE0F, U+1F000-1F02F, U+1F0A0-1F0FF, U+1F100-1F64F, U+1F910-1F96B, U+1F980-1F997, U+1F9C0-1F9C2, U+1F9D0-1F9FF;
      }` : ''}
      
      ${notoSansCJKscRegular ? `
      /* 中文字体fallback */
      @font-face {
        font-family: 'NotoSansCJKsc';
        src: url(data:font/opentype;base64,${notoSansCJKscRegular}) format('opentype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
        unicode-range: U+4E00-9FFF, U+3400-4DBF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF, U+2CEB0-2EBEF;
      }` : ''}
    `
  }

  /**
   * 将markdown内容转换为图片
   */
  async convertToImage(markdownContent: string): Promise<Buffer> {
    // 获取puppeteer服务
    const puppeteer = (this.ctx as any).puppeteer
    
    // 获取GitHub markdown CSS
    const githubCssPath = require.resolve('github-markdown-css/github-markdown.css')
    const githubCss = readFileSync(githubCssPath, 'utf-8')
    
    // 生成字体CSS
    const fontCSS = this.generateFontCSS()
    
    // 创建HTML模板
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          ${fontCSS}
          ${githubCss}
          
          /* 完整的字体fallback策略 */
          body {
            background-color: #f6f8fa;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
            margin: 20px;
          }
          
          .markdown-body {
            box-sizing: border-box;
            min-width: 200px;
            max-width: 1000px;
            margin: 0 auto;
            padding: 45px;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
            line-height: 1.6;
          }
          
          /* 中文文本专用样式 */
          .markdown-body p, .markdown-body li, .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
          }
          
          /* 代码块使用等宽字体，包含中文支持 */
          .markdown-body pre, .markdown-body code {
            font-family: 'Consolas', 'Monaco', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei';
          }
          

          
          h1 {
            color: #1f2328;
            border-bottom: 1px solid #d1d9e0;
            padding-bottom: 10px;
            font-weight: bold;
          }
          h2 {
            color: #1f2328;
            border-bottom: 1px solid #d1d9e0;
            padding-bottom: 8px;
            font-weight: bold;
          }
          h3 {
            color: #1f2328;
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: bold;
          }
          h4 {
            color: #1f2328;
            margin-top: 20px;
            margin-bottom: 12px;
            font-size: 1.1em;
            font-weight: bold;
          }
          
          /* 粗体文本确保使用粗体字体 */
          .markdown-body strong, .markdown-body b {
            font-weight: bold;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
          }
          
          .ai-summary-title {
            font-size: 28px;
            font-weight: bold;
            text-align: center;
            margin-bottom: 30px;
            color: #667eea;
          }
          
          /* 确保中文标点符号正确显示 */
          .markdown-body {
            text-rendering: optimizeLegibility;
            -webkit-font-feature-settings: "liga", "kern";
            font-feature-settings: "liga", "kern";
          }
        </style>
      </head>
      <body>
        <div class="markdown-body">
          <div class="ai-summary-title">🤖 AI 总结</div>
          ${this.markdownToHtml(markdownContent)}
        </div>
      </body>
      </html>
    `
    
    try {
      // 使用Koishi的puppeteer服务渲染页面
      const imageBuffer = await puppeteer.render(html, async (page, next) => {
        // 设置视口
        await page.setViewport({ 
          width: 1200, 
          height: 1000,
          deviceScaleFactor: 2
        })
        
        // 等待页面加载完成
        await page.waitForSelector('.markdown-body')
        
        // 智能字体检查和fallback处理
        try {
          const fontCheckResults = await page.evaluate(() => {
            const fontsToCheck = ['Inter', 'NotoColorEmoji', 'NotoSansCJKsc']
            const results = {}
            
            fontsToCheck.forEach(font => {
              results[font] = document.fonts.check(`16px "${font}"`)
            })
            
            return results
          })
          
          this.logger.info('字体加载检查结果:', fontCheckResults)
          
          // 检查关键字体
          if (fontCheckResults.Inter) {
            this.logger.info('✅ Inter英文字体加载成功')
          } else {
            this.logger.warn('❌ Inter英文字体加载失败')
          }
          
          if (fontCheckResults.NotoColorEmoji) {
            this.logger.info('✅ Emoji字体加载成功')
          } else {
            this.logger.warn('❌ Emoji字体加载失败，将使用系统emoji字体')
          }
          
          // 全局字体设置 - 确保所有文字包括emoji都使用正确字体
          await page.addStyleTag({
            content: `
              /* 全局emoji字体设置 - 简单有效 */
              * {
                font-family: 'Inter', 'NotoSansCJKsc', 'NotoColorEmoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
              }
              
              /* 确保emoji优先使用emoji字体 */
              body, .markdown-body, .markdown-body * {
                font-variant-emoji: emoji !important;
              }
            `
          })
          
          if (fontCheckResults.NotoSansCJKsc) {
            this.logger.info('✅ 中文字体加载成功')
          } else {
            this.logger.warn('❌ 中文字体加载失败，使用系统中文字体')
          }
          
        } catch (e) {
          this.logger.warn('字体检查失败，启用完整fallback策略')
          
          // 出错时的完整fallback策略
          await page.addStyleTag({
            content: `
              * {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Microsoft YaHei', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji' !important;
              }
              body, .markdown-body, .markdown-body * {
                font-variant-emoji: emoji !important;
              }
            `
          })
        }
        
        // 额外等待确保字体加载完成
        await new Promise(resolve => setTimeout(resolve, 1200))
        
        // 测试emoji渲染情况
        try {
          const emojiTest = await page.evaluate(() => {
            // 在页面中创建测试元素
            const testDiv = document.createElement('div')
            testDiv.innerHTML = '🤖'
            testDiv.style.fontFamily = '"NotoColorEmoji", "Apple Color Emoji", "Segoe UI Emoji"'
            testDiv.style.fontSize = '16px'
            document.body.appendChild(testDiv)
            
            // 检查渲染的文字宽度来判断是否使用了emoji字体
            const style = window.getComputedStyle(testDiv)
            const result = {
              fontFamily: style.fontFamily,
              width: testDiv.offsetWidth,
              height: testDiv.offsetHeight,
              text: testDiv.textContent
            }
            
            document.body.removeChild(testDiv)
            return result
          })
          
          this.logger.info('Emoji渲染测试结果:', emojiTest)
          
          if (emojiTest.width > 10) {
            this.logger.info('✅ Emoji渲染正常')
          } else {
            this.logger.warn('❌ Emoji可能渲染为方块或空白')
          }
          
        } catch (testError) {
          this.logger.warn('Emoji渲染测试失败', testError)
        }
        
        // 获取内容区域并截图
        const element = await page.$('.markdown-body')
        if (!element) {
          throw new Error('无法找到内容区域')
        }
        
        const boundingBox = await element.boundingBox()
        if (!boundingBox) {
          throw new Error('无法获取内容区域尺寸')
        }
        
        const screenshot = await page.screenshot({
          type: 'png',
          optimizeForSpeed: false,
          clip: {
            x: Math.max(0, boundingBox.x - 20),
            y: Math.max(0, boundingBox.y - 20),
            width: boundingBox.width + 40,
            height: boundingBox.height + 40
          }
        })
        
        return screenshot
      })
      
      this.logger.info('Markdown转图片成功', {
        contentLength: markdownContent.length,
        imageSize: imageBuffer.length
      })
      
      return Buffer.from(imageBuffer, 'base64')
      
    } catch (error) {
      this.logger.error('Markdown转图片失败', error)
      throw error
    }
  }

  /**
   * 简单的markdown到HTML转换
   */
  private markdownToHtml(markdown: string): string {
    const result = markdown
      // 标题
      .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      
      // 粗体和斜体
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      
      // 代码块
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```/g, '').trim()
        return `<pre><code>${code}</code></pre>`
      })
      
      // 行内代码
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      
      // 列表
      .replace(/^\* (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      
      // 数字列表
      .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>')
      
      // 换行
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      
      // 包装段落
      .replace(/^(.+)$/gm, '<p>$1</p>')
      
      // 清理空段落
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<[^>]+>)<\/p>/g, '$1')

    return result
  }
} 