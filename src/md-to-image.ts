import { Context, Logger } from 'koishi'
import { readFileSync } from 'fs'
import { join } from 'path'

export class MarkdownToImageService {
  private logger: Logger
  private isRendering: boolean = false
  private renderQueue: Array<() => Promise<void>> = []
  private fontCache: Map<string, boolean> = new Map()

  constructor(private ctx: Context) {
    this.logger = ctx.logger('chat-summarizer:md-to-image')
  }

  /**
   * 检查是否正在渲染，避免并发渲染
   */
  private async waitForRenderSlot(): Promise<void> {
    if (!this.isRendering) {
      this.isRendering = true
      return
    }

    // 如果正在渲染，加入队列等待
    this.logger.info('渲染进程繁忙，加入等待队列...')
    return new Promise((resolve) => {
      this.renderQueue.push(async () => {
        this.isRendering = true
        resolve()
      })
    })
  }

  /**
   * 释放渲染槽位
   */
  private releaseRenderSlot(): void {
    this.isRendering = false
    
    // 处理队列中的下一个任务
    const nextTask = this.renderQueue.shift()
    if (nextTask) {
      this.logger.info('处理队列中的下一个渲染任务')
      nextTask()
    }
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
   * 生成字体CSS - 简化版，不包含emoji字体
   */
  private generateFontCSS(): string {
    // 英文字体（小文件，优先加载）
    const interRegular = this.getFontBase64('Inter-Regular.woff2')
    const interBold = this.getFontBase64('Inter-Bold.woff2')
    
    // 中文字体
    const notoSansCJKscRegular = this.getFontBase64('NotoSansCJKsc-Regular.otf')

    // 检查字体数据是否成功读取
    const fontStatus = {
      interRegular: interRegular.length > 0,
      interBold: interBold.length > 0,
      notoSansCJKscRegular: notoSansCJKscRegular.length > 0,
    }
    
    this.logger.info('字体文件读取状态:', fontStatus)
    this.logger.info('🖼️ 使用CDN图片emoji代替字体emoji')

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
      
      ${notoSansCJKscRegular ? `
      /* 中文字体 */
      @font-face {
        font-family: 'NotoSansCJKsc';
        src: url(data:font/opentype;base64,${notoSansCJKscRegular}) format('opentype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
        unicode-range: U+4E00-9FFF, U+3400-4DBF, U+20000-2A6DF, U+2A700-2B73F, U+2B740-2B81F, U+2B820-2CEAF, U+2CEB0-2EBEF;
      }` : ''}
      
      /* Emoji图片样式 */
      .emoji {
        display: inline-block;
        width: 1.2em;
        height: 1.2em;
        vertical-align: -0.125em;
        margin: 0 0.05em;
      }
    `
  }

  /**
   * 将文本中的emoji转换为图片标签
   */
  private convertEmojiToImages(html: string): string {
    // 使用CDN emoji图片
    const emojiBaseUrl = 'https://fastly.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/'
    
    // 常见emoji映射表，转为十六进制编码
    const emojiMap: { [key: string]: string } = {
      '🤖': '1f916',
      '😀': '1f600',
      '😃': '1f603',
      '😄': '1f604',
      '😁': '1f601',
      '😆': '1f606',
      '😅': '1f605',
      '😂': '1f602',
      '🤣': '1f923',
      '😊': '1f60a',
      '🙂': '1f642',
      '😉': '1f609',
      '😍': '1f60d',
      '🥰': '1f970',
      '😘': '1f618',
      '😋': '1f60b',
      '😛': '1f61b',
      '😝': '1f61d',
      '😜': '1f61c',
      '🤪': '1f929',
      '🤨': '1f928',
      '🧐': '1f9d0',
      '🤓': '1f913',
      '😎': '1f60e',
      '🤩': '1f929',
      '🥳': '1f973',
      '😏': '1f60f',
      '😒': '1f612',
      '😞': '1f61e',
      '😔': '1f614',
      '😟': '1f61f',
      '😕': '1f615',
      '🙁': '1f641',
      '😣': '1f623',
      '😖': '1f616',
      '😫': '1f62b',
      '😩': '1f629',
      '🥺': '1f97a',
      '😢': '1f622',
      '😭': '1f62d',
      '😤': '1f624',
      '😠': '1f620',
      '😡': '1f621',
      '🤬': '1f92c',
      '🤯': '1f92f',
      '😱': '1f631',
      '😨': '1f628',
      '😰': '1f630',
      '😥': '1f625',
      '😓': '1f613',
      '🤗': '1f917',
      '🤔': '1f914',
      '🤭': '1f92d',
      '🤫': '1f92b',
      '🤥': '1f925',
      '😶': '1f636',
      '😐': '1f610',
      '😑': '1f611',
      '😬': '1f62c',
      '🙄': '1f644',
      '😯': '1f62f',
      '😦': '1f626',
      '😧': '1f627',
      '😮': '1f62e',
      '😲': '1f632',
      '🥱': '1f971',
      '😴': '1f634',
      '🤤': '1f924',
      '😪': '1f62a',
      '😵': '1f635',
      '🤐': '1f910',
      '🥴': '1f974',
      '🤢': '1f922',
      '🤮': '1f92e',
      '🤧': '1f927',
      '😷': '1f637',
      '🤒': '1f912',
      '🤕': '1f915',
      '🤑': '1f911',
      '🤠': '1f920',
      '😈': '1f608',
      '👿': '1f47f',
      '👹': '1f479',
      '👺': '1f47a',
      '🤡': '1f921',
      '💩': '1f4a9',
      '👻': '1f47b',
      '💀': '1f480',
      '☠️': '2620',
      '👽': '1f47d',
      '👾': '1f47e',
      '🎉': '1f389',
      '🎊': '1f38a',
      '🎈': '1f388',
      '🎁': '1f381',
      '🎀': '1f380',
      '🎂': '1f382',
      '🍰': '1f370',
      '🧁': '1f9c1',
      '🍭': '1f36d',
      '🍬': '1f36c',
      '🍫': '1f36b',
      '🍩': '1f369',
      '🍪': '1f36a',
      '🥛': '1f95b',
      '☕': '2615',
      '🍵': '1f375',
      '🍺': '1f37a',
      '🍻': '1f37b',
      '🥂': '1f942',
      '🍷': '1f377',
      '🍾': '1f37e',
      '🍸': '1f378',
      '🍹': '1f379',
      '🍼': '1f37c',
      '🥃': '1f943',
      '🔥': '1f525',
      '💧': '1f4a7',
      '🌊': '1f30a',
      '❄️': '2744',
      '⭐': '2b50',
      '🌟': '1f31f',
      '✨': '2728',
      '🌈': '1f308',
      '☀️': '2600',
      '🌤️': '1f324',
      '⛅': '26c5',
      '🌥️': '1f325',
      '☁️': '2601',
      '🌦️': '1f326',
      '🌧️': '1f327',
      '⛈️': '26c8',
      '🌩️': '1f329',
      '🌨️': '1f328',
      '❤️': '2764',
      '🧡': '1f9e1',
      '💛': '1f49b',
      '💚': '1f49a',
      '💙': '1f499',
      '💜': '1f49c',
      '🤍': '1f90d',
      '🖤': '1f5a4',
      '🤎': '1f90e',
      '💔': '1f494',
      '❣️': '2763',
      '💕': '1f495',
      '💞': '1f49e',
      '💓': '1f493',
      '💗': '1f497',
      '💖': '1f496',
      '💘': '1f498',
      '💝': '1f49d',
      '💟': '1f49f',
      '🎯': '1f3af',
      '🔫': '1f52b',
      '🎱': '1f3b1',
      '🎮': '1f3ae',
      '🕹️': '1f579',
      '🎰': '1f3b0',
      '🎲': '1f3b2',
      '🧩': '1f9e9',
      '🧸': '1f9f8',
      '🎭': '1f3ad',
      '🎨': '1f3a8',
      '👓': '1f453',
      '🕶️': '1f576',
      '🥽': '1f97d',
      '🥼': '1f97c',
      '🦺': '1f9ba',
      '👔': '1f454',
      '👕': '1f455',
      '👖': '1f456',
      '🧣': '1f9e3',
      '🧤': '1f9e4',
      '🧥': '1f9e5',
      '🧦': '1f9e6',
      '👗': '1f457',
      '👘': '1f458',
      '🥻': '1f97b',
      '🩱': '1fa71',
      '🩲': '1fa72',
      '🩳': '1fa73',
      '👙': '1f459',
      '👚': '1f45a',
      '👛': '1f45b',
      '👜': '1f45c',
      '👝': '1f45d',
      '🛍️': '1f6cd',
      '🎒': '1f392',
      '🩴': '1fa74',
      '👞': '1f45e',
      '👟': '1f45f',
      '🥾': '1f97e',
      '🥿': '1f97f',
      '👠': '1f460',
      '👡': '1f461',
      '🩰': '1fa70',
      '👢': '1f462',
      '👑': '1f451',
      '👒': '1f452',
      '🎩': '1f3a9',
      '🎓': '1f393',
      '🧢': '1f9e2',
      '💄': '1f484',
      '💍': '1f48d',
      '💎': '1f48e'
    }
    
    this.logger.info(`🖼️ 使用CDN emoji图片，共${Object.keys(emojiMap).length}个emoji可转换`)
    
    // 替换emoji为图片标签
    let result = html
    for (const [emoji, unicode] of Object.entries(emojiMap)) {
      const imgTag = `<img class="emoji" src="${emojiBaseUrl}${unicode}.png" alt="${emoji}" loading="eager">`
      result = result.replace(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), imgTag)
    }
    
    return result
  }

  /**
   * 将markdown内容转换为图片
   */
  async convertToImage(markdownContent: string): Promise<Buffer> {
    const startTime = Date.now()
    
    // 等待渲染槽位，避免并发渲染影响性能
    await this.waitForRenderSlot()
    
    this.logger.info('开始图片渲染，队列等待时间:', Date.now() - startTime, 'ms')
    
    // 获取puppeteer服务
    const puppeteer = (this.ctx as any).puppeteer
    
    // 获取GitHub markdown CSS
    const githubCssPath = require.resolve('github-markdown-css/github-markdown.css')
    const githubCss = readFileSync(githubCssPath, 'utf-8')
    
    // 生成字体CSS
    const fontCss = this.generateFontCSS()
    
    // 将markdown转换为HTML并处理emoji
    const htmlContent = this.markdownToHtml(markdownContent)
    const htmlWithEmoji = this.convertEmojiToImages(htmlContent)
    
    // 创建HTML模板
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          ${fontCss}
          ${githubCss}
          
          body {
            background-color: #f6f8fa;
            font-family: 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
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
            font-family: 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
            line-height: 1.6;
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
          <div class="ai-summary-title"><img class="emoji" src="https://fastly.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/1f916.png" alt="🤖" loading="eager"> AI 总结</div>
          ${htmlWithEmoji}
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
        
        // 等待emoji图片加载完成
        this.logger.info('等待emoji图片加载完成...')
        
        await page.evaluate(() => {
          return new Promise((resolve) => {
            const emojiImages = document.querySelectorAll('img.emoji')
            let loadedCount = 0
            const totalImages = emojiImages.length
            
            if (totalImages === 0) {
              console.log('没有找到emoji图片')
              resolve(undefined)
              return
            }
            
            console.log(`找到${totalImages}个emoji图片，开始加载`)
            
            const checkAllLoaded = () => {
              loadedCount++
              console.log(`emoji图片加载进度: ${loadedCount}/${totalImages}`)
              
              if (loadedCount >= totalImages) {
                console.log('✅ 所有emoji图片加载完成')
                resolve(undefined)
              }
            }
            
            emojiImages.forEach((img) => {
              const image = img as HTMLImageElement
              if (image.complete) {
                checkAllLoaded()
              } else {
                image.onload = checkAllLoaded
                image.onerror = () => {
                  console.log(`⚠️ emoji图片加载失败: ${image.src}`)
                  checkAllLoaded()
                }
              }
            })
            
            // 设置超时，避免无限等待
            setTimeout(() => {
              if (loadedCount < totalImages) {
                console.log(`⏰ emoji图片加载超时，已加载${loadedCount}/${totalImages}`)
              }
              resolve(undefined)
            }, 5000)
          })
        })
        
        this.logger.info('emoji图片加载完成')
        
        // 额外等待确保渲染完成
        await new Promise(resolve => setTimeout(resolve, 300))
        
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
      
      const totalTime = Date.now() - startTime
      this.logger.info('Markdown转图片成功', {
        contentLength: markdownContent.length,
        imageSize: imageBuffer.length,
        renderTime: totalTime + 'ms'
      })
      
      return Buffer.from(imageBuffer, 'base64')
      
    } catch (error) {
      this.logger.error('Markdown转图片失败', error)
      throw error
    } finally {
      // 释放渲染槽位，允许其他渲染任务继续
      this.releaseRenderSlot()
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