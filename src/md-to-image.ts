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
      const fontPath = join(__dirname, 'assets', 'fonts', fontFileName)
      const fontBuffer = readFileSync(fontPath)
      return fontBuffer.toString('base64')
    } catch (error) {
      this.logger.warn(`无法读取字体文件 ${fontFileName}`, error)
      // 如果缺少NotoSansCJKsc-Regular.otf，尝试使用Bold版本
      if (fontFileName === 'NotoSansCJKsc-Regular.otf') {
        return this.getFontBase64('NotoSansCJKsc-Bold.otf')
      }
      return ''
    }
  }

  /**
   * 生成字体CSS - 完整的中文字体fallback策略
   */
  private generateFontCSS(): string {
    // 英文字体
    const interRegular = this.getFontBase64('Inter-Regular.woff2')
    const interBold = this.getFontBase64('Inter-Bold.woff2')
    
    // 中文字体 - 多层fallback
    const notoSansCJKscRegular = this.getFontBase64('NotoSansCJKsc-Regular.otf')
    const notoSansCJKscBold = this.getFontBase64('NotoSansCJKsc-Bold.otf')
    const notoSansCJKtcRegular = this.getFontBase64('NotoSansCJKtc-Regular.otf')
    const sourceHanSansRegular = this.getFontBase64('SourceHanSansSC-Regular.otf')
    
    // Emoji字体
    const notoColorEmoji = this.getFontBase64('NotoColorEmoji.ttf')

    return `
      /* 主要英文字体 */
      @font-face {
        font-family: 'Inter';
        src: url(data:font/woff2;base64,${interRegular}) format('woff2');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
      
      @font-face {
        font-family: 'Inter';
        src: url(data:font/woff2;base64,${interBold}) format('woff2');
        font-weight: bold;
        font-style: normal;
        font-display: swap;
      }
      
      /* 主要中文字体 - Noto Sans CJK 简体 */
      @font-face {
        font-family: 'NotoSansCJKsc';
        src: url(data:font/opentype;base64,${notoSansCJKscRegular}) format('opentype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
      
      @font-face {
        font-family: 'NotoSansCJKsc';
        src: url(data:font/opentype;base64,${notoSansCJKscBold}) format('opentype');
        font-weight: bold;
        font-style: normal;
        font-display: swap;
      }
      
      /* 中文字体fallback 1 - Noto Sans CJK 繁体 */
      @font-face {
        font-family: 'NotoSansCJKtc';
        src: url(data:font/opentype;base64,${notoSansCJKtcRegular}) format('opentype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
      
      /* 中文字体fallback 2 - 思源黑体 */
      @font-face {
        font-family: 'SourceHanSansSC';
        src: url(data:font/opentype;base64,${sourceHanSansRegular}) format('opentype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
      
      /* Emoji字体 */
      @font-face {
        font-family: 'NotoColorEmoji';
        src: url(data:font/truetype;base64,${notoColorEmoji}) format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
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
            font-family: 'Inter', 'NotoSansCJKsc', 'NotoSansCJKtc', 'SourceHanSansSC', 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif;
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
            font-family: 'Inter', 'NotoSansCJKsc', 'NotoSansCJKtc', 'SourceHanSansSC', 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif;
            line-height: 1.6;
          }
          
          /* 中文文本专用样式 */
          .markdown-body p, .markdown-body li, .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
            font-family: 'Inter', 'NotoSansCJKsc', 'NotoSansCJKtc', 'SourceHanSansSC', 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif;
          }
          
          /* 代码块使用等宽字体，包含中文支持 */
          .markdown-body pre, .markdown-body code {
            font-family: 'Consolas', 'Monaco', 'NotoSansCJKsc', 'NotoSansCJKtc', 'SourceHanSansSC', monospace;
          }
          
          /* emoji专用字体配置 */
          .emoji,
          .ai-summary-title {
            font-family: 'NotoColorEmoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Twemoji', 'Inter', 'NotoSansCJKsc', 'NotoSansCJKtc', 'SourceHanSansSC', sans-serif;
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
            font-family: 'Inter', 'NotoSansCJKsc', 'NotoSansCJKtc', 'SourceHanSansSC', 'PingFang SC', 'Microsoft YaHei', 'SimHei', sans-serif;
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
        
        // 等待页面和字体加载完成
        await page.waitForSelector('.markdown-body')
        
        // 等待所有字体加载完成
        try {
          await page.waitForFunction(
            () => {
              const fonts = ['Inter', 'NotoSansCJKsc', 'NotoColorEmoji']
              return fonts.every(font => document.fonts.check(`16px "${font}"`))
            },
            { timeout: 8000 }
          )
          this.logger.info('所有字体加载完成')
        } catch (e) {
          this.logger.warn('部分字体加载超时，使用fallback字体继续渲染')
        }
        
        await new Promise(resolve => setTimeout(resolve, 800))
        
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

    // 为emoji添加特殊class
    return result.replace(/([\u{1F000}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|🤖)/gu, '<span class="emoji">$1</span>')
  }
} 