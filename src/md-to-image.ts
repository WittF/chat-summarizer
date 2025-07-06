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
   * 生成字体CSS和Google Fonts链接
   */
  private generateFontCSS(): { css: string; useGoogleFonts: boolean } {
    // 英文字体（小文件，优先加载）
    const interRegular = this.getFontBase64('Inter-Regular.woff2')
    const interBold = this.getFontBase64('Inter-Bold.woff2')
    
    // 尝试加载新的emoji字体文件
    let notoColorEmoji = this.getFontBase64('NotoColorEmoji-Regular.ttf')
    if (!notoColorEmoji) {
      // 如果新文件不存在，尝试旧文件
      notoColorEmoji = this.getFontBase64('NotoColorEmoji.ttf')
    }
    
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
    
    const useGoogleFonts = !fontStatus.notoColorEmoji
    
    if (useGoogleFonts) {
      this.logger.warn('❌ 本地NotoColorEmoji字体文件读取失败，将使用Google Fonts云端字体')
      this.logger.info('🌐 启用Google Fonts: Noto Color Emoji')
    } else {
      this.logger.info('✅ 本地NotoColorEmoji字体文件读取成功')
    }

    const css = `
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
      /* 本地Emoji字体 - 最高优先级 */
      @font-face {
        font-family: 'NotoColorEmoji';
        src: url(data:font/truetype;base64,${notoColorEmoji}) format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: block;
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
    
    return { css, useGoogleFonts }
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
    const fontConfig = this.generateFontCSS()
    
    // 创建HTML模板
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${fontConfig.useGoogleFonts ? `
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap" rel="stylesheet">
        ` : ''}
        <style>
          ${fontConfig.css}
          ${githubCss}
          
          /* Emoji优先字体策略 */
          body {
            background-color: #f6f8fa;
            font-family: 'NotoColorEmoji', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
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
            font-family: 'NotoColorEmoji', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
            line-height: 1.6;
          }
          
          /* 所有文本元素都使用emoji优先字体 */
          .markdown-body p, .markdown-body li, .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 {
            font-family: 'NotoColorEmoji', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
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
            font-family: 'NotoColorEmoji', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', sans-serif, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', 'Wenquanyi Micro Hei', 'WenQuanYi Zen Hei', 'ST Heiti', SimHei, 'WenQuanYi Zen Hei Sharp';
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
        
        // 动态加载字体并等待完成
        this.logger.info('开始动态加载字体...')
        
        await page.evaluate((useGoogleFonts) => {
          // 设置初始状态
          (window as any).puppeteerReadyState = 'loading';
          
          // 收集需要加载的字体
          const fontsToLoad = [];
          
          // 检查本地NotoColorEmoji字体
          const localEmojiFont = document.querySelector('style')?.textContent?.includes('NotoColorEmoji');
          if (localEmojiFont) {
            fontsToLoad.push({ name: 'NotoColorEmoji', isLocal: true });
          }
          
          // 如果使用Google Fonts
          if (useGoogleFonts) {
            fontsToLoad.push({ name: 'Noto Color Emoji', isLocal: false });
          }
          
          // 添加其他字体
          fontsToLoad.push({ name: 'Inter', isLocal: true });
          fontsToLoad.push({ name: 'NotoSansCJKsc', isLocal: true });
          
          console.log('准备加载字体:', fontsToLoad.map(f => f.name));
          
          // 字体加载完成计数器
          let loadedCount = 0;
          const totalFonts = fontsToLoad.length;
          
          const checkAllFontsLoaded = () => {
            loadedCount++;
            console.log(`字体加载进度: ${loadedCount}/${totalFonts}`);
            
            if (loadedCount >= totalFonts) {
              console.log('✅ 所有字体加载完成');
              (window as any).puppeteerReadyState = 'complete';
            }
          };
          
          // 为每个字体设置加载检查
          fontsToLoad.forEach((fontInfo, index) => {
            setTimeout(() => {
              // 检查字体是否可用
              const isAvailable = document.fonts.check(`16px "${fontInfo.name}"`);
              
              if (isAvailable) {
                console.log(`✅ 字体 ${fontInfo.name} 已可用`);
                checkAllFontsLoaded();
              } else {
                console.log(`⏳ 等待字体 ${fontInfo.name} 加载...`);
                
                // 使用字体加载事件监听
                document.fonts.ready.then(() => {
                  const isNowAvailable = document.fonts.check(`16px "${fontInfo.name}"`);
                  if (isNowAvailable) {
                    console.log(`✅ 字体 ${fontInfo.name} 延迟加载成功`);
                  } else {
                    console.log(`⚠️ 字体 ${fontInfo.name} 仍未可用，使用fallback`);
                  }
                  checkAllFontsLoaded();
                });
              }
            }, index * 100); // 错开检查时间避免同时检查
          });
          
          // 设置最大等待时间（5秒超时）
          setTimeout(() => {
            if ((window as any).puppeteerReadyState !== 'complete') {
              console.log('⏰ 字体加载超时，强制继续');
              (window as any).puppeteerReadyState = 'complete';
            }
          }, 5000);
          
        }, fontConfig.useGoogleFonts);
        
        // 等待字体加载完成的标志位
        this.logger.info('等待字体加载完成...')
        await page.waitForFunction(() => (window as any).puppeteerReadyState === 'complete', {
          timeout: 6000
        }).catch(() => {
          this.logger.warn('等待字体加载超时，继续执行')
        });
        
        this.logger.info('字体加载完成，开始最终字体设置')
        
        // 最终字体设置 - 确保优先级
        await page.addStyleTag({
          content: `
            /* 最终强制Emoji字体优先 */
            * {
              font-family: 'NotoColorEmoji', 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', 'Inter', 'NotoSansCJKsc', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
            }
            
            /* 确保emoji优先使用emoji字体 */
            body, .markdown-body, .markdown-body * {
              font-variant-emoji: emoji !important;
            }
          `
        })
        
        // 额外等待确保渲染完成
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // 测试emoji渲染情况 - 在实际渲染上下文中测试
        try {
          const emojiTest = await page.evaluate(() => {
            // 在markdown-body中直接测试emoji渲染
            const markdownBody = document.querySelector('.markdown-body')
            if (!markdownBody) return []
            
            // 测试多个emoji字符的渲染
            const testEmojis = [
              { char: '🤖', name: 'robot' },
              { char: '😀', name: 'face' },
              { char: '🎉', name: 'party' },
              { char: '$', name: 'dollar' },
              { char: '€', name: 'euro' },
              { char: '→', name: 'arrow' },
              { char: '±', name: 'plus-minus' }
            ]
            
            const results = []
            
            testEmojis.forEach(emoji => {
              const testDiv = document.createElement('div')
              testDiv.innerHTML = emoji.char
              testDiv.style.fontSize = '16px'
              testDiv.style.display = 'inline-block'
              testDiv.style.visibility = 'hidden'
              testDiv.style.position = 'absolute'
              testDiv.style.top = '0'
              testDiv.style.left = '0'
              markdownBody.appendChild(testDiv)
              
              const style = window.getComputedStyle(testDiv)
              const result = {
                name: emoji.name,
                char: emoji.char,
                fontFamily: style.fontFamily,
                width: testDiv.offsetWidth,
                height: testDiv.offsetHeight,
                isVisible: testDiv.offsetWidth > 0 && testDiv.offsetHeight > 0,
                actualFont: style.fontFamily.split(',')[0].trim().replace(/['"]/g, '')
              }
              
              results.push(result)
              markdownBody.removeChild(testDiv)
            })
            
            return results
          })
          
          this.logger.info('实际渲染上下文Emoji测试结果:', emojiTest)
          
          const successCount = emojiTest.filter(test => test.isVisible && test.width > 0).length
          const totalCount = emojiTest.length
          
          if (successCount === totalCount) {
            this.logger.info(`✅ 所有Emoji渲染正常 (${successCount}/${totalCount})`)
          } else {
            this.logger.warn(`⚠️ 部分Emoji渲染异常 (${successCount}/${totalCount})`)
            const failedEmojis = emojiTest.filter(test => !test.isVisible || test.width === 0)
            this.logger.warn('失败的Emoji:', failedEmojis.map(e => `${e.char}(${e.name})`).join(', '))
          }
          
          // 检查实际使用的字体
          const fontUsage = {}
          emojiTest.forEach(test => {
            if (fontUsage[test.actualFont]) {
              fontUsage[test.actualFont]++
            } else {
              fontUsage[test.actualFont] = 1
            }
          })
          this.logger.info('实际使用的字体分布:', fontUsage)
          
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