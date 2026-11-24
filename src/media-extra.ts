/**
 * 合并转发里的媒体、语音、重试 —— 不依赖本仓库其它模块的纯逻辑，便于单独测试。
 *
 * 背景：合并转发的内容（节点 → 片段）是 NapCat 在消息事件里直接带过来的，
 * 片段是 OneBot 原始格式 `{ type, data }`，嵌套的转发在 `data.content` 里。
 * 以前只转存顶层元素里的图片 / 视频 / 文件，节点里的媒体只留了腾讯的临时地址。
 */

export type NestedKind = 'image' | 'video'

export interface NestedMediaRef {
  kind: NestedKind
  /** 指向片段的 data 对象本身：转存成功后往它上面写 s3Key */
  data: Record<string, any>
  url: string
  /** 片段里的 file 字段，通常是「32 位 hex.扩展名」 */
  file: string
  md5: string | null
  ext: string | null
  /** 片段自报的大小，没有就是 0 */
  size: number
  /** 所属顶层转发元素的 id */
  forwardId: string
  /** 在转发里的位置：「节点序号.片段序号」，嵌套用 / 接，如 3.0/1.2 */
  path: string
}

export interface AudioRef {
  /** 指向顶层 audio 元素的 attrs 对象本身 */
  attrs: Record<string, any>
  url: string
  file: string
  /** 第几个语音元素（一条消息几乎总是只有一个） */
  index: number
}

export const isHttpUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)

/** 从「32 位 hex[.扩展名]」里取 md5 和扩展名；不是这种形状就都返回 null */
export function parseMediaName(file: unknown): { md5: string | null; ext: string | null } {
  if (typeof file !== 'string') return { md5: null, ext: null }
  const m = /^([0-9a-fA-F]{32})(?:\.([A-Za-z0-9]{1,5}))?$/.exec(file.trim())
  if (!m) return { md5: null, ext: null }
  return { md5: m[1].toLowerCase(), ext: m[2] ? m[2].toLowerCase() : null }
}

/** 转发里的媒体按内容寻址存放：同一张图被转来转去只存一份 */
export function forwardMediaKey(md5: string, ext: string): string {
  const clean = md5.toLowerCase()
  return `forward-media/${clean.slice(0, 2)}/${clean}.${ext.toLowerCase()}`
}

/** 按文件头猜扩展名；认不出返回 bin */
export function sniffExt(buf: Uint8Array): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.slice(from, to))
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.length >= 4 && ascii(0, 4) === '\x89PNG') return 'png'
  if (buf.length >= 4 && ascii(0, 4) === 'GIF8') return 'gif'
  if (buf.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 2 && ascii(0, 2) === 'BM') return 'bmp'
  if (buf.length >= 12 && ascii(4, 8) === 'ftyp') return 'mp4'
  return 'bin'
}

/** 语音文件头：QQ 的语音是 SILK（前面可能多一个字节），少数是 AMR */
export function sniffAudioExt(buf: Uint8Array): 'silk' | 'amr' | null {
  const head = String.fromCharCode(...buf.slice(0, 12))
  if (head.includes('#!SILK')) return 'silk'
  if (head.startsWith('#!AMR')) return 'amr'
  return null
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  silk: 'audio/silk', amr: 'audio/amr', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
}
export const contentTypeForExt = (ext: string): string => CONTENT_TYPES[ext.toLowerCase()] || 'application/octet-stream'

function nodeSegments(node: any): any[] {
  const m = node?.message ?? node?.content
  return Array.isArray(m) ? m : []
}

function walkForward(content: unknown, forwardId: string, prefix: string, depth: number, maxDepth: number, out: NestedMediaRef[]): void {
  if (!Array.isArray(content) || depth > maxDepth) return
  content.forEach((node, i) => {
    nodeSegments(node).forEach((seg, j) => {
      if (!seg || typeof seg !== 'object') return
      const data = seg.data
      if (!data || typeof data !== 'object') return
      const path = `${prefix}${i}.${j}`
      if (seg.type === 'image' || seg.type === 'video') {
        const file = typeof data.file === 'string' ? data.file : ''
        const { md5, ext } = parseMediaName(file)
        out.push({
          kind: seg.type,
          data,
          url: typeof data.url === 'string' ? data.url : '',
          file,
          md5,
          ext,
          size: Number(data.file_size) || 0,
          forwardId,
          path,
        })
      } else if (seg.type === 'forward') {
        walkForward(data.content, forwardId, `${path}/`, depth + 1, maxDepth, out)
      }
    })
  })
}

/**
 * 收集顶层元素里所有合并转发内的图片、视频（含嵌套转发）。
 * 传进来的是 Koishi 元素序列化后的数组（`{ type, attrs, children }`）。
 * 已经带 s3Key 的片段也会返回，由调用方决定跳不跳。
 */
export function collectForwardMedia(elements: unknown, maxDepth: number = 8): NestedMediaRef[] {
  const out: NestedMediaRef[] = []
  if (!Array.isArray(elements)) return out
  for (const el of elements) {
    if (!el || el.type !== 'forward' || !el.attrs || typeof el.attrs !== 'object') continue
    walkForward(el.attrs.content, String(el.attrs.id ?? ''), '', 1, maxDepth, out)
  }
  return out
}

/** 收集顶层的语音元素 */
export function collectTopLevelAudio(elements: unknown): AudioRef[] {
  const out: AudioRef[] = []
  if (!Array.isArray(elements)) return out
  for (const el of elements) {
    if (!el || el.type !== 'audio' || !el.attrs || typeof el.attrs !== 'object') continue
    const a = el.attrs
    out.push({
      attrs: a,
      url: typeof a.src === 'string' ? a.src : (typeof a.url === 'string' ? a.url : ''),
      file: typeof a.file === 'string' ? a.file : '',
      index: out.length,
    })
  }
  return out
}

/** 从 OneBot 原始事件的片段里取被回复消息的 id */
export function extractReplyId(rawSegments: unknown): string | undefined {
  if (!Array.isArray(rawSegments)) return undefined
  for (const seg of rawSegments) {
    if (seg && seg.type === 'reply' && seg.data && seg.data.id != null && String(seg.data.id) !== '') {
      return String(seg.data.id)
    }
  }
  return undefined
}

/**
 * 失败分三类：
 * - permanent：文件超过大小上限。再试多少次都一样，直接放弃。
 * - gone：源头说没有或地址失效（404、400、403、410、地址不合法、没有地址）。同一个地址再试没用，除非能换到新地址。
 * - transient：桶报错、超时、网络抖动。隔一会儿再试多半就好。
 */
export function classifyFailure(message: string | undefined): 'permanent' | 'gone' | 'transient' {
  const m = (message || '').toLowerCase()
  if (m.includes('过大') || m.includes('maxcontentlength')) {
    return 'permanent'
  }
  if (
    /(^|\D)(403|404|410)(\D|$)/.test(m) || m.includes('资源不存在') || m.includes('invalid url') || m.includes('expired') ||
    m.includes('没有可下载的地址') || m.includes('http 400')
  ) {
    return 'gone'
  }
  return 'transient'
}

export interface AttemptResult {
  ok: boolean
  key?: string
  url?: string
  size?: number
  error?: string
}

export interface RetryOptions {
  /** 用给定地址试一次 */
  attempt: (url: string) => Promise<AttemptResult>
  /** 向机器人要一个新签名的地址；要不到返回 null。可不提供 */
  refresh?: () => Promise<string | null>
  /** 每次重试前等多久（毫秒）；数组长度就是最多重试几次 */
  delays: number[]
  sleep: (ms: number) => Promise<void>
  /** 调用方已经试过一次并失败了：给出那次的原因，这里就不再做「先试一次」，直接进入重试 */
  previousError?: string
}

export interface RetryOutcome extends AttemptResult {
  attempts: number
  /** 最后一次用的地址 */
  finalUrl: string
}

export interface RetryStepResult extends AttemptResult {
  /** 这一步之后该用的下载地址（换到了新地址就是新的）。注意不是 AttemptResult.url（那是存进桶后的地址） */
  sourceUrl: string
  /** 这一步有没有真的去试（放弃时没有） */
  attempted: boolean
  /** 不用再试了：注定失败，或者源头没有了又换不到新地址 */
  giveUp: boolean
}

/**
 * 做一次重试，不含等待。round 是第几次重试（从 0 起）。
 * - permanent：不试，直接放弃。
 * - transient：第 1 次重试用原地址，从第 2 次重试起先尝试换新地址（腾讯的地址寿命不到一天，隔久了会失效）。
 * - gone：先尝试换新地址；换不到（或没给 refresh）就放弃，同一个地址再试没用。
 */
export async function retryStep(
  url: string,
  lastError: string | undefined,
  round: number,
  opts: Pick<RetryOptions, 'attempt' | 'refresh'>
): Promise<RetryStepResult> {
  const kind = classifyFailure(lastError)
  if (kind === 'permanent') {
    return { ok: false, error: lastError, sourceUrl: url, attempted: false, giveUp: true }
  }
  let refreshed = false
  if ((kind === 'gone' || round >= 1) && opts.refresh) {
    try {
      const fresh = await opts.refresh()
      if (isHttpUrl(fresh) && fresh !== url) {
        url = fresh
        refreshed = true
      }
    } catch {
      // 换不到新地址不算错，继续用旧的
    }
  }
  if (kind === 'gone' && !refreshed) {
    return { ok: false, error: lastError, sourceUrl: url, attempted: false, giveUp: true }
  }
  let result: AttemptResult
  try {
    result = isHttpUrl(url) ? await opts.attempt(url) : { ok: false, error: '没有可下载的地址' }
  } catch (error: any) {
    result = { ok: false, error: error?.message || String(error) }
  }
  return { ...result, sourceUrl: url, attempted: true, giveUp: false }
}

/**
 * 先试一次；失败按 delays 逐次等待再重试（每次重试的规则见 retryStep）。
 * 等待是每个任务自己睡，只适合单个任务；一批任务要重试时应当「整批睡一次、再各试一次」，见调用方。
 */
export async function uploadWithRetry(initialUrl: string, opts: RetryOptions): Promise<RetryOutcome> {
  let url = initialUrl
  let attempts = 0
  let last: AttemptResult = { ok: false, error: '没有可下载的地址' }

  if (opts.previousError !== undefined) {
    last = { ok: false, error: opts.previousError }
  } else {
    attempts++
    try {
      last = isHttpUrl(url) ? await opts.attempt(url) : { ok: false, error: '没有可下载的地址' }
    } catch (error: any) {
      last = { ok: false, error: error?.message || String(error) }
    }
    if (last.ok) {
      return { ...last, attempts, finalUrl: url }
    }
  }

  for (let i = 0; i < opts.delays.length; i++) {
    if (classifyFailure(last.error) === 'permanent') break
    await opts.sleep(opts.delays[i])
    const step = await retryStep(url, last.error, i, opts)
    url = step.sourceUrl
    if (step.attempted) {
      attempts++
      last = { ok: step.ok, key: step.key, url: step.url, size: step.size, error: step.error }
    }
    if (step.ok || step.giveUp) break
  }

  return { ...last, attempts, finalUrl: url }
}

/**
 * 全局并发闸门：同一时刻最多放 limit 个任务进去，其余排队。
 * 和 runPool 的区别：runPool 管「这一批」，这个管「所有批加起来」。
 */
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const queue: Array<() => void> = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) {
      // 排队；被叫到时名额是前一个任务直接让出来的，不用再加
      await new Promise<void>(resolve => queue.push(resolve))
    } else {
      active++
    }
    try {
      return await task()
    } finally {
      const next = queue.shift()
      if (next) next()
      else active--
    }
  }
}

/** 限并发地跑一批任务；单个任务抛错不影响其它 */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await worker(item)
      } catch {
        // worker 自己负责记失败
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run))
}

/**
 * 在重取回来的转发内容里，按「位置 + 文件名」找同一个片段的新地址。
 * 位置对不上（比如机器人返回的节点数变了）时退一步按文件名找（仅限文件名是 md5 的）。
 */
export function findRefreshedUrl(fresh: NestedMediaRef[], target: Pick<NestedMediaRef, 'kind' | 'path' | 'file'>): string | null {
  const exact = fresh.find(r => r.kind === target.kind && r.path === target.path && (!target.file || r.file === target.file))
  if (exact && isHttpUrl(exact.url)) return exact.url
  // 只有文件名是 md5（内容相同名字才相同）时才敢按名字找；video.mp4 这种重名的可能是别的文件
  if (target.file && parseMediaName(target.file).md5) {
    const byName = fresh.find(r => r.kind === target.kind && r.file === target.file)
    if (byName && isHttpUrl(byName.url)) return byName.url
  }
  return null
}

function fileIdOf(url: string): string | null {
  try {
    return new URL(url).searchParams.get('fileid')
  } catch {
    return null
  }
}

/**
 * 在重取回来的顶层消息片段（OneBot 原始格式）里找同一个文件的新地址。
 * 宁可找不到也不能配错：
 * - 原地址带 fileid（腾讯新接口的图片、语音）：只认 fileid 相同的那个。
 * - 不带 fileid（视频等）：只有同类片段的个数和当初一致时才按序号取。
 */
export function pickRefreshedTopLevelUrl(rawSegments: unknown, rawType: string, index: number, expectedCount: number, originalUrl: string): string | null {
  if (!Array.isArray(rawSegments)) return null
  const urls = rawSegments
    .filter(seg => seg && seg.type === rawType && seg.data && typeof seg.data === 'object')
    .map(seg => (typeof seg.data.url === 'string' ? seg.data.url : ''))
  const wanted = fileIdOf(originalUrl)
  if (wanted) {
    const hit = urls.find(u => isHttpUrl(u) && fileIdOf(u) === wanted)
    return hit || null
  }
  if (urls.length !== expectedCount) return null
  const byIndex = urls[index]
  return isHttpUrl(byIndex) ? byIndex : null
}
