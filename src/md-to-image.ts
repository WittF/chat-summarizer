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
    // 使用本地emoji图片
    const emojiBaseUrl = 'file://' + join(process.cwd(), 'node_modules', 'koishi-plugin-chat-summarizer', 'lib', 'assets', 'emojis') + '/'
    
    // 常见emoji映射表
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
      '☠️': '2620-fe0f',
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
      '❄️': '2744-fe0f',
      '⭐': '2b50',
      '🌟': '1f31f',
      '✨': '2728',
      '🌈': '1f308',
      '☀️': '2600-fe0f',
      '🌤️': '1f324-fe0f',
      '⛅': '26c5',
      '🌥️': '1f325-fe0f',
      '☁️': '2601-fe0f',
      '🌦️': '1f326-fe0f',
      '🌧️': '1f327-fe0f',
      '⛈️': '26c8-fe0f',
      '🌩️': '1f329-fe0f',
      '🌨️': '1f328-fe0f',
      '❤️': '2764-fe0f',
      '🧡': '1f9e1',
      '💛': '1f49b',
      '💚': '1f49a',
      '💙': '1f499',
      '💜': '1f49c',
      '🤍': '1f90d',
      '🖤': '1f5a4',
      '🤎': '1f90e',
      '💔': '1f494',
      '❣️': '2763-fe0f',
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
      '🕹️': '1f579-fe0f',
      '🎰': '1f3b0',
      '🎲': '1f3b2',
      '🧩': '1f9e9',
      '🧸': '1f9f8',
      '🎭': '1f3ad',
      '🎨': '1f3a8',
      '👓': '1f453',
      '🕶️': '1f576-fe0f',
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
      '🛍️': '1f6cd-fe0f',
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
      '💎': '1f48e',
      '🔇': '1f507',
      '🔈': '1f508',
      '🔉': '1f509',
      '🔊': '1f50a',
      '📢': '1f4e2',
      '📣': '1f4e3',
      '📯': '1f4ef',
      '🔔': '1f514',
      '🔕': '1f515',
      '🎼': '1f3bc',
      '🎵': '1f3b5',
      '🎶': '1f3b6',
      '🎤': '1f3a4',
      '🎧': '1f3a7',
      '📻': '1f4fb',
      '🎷': '1f3b7',
      '🎸': '1f3b8',
      '🎹': '1f3b9',
      '🎺': '1f3ba',
      '🎻': '1f3bb',
      '🥁': '1f941',
      '📱': '1f4f1',
      '📲': '1f4f2',
      '☎️': '260e-fe0f',
      '📞': '1f4de',
      '📟': '1f4df',
      '📠': '1f4e0',
      '🔋': '1f50b',
      '🔌': '1f50c',
      '💻': '1f4bb',
      '🖥️': '1f5a5-fe0f',
      '🖨️': '1f5a8-fe0f',
      '⌨️': '2328-fe0f',
      '🖱️': '1f5b1-fe0f',
      '💽': '1f4bd',
      '💾': '1f4be',
      '💿': '1f4bf',
      '📀': '1f4c0',
      '🧮': '1f9ee',
      '🎥': '1f3a5',
      '📽️': '1f4fd-fe0f',
      '🎬': '1f3ac',
      '📺': '1f4fa',
      '📷': '1f4f7',
      '📸': '1f4f8',
      '📹': '1f4f9',
      '📼': '1f4fc',
      '🔍': '1f50d',
      '🔎': '1f50e',
      '🕯️': '1f56f-fe0f',
      '💡': '1f4a1',
      '🔦': '1f526',
      '🏮': '1f3ee',
      '📔': '1f4d4',
      '📕': '1f4d5',
      '📖': '1f4d6',
      '📗': '1f4d7',
      '📘': '1f4d8',
      '📙': '1f4d9',
      '📚': '1f4da',
      '📓': '1f4d3',
      '📒': '1f4d2',
      '📃': '1f4c3',
      '📜': '1f4dc',
      '📄': '1f4c4',
      '📰': '1f4f0',
      '🗞️': '1f5de-fe0f',
      '📑': '1f4d1',
      '🔖': '1f516',
      '🏷️': '1f3f7-fe0f',
      '💰': '1f4b0',
      '💴': '1f4b4',
      '💵': '1f4b5',
      '💶': '1f4b6',
      '💷': '1f4b7',
      '💸': '1f4b8',
      '💳': '1f4b3',
      '💹': '1f4b9',
      '✉️': '2709-fe0f',
      '📧': '1f4e7',
      '📨': '1f4e8',
      '📩': '1f4e9',
      '📤': '1f4e4',
      '📥': '1f4e5',
      '📦': '1f4e6',
      '📫': '1f4eb',
      '📪': '1f4ea',
      '📬': '1f4ec',
      '📭': '1f4ed',
      '📮': '1f4ee',
      '✏️': '270f-fe0f',
      '✒️': '2712-fe0f',
      '🖋️': '1f58b-fe0f',
      '🖊️': '1f58a-fe0f',
      '🖌️': '1f58c-fe0f',
      '🖍️': '1f58d-fe0f',
      '📝': '1f4dd',
      '💼': '1f4bc',
      '📁': '1f4c1',
      '📂': '1f4c2',
      '📅': '1f4c5',
      '📆': '1f4c6',
      '📇': '1f4c7',
      '📈': '1f4c8',
      '📉': '1f4c9',
      '📊': '1f4ca',
      '📋': '1f4cb',
      '📌': '1f4cc',
      '📍': '1f4cd',
      '📎': '1f4ce',
      '📏': '1f4cf',
      '📐': '1f4d0',
      '✂️': '2702-fe0f',
      '🔒': '1f512',
      '🔓': '1f513',
      '🔏': '1f50f',
      '🔐': '1f510',
      '🔑': '1f511',
      '🔨': '1f528',
      '⛏️': '26cf-fe0f',
      '⚒️': '2692-fe0f',
      '🛠️': '1f6e0-fe0f',
      '⚔️': '2694-fe0f',
      '🏹': '1f3f9',
      '🛡️': '1f6e1-fe0f',
      '🔧': '1f527',
      '🔩': '1f529',
      '⚙️': '2699-fe0f',
      '⚖️': '2696-fe0f',
      '🦯': '1f9af',
      '🔗': '1f517',
      '⛓️': '26d3-fe0f',
      '🧰': '1f9f0',
      '🧲': '1f9f2',
      '⚗️': '2697-fe0f',
      '🧪': '1f9ea',
      '🧫': '1f9eb',
      '🧬': '1f9ec',
      '🔬': '1f52c',
      '🔭': '1f52d',
      '📡': '1f4e1',
      '💉': '1f489',
      '🩸': '1fa78',
      '💊': '1f48a',
      '🩹': '1fa79',
      '🩺': '1fa7a',
      '🚪': '1f6aa',
      '🛏️': '1f6cf-fe0f',
      '🛋️': '1f6cb-fe0f',
      '🚽': '1f6bd',
      '🚿': '1f6bf',
      '🛁': '1f6c1',
      '🧴': '1f9f4',
      '🧷': '1f9f7',
      '🧹': '1f9f9',
      '🧺': '1f9fa',
      '🧻': '1f9fb',
      '🧼': '1f9fc',
      '🧽': '1f9fd',
      '🧯': '1f9ef',
      '🛒': '1f6d2',
      '🚬': '1f6ac',
      '⚰️': '26b0-fe0f',
      '⚱️': '26b1-fe0f',
      '🗿': '1f5ff',
      '🏧': '1f3e7',
      '🚮': '1f6ae',
      '🚰': '1f6b0',
      '♿': '267f',
      '🚹': '1f6b9',
      '🚺': '1f6ba',
      '🚻': '1f6bb',
      '🚼': '1f6bc',
      '🚾': '1f6be',
      '🛂': '1f6c2',
      '🛃': '1f6c3',
      '🛄': '1f6c4',
      '🛅': '1f6c5',
      '⚠️': '26a0-fe0f',
      '🚸': '1f6b8',
      '⛔': '26d4',
      '🚫': '1f6ab',
      '🚳': '1f6b3',
      '🚭': '1f6ad',
      '🚯': '1f6af',
      '🚱': '1f6b1',
      '🚷': '1f6b7',
      '📵': '1f4f5',
      '🔞': '1f51e',
      '☢️': '2622-fe0f',
      '☣️': '2623-fe0f',
      '⬆️': '2b06-fe0f',
      '↗️': '2197-fe0f',
      '➡️': '27a1-fe0f',
      '↘️': '2198-fe0f',
      '⬇️': '2b07-fe0f',
      '↙️': '2199-fe0f',
      '⬅️': '2b05-fe0f',
      '↖️': '2196-fe0f',
      '↕️': '2195-fe0f',
      '↔️': '2194-fe0f',
      '↩️': '21a9-fe0f',
      '↪️': '21aa-fe0f',
      '⤴️': '2934-fe0f',
      '⤵️': '2935-fe0f',
      '🔃': '1f503',
      '🔄': '1f504',
      '🔙': '1f519',
      '🔚': '1f51a',
      '🔛': '1f51b',
      '🔜': '1f51c',
      '🔝': '1f51d',
      '🔀': '1f500',
      '🔁': '1f501',
      '🔂': '1f502',
      '▶️': '25b6-fe0f',
      '⏩': '23e9',
      '⏭️': '23ed-fe0f',
      '⏯️': '23ef-fe0f',
      '◀️': '25c0-fe0f',
      '⏪': '23ea',
      '⏮️': '23ee-fe0f',
      '🔼': '1f53c',
      '⏫': '23eb',
      '🔽': '1f53d',
      '⏬': '23ec',
      '⏸️': '23f8-fe0f',
      '⏹️': '23f9-fe0f',
      '⏺️': '23fa-fe0f',
      '⏏️': '23cf-fe0f',
      '🎦': '1f3a6',
      '🔅': '1f505',
      '🔆': '1f506',
      '📶': '1f4f6',
      '📳': '1f4f3',
      '📴': '1f4f4',
      '✖️': '2716-fe0f',
      '➕': '2795',
      '➖': '2796',
      '➗': '2797',
      '♾️': '267e-fe0f',
      '‼️': '203c-fe0f',
      '⁉️': '2049-fe0f',
      '❓': '2753',
      '❔': '2754',
      '❕': '2755',
      '❗': '2757',
      '〰️': '3030-fe0f',
      '💱': '1f4b1',
      '💲': '1f4b2',
      '⚕️': '2695-fe0f',
      '♻️': '267b-fe0f',
      '⚜️': '269c-fe0f',
      '🔱': '1f531',
      '📛': '1f4db',
      '🔰': '1f530',
      '⭕': '2b55',
      '✅': '2705',
      '☑️': '2611-fe0f',
      '✔️': '2714-fe0f',
      '❌': '274c',
      '❎': '274e',
      '➰': '27b0',
      '➿': '27bf',
      '〽️': '303d-fe0f',
      '✳️': '2733-fe0f',
      '✴️': '2734-fe0f',
      '❇️': '2747-fe0f',
      '©️': '00a9-fe0f',
      '®️': '00ae-fe0f',
      '™️': '2122-fe0f',
      '🔟': '1f51f',
      '🔠': '1f520',
      '🔡': '1f521',
      '🔢': '1f522',
      '🔣': '1f523',
      '🔤': '1f524',
      '🅰️': '1f170-fe0f',
      '🆎': '1f18e',
      '🅱️': '1f171-fe0f',
      '🆑': '1f191',
      '🆒': '1f192',
      '🆓': '1f193',
      'ℹ️': '2139-fe0f',
      '🆔': '1f194',
      'Ⓜ️': '24c2-fe0f',
      '🆕': '1f195',
      '🆖': '1f196',
      '🅾️': '1f17e-fe0f',
      '🆗': '1f197',
      '🅿️': '1f17f-fe0f',
      '🆘': '1f198',
      '🆙': '1f199',
      '🆚': '1f19a',
      '🔴': '1f534',
      '🟠': '1f7e0',
      '🟡': '1f7e1',
      '🟢': '1f7e2',
      '🔵': '1f535',
      '🟣': '1f7e3',
      '🟤': '1f7e4',
      '⚫': '26ab',
      '⚪': '26aa',
      '🟥': '1f7e5',
      '🟧': '1f7e7',
      '🟨': '1f7e8',
      '🟩': '1f7e9',
      '🟦': '1f7ea',
      '🟪': '1f7eb',
      '🟫': '1f7ec',
      '⬛': '2b1b',
      '⬜': '2b1c',
      '◼️': '25fc-fe0f',
      '◻️': '25fb-fe0f',
      '◾': '25fe',
      '◽': '25fd',
      '▪️': '25aa-fe0f',
      '▫️': '25ab-fe0f',
      '🔶': '1f536',
      '🔷': '1f537',
      '🔸': '1f538',
      '🔹': '1f539',
      '🔺': '1f53a',
      '🔻': '1f53b',
      '💠': '1f4a0',
      '🔘': '1f518',
      '🔳': '1f533',
      '🔲': '1f532',
      '🏁': '1f3c1',
      '🚩': '1f6a9',
      '🎌': '1f38c',
      '🏴': '1f3f4',
      '🏳️': '1f3f3-fe0f',
      '🏳️‍🌈': '1f3f3-fe0f-200d-1f308',
      '🏳️‍⚧️': '1f3f3-fe0f-200d-26a7-fe0f'
    }
    
    // 过滤出本地存在的emoji文件
    const localEmojiPath = join(process.cwd(), 'node_modules', 'koishi-plugin-chat-summarizer', 'lib', 'assets', 'emojis')
    const altEmojiPath = join(__dirname, 'assets', 'emojis')
    const availableEmojis: { [key: string]: { unicode: string; useAltPath: boolean } } = {}
    let availableCount = 0
    
    for (const [emoji, unicode] of Object.entries(emojiMap)) {
      try {
        let emojiFilePath = join(localEmojiPath, `${unicode}.png`)
        let useAltPath = false
        
        // 检查主路径
        if (!require('fs').existsSync(emojiFilePath)) {
          // 检查备用路径
          emojiFilePath = join(altEmojiPath, `${unicode}.png`)
          if (require('fs').existsSync(emojiFilePath)) {
            useAltPath = true
          } else {
            continue // 两个路径都不存在，跳过这个emoji
          }
        }
        
        availableEmojis[emoji] = {
          unicode,
          useAltPath
        }
        availableCount++
      } catch (error) {
        // 忽略文件检查错误
      }
    }
    
    this.logger.info(`正在转换emoji到图片，本地可用${availableCount}个emoji（总计${Object.keys(emojiMap).length}个）`)
    
    // 替换emoji为图片标签
    let result = html
    for (const [emoji, emojiInfo] of Object.entries(availableEmojis)) {
      const { unicode, useAltPath } = emojiInfo
      const basePath = useAltPath ? 
        'file://' + join(__dirname, 'assets', 'emojis') + '/' :
        emojiBaseUrl
      const imgTag = `<img class="emoji" src="${basePath}${unicode}.png" alt="${emoji}" loading="eager">`
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