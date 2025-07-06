import { Context, Logger } from 'koishi'
import { readFileSync } from 'fs'
import { join } from 'path'

// 动态导入puppeteer
const puppeteer = require('puppeteer')

export class MarkdownToImageService {
  private logger: Logger
  private browser: any = null

  constructor(private ctx: Context) {
    this.logger = ctx.logger('chat-summarizer:md-to-image')
  }

  /**
   * 初始化浏览器
   */
  private async initBrowser(): Promise<void> {
    if (!this.browser) {
      this.logger.debug('启动浏览器')
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      })
    }
  }

  /**
   * 关闭浏览器
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  /**
   * 将markdown内容转换为图片
   */
  async convertToImage(markdownContent: string): Promise<Buffer> {
    await this.initBrowser()
    
    const page = await this.browser.newPage()
    
    try {
      // 获取GitHub markdown CSS
      const githubCssPath = require.resolve('github-markdown-css/github-markdown.css')
      const githubCss = readFileSync(githubCssPath, 'utf-8')
      
      // 创建HTML模板
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            ${githubCss}
            .markdown-body {
              box-sizing: border-box;
              min-width: 200px;
              max-width: 800px;
              margin: 0 auto;
              padding: 45px;
              background-color: #ffffff;
              border-radius: 8px;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            body {
              background-color: #f6f8fa;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              margin: 20px;
            }
            h1 {
              color: #1f2328;
              border-bottom: 1px solid #d1d9e0;
              padding-bottom: 10px;
            }
            h2 {
              color: #1f2328;
              border-bottom: 1px solid #d1d9e0;
              padding-bottom: 8px;
            }
            .ai-summary-title {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              font-size: 28px;
              font-weight: bold;
              text-align: center;
              margin-bottom: 30px;
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
      
      await page.setContent(html)
      await page.setViewport({ width: 1000, height: 800 })
      
      // 等待页面加载完成
      await page.waitForSelector('.markdown-body')
      
      // 获取内容区域的尺寸
      const element = await page.$('.markdown-body')
      const boundingBox = await element.boundingBox()
      
      // 截图
      const screenshot = await page.screenshot({
        type: 'png',
        clip: {
          x: boundingBox.x - 20,
          y: boundingBox.y - 20,
          width: boundingBox.width + 40,
          height: boundingBox.height + 40
        }
      })
      
      this.logger.info('Markdown转图片成功', {
        contentLength: markdownContent.length,
        imageSize: screenshot.length
      })
      
      return screenshot
      
    } catch (error) {
      this.logger.error('Markdown转图片失败', error)
      throw error
    } finally {
      await page.close()
    }
  }

  /**
   * 简单的markdown到HTML转换
   */
  private markdownToHtml(markdown: string): string {
    return markdown
      // 标题
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
  }
} 