import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFailure,
  collectForwardMedia,
  collectTopLevelAudio,
  createLimiter,
  extractReplyId,
  findRefreshedUrl,
  forwardMediaKey,
  parseMediaName,
  pickRefreshedTopLevelUrl,
  retryStep,
  runPool,
  sniffAudioExt,
  sniffExt,
  uploadWithRetry,
} from '../src/media-extra.ts'

const MD5_A = 'A'.repeat(32)
const MD5_B = 'b'.repeat(32)
const T = 'https://multimedia.nt.qq.com.cn/download?appid=1&fileid=x&rkey=y'

// 样本是编出来的，形状照线上记录：顶层 forward 元素的 attrs 里带 id 和 content（节点数组），
// 节点的 message 是 OneBot 原始片段，嵌套转发在 data.content 里。
function sampleElements() {
  return [
    { type: 'text', attrs: { content: 'x' }, children: [] },
    {
      type: 'forward',
      attrs: {
        id: '7000000000000000001',
        content: [
          { sender: { user_id: 1 }, message: [{ type: 'text', data: { text: 'a' } }, { type: 'image', data: { file: `${MD5_A}.png`, file_size: '123', url: T } }] },
          {
            message: [
              {
                type: 'forward',
                data: {
                  id: '7000000000000000002',
                  content: [
                    { message: [{ type: 'video', data: { file: `${MD5_B}.mp4`, url: '/app/.config/QQ/nt_qq_x/nt_data/Video/2026-11/Ori/v.mp4' } }] },
                    { message: [{ type: 'image', data: { file: '{uuid}.jpg', url: T } }, { type: 'file', data: { file: 'a.zip', file_id: 'z' } }] },
                  ],
                },
              },
            ],
          },
          { message: 'not-an-array' },
        ],
      },
      children: [],
    },
    { type: 'forward', attrs: { id: '7000000000000000003' }, children: [] },
    { type: 'audio', attrs: { file: `${MD5_B}.amr`, fileSize: '900', path: '/app/x.amr', src: T }, children: [] },
  ]
}

test('collectForwardMedia：顶层和嵌套的图片视频都收，位置和文件名对得上', () => {
  const refs = collectForwardMedia(sampleElements())
  assert.deepEqual(refs.map(r => [r.kind, r.path, r.forwardId]), [
    ['image', '0.1', '7000000000000000001'],
    ['video', '1.0/0.0', '7000000000000000001'],
    ['image', '1.0/1.0', '7000000000000000001'],
  ])
  assert.equal(refs[0].md5, MD5_A.toLowerCase())
  assert.equal(refs[0].ext, 'png')
  assert.equal(refs[0].size, 123)
  assert.equal(refs[2].md5, null)
})

test('collectForwardMedia：返回的 data 就是原对象，写 s3Key 能落回元素里', () => {
  const els = sampleElements()
  const refs = collectForwardMedia(els)
  refs[0].data.s3Key = 'forward-media/aa/x.png'
  assert.equal((els[1] as any).attrs.content[0].message[1].data.s3Key, 'forward-media/aa/x.png')
  // 原来的地址和文件名不动
  assert.equal((els[1] as any).attrs.content[0].message[1].data.url, T)
})

test('collectForwardMedia：没内容的转发、怪输入都不报错', () => {
  assert.deepEqual(collectForwardMedia(null), [])
  assert.deepEqual(collectForwardMedia([{ type: 'forward', attrs: { id: '1' } }]), [])
  assert.deepEqual(collectForwardMedia([{ type: 'forward', attrs: { id: '1', content: [null, 1, { message: [null, { type: 'image' }] }] } }]), [])
})

test('collectForwardMedia：超过最大深度就不再往下走', () => {
  let content: any[] = [{ message: [{ type: 'image', data: { file: `${MD5_A}.png`, url: T } }] }]
  for (let i = 0; i < 5; i++) content = [{ message: [{ type: 'forward', data: { id: String(i), content } }] }]
  assert.equal(collectForwardMedia([{ type: 'forward', attrs: { id: 'top', content } }], 8).length, 1)
  assert.equal(collectForwardMedia([{ type: 'forward', attrs: { id: 'top', content } }], 3).length, 0)
})

test('collectTopLevelAudio：只收顶层语音', () => {
  const a = collectTopLevelAudio(sampleElements())
  assert.equal(a.length, 1)
  assert.equal(a[0].url, T)
  assert.equal(a[0].file, `${MD5_B}.amr`)
})

test('parseMediaName / forwardMediaKey', () => {
  assert.deepEqual(parseMediaName(`${MD5_A}.PNG`), { md5: MD5_A.toLowerCase(), ext: 'png' })
  assert.deepEqual(parseMediaName(MD5_A), { md5: MD5_A.toLowerCase(), ext: null })
  assert.deepEqual(parseMediaName('{abc}.jpg'), { md5: null, ext: null })
  assert.deepEqual(parseMediaName(undefined), { md5: null, ext: null })
  assert.equal(forwardMediaKey(MD5_A, 'PNG'), `forward-media/aa/${MD5_A.toLowerCase()}.png`)
})

test('sniffExt / sniffAudioExt', () => {
  assert.equal(sniffExt(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg')
  assert.equal(sniffExt(new TextEncoder().encode('GIF89a')), 'gif')
  assert.equal(sniffExt(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4])), 'mp4')
  assert.equal(sniffExt(Uint8Array.from([1, 2, 3])), 'bin')
  assert.equal(sniffAudioExt(Uint8Array.from([2, ...new TextEncoder().encode('#!SILK_V3')])), 'silk')
  assert.equal(sniffAudioExt(new TextEncoder().encode('#!AMR\n')), 'amr')
  assert.equal(sniffAudioExt(Uint8Array.from([1, 2, 3])), null)
})

test('extractReplyId', () => {
  assert.equal(extractReplyId([{ type: 'reply', data: { id: 12345 } }, { type: 'text', data: { text: 'x' } }]), '12345')
  assert.equal(extractReplyId([{ type: 'text', data: { text: 'x' } }]), undefined)
  assert.equal(extractReplyId('x'), undefined)
})

test('classifyFailure：源头没有算 gone，其余算 transient', () => {
  assert.equal(classifyFailure('资源不存在（404）'), 'gone')
  assert.equal(classifyFailure('Invalid URL'), 'gone')
  assert.equal(classifyFailure('download url has expired'), 'gone')
  assert.equal(classifyFailure('S3上传超时（90秒）'), 'transient')
  assert.equal(classifyFailure("Expected closing tag 'hr'"), 'transient')
  assert.equal(classifyFailure(undefined), 'transient')
})

const noSleep = async () => {}

test('uploadWithRetry：第一次成功就不重试', async () => {
  let n = 0
  const r = await uploadWithRetry(T, { attempt: async () => { n++; return { ok: true, key: 'k' } }, delays: [1, 1, 1], sleep: noSleep })
  assert.equal(n, 1)
  assert.deepEqual([r.ok, r.key, r.attempts], [true, 'k', 1])
})

test('uploadWithRetry：桶偶发报错，重试后成功', async () => {
  let n = 0
  const slept: number[] = []
  const r = await uploadWithRetry(T, {
    attempt: async () => (++n < 3 ? { ok: false, error: 'S3上传超时（90秒）' } : { ok: true, key: 'k' }),
    delays: [10, 20, 30],
    sleep: async (ms) => { slept.push(ms) },
  })
  assert.equal(r.ok, true)
  assert.equal(r.attempts, 3)
  assert.deepEqual(slept, [10, 20])
})

test('uploadWithRetry：一直失败，试满 1 + delays.length 次，带回最后的原因', async () => {
  let n = 0
  const r = await uploadWithRetry(T, { attempt: async () => { n++; return { ok: false, error: '网络连接中断' } }, delays: [1, 1, 1], sleep: noSleep })
  assert.equal(n, 4)
  assert.deepEqual([r.ok, r.attempts, r.error], [false, 4, '网络连接中断'])
})

test('uploadWithRetry：源头 404 且换不到新地址，就不再拿同一个地址重试', async () => {
  let n = 0
  const r1 = await uploadWithRetry(T, { attempt: async () => { n++; return { ok: false, error: '资源不存在（404）' } }, delays: [1, 1, 1], sleep: noSleep })
  assert.equal(n, 1)
  assert.equal(r1.ok, false)
  n = 0
  const r2 = await uploadWithRetry(T, { attempt: async () => { n++; return { ok: false, error: '资源不存在（404）' } }, refresh: async () => null, delays: [1, 1, 1], sleep: noSleep })
  assert.equal(n, 1)
  assert.equal(r2.attempts, 1)
})

test('uploadWithRetry：源头 404 但换到了新地址，用新地址再试', async () => {
  const seen: string[] = []
  const r = await uploadWithRetry(T, {
    attempt: async (u) => { seen.push(u); return u.endsWith('fresh') ? { ok: true, key: 'k' } : { ok: false, error: '资源不存在（404）' } },
    refresh: async () => 'https://multimedia.nt.qq.com.cn/fresh',
    delays: [1, 1, 1],
    sleep: noSleep,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(seen, [T, 'https://multimedia.nt.qq.com.cn/fresh'])
  assert.equal(r.finalUrl, 'https://multimedia.nt.qq.com.cn/fresh')
})

test('uploadWithRetry：偶发错误的第 1 次重试不换地址，第 2 次起才换；换地址抛错不影响重试', async () => {
  let refreshCalls = 0
  let n = 0
  const r = await uploadWithRetry(T, {
    attempt: async () => { n++; return { ok: false, error: 'timeout' } },
    refresh: async () => { refreshCalls++; throw new Error('bot offline') },
    delays: [1, 1, 1],
    sleep: noSleep,
  })
  assert.equal(n, 4)
  assert.equal(refreshCalls, 2)
  assert.equal(r.finalUrl, T)
})

test('uploadWithRetry：没有地址（本机路径）直接算失败，attempt 不会被调用', async () => {
  let n = 0
  const r = await uploadWithRetry('/app/.config/QQ/x.mp4', { attempt: async () => { n++; return { ok: true } }, delays: [1], sleep: noSleep })
  assert.equal(n, 0)
  assert.equal(r.ok, false)
  assert.equal(classifyFailure(r.error), 'gone')
})

test('uploadWithRetry：attempt 抛错当作失败处理', async () => {
  const r = await uploadWithRetry(T, { attempt: async () => { throw new Error('boom') }, delays: [], sleep: noSleep })
  assert.deepEqual([r.ok, r.error, r.attempts], [false, 'boom', 1])
})

test('runPool：不超过并发上限，单个抛错不影响其它', async () => {
  let running = 0
  let peak = 0
  const done: number[] = []
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    running++
    peak = Math.max(peak, running)
    await new Promise(r => setTimeout(r, 5))
    running--
    if (x === 4) throw new Error('x')
    done.push(x)
  })
  assert.equal(peak, 3)
  assert.deepEqual(done.sort(), [1, 2, 3, 5, 6, 7])
  await runPool([], 3, async () => { throw new Error('never') })
})

test('findRefreshedUrl：先按位置加文件名，再退到只按文件名', () => {
  const fresh = collectForwardMedia([{ type: 'forward', attrs: { id: '1', content: [
    { message: [{ type: 'image', data: { file: `${MD5_A}.png`, url: 'https://multimedia.nt.qq.com.cn/new-a' } }] },
    { message: [{ type: 'image', data: { file: `${MD5_B}.png`, url: 'https://multimedia.nt.qq.com.cn/new-b' } }] },
  ] } }])
  assert.equal(findRefreshedUrl(fresh, { kind: 'image', path: '1.0', file: `${MD5_B}.png` }), 'https://multimedia.nt.qq.com.cn/new-b')
  assert.equal(findRefreshedUrl(fresh, { kind: 'image', path: '9.9', file: `${MD5_A}.png` }), 'https://multimedia.nt.qq.com.cn/new-a')
  assert.equal(findRefreshedUrl(fresh, { kind: 'image', path: '1.0', file: 'other.png' }), null)
  assert.equal(findRefreshedUrl(fresh, { kind: 'video', path: '0.0', file: `${MD5_A}.png` }), null)
})

test('uploadWithRetry：调用方已经试过一次（previousError），不再先试、直接进入重试', async () => {
  let n = 0
  const slept: number[] = []
  const r = await uploadWithRetry(T, {
    attempt: async () => { n++; return n === 2 ? { ok: true, key: 'k' } : { ok: false, error: 'timeout' } },
    delays: [10, 20, 30],
    sleep: async (ms) => { slept.push(ms) },
    previousError: 'S3上传超时（90秒）',
  })
  assert.deepEqual([r.ok, r.attempts], [true, 2])
  assert.deepEqual(slept, [10, 20])

  // 上一次是源头 404、又换不到新地址：一次都不再试
  n = 0
  const gone = await uploadWithRetry(T, { attempt: async () => { n++; return { ok: true } }, delays: [1, 1], sleep: noSleep, previousError: '资源不存在（404）' })
  assert.deepEqual([gone.ok, gone.attempts, n, gone.error], [false, 0, 0, '资源不存在（404）'])
})

test('classifyFailure：腾讯回 400（地址过期）和 403 也算要换地址', () => {
  assert.equal(classifyFailure('请求失败（HTTP 400）'), 'gone')
  assert.equal(classifyFailure('访问被拒绝（403）'), 'gone')
  assert.equal(classifyFailure('请求失败（HTTP 502）'), 'transient')
})

test('pickRefreshedTopLevelUrl：带 fileid 的只认同一个 fileid，绝不按序号乱配', () => {
  const old = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=AAA&rkey=old'
  const segs = [
    { type: 'text', data: { text: 'x' } },
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=BBB&rkey=new' } },
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=AAA&rkey=new' } },
  ]
  assert.equal(pickRefreshedTopLevelUrl(segs, 'image', 0, 2, old), segs[2].data!.url)
  // 重取回来的里面没有这个 fileid：宁可不要
  assert.equal(pickRefreshedTopLevelUrl(segs.slice(0, 2), 'image', 0, 1, old), null)
  assert.equal(pickRefreshedTopLevelUrl(null, 'image', 0, 1, old), null)
})

test('pickRefreshedTopLevelUrl：不带 fileid 的（视频）只有个数对得上才按序号取', () => {
  const old = 'https://multimedia.nt.qq.com.cn/download?appid=1415&format=origin&rkey=old'
  const segs = [
    { type: 'video', data: { url: 'https://multimedia.nt.qq.com.cn/download?appid=1415&rkey=n1' } },
    { type: 'video', data: { url: '/app/.config/QQ/local.mp4' } },
  ]
  assert.equal(pickRefreshedTopLevelUrl(segs, 'video', 0, 2, old), segs[0].data.url)
  assert.equal(pickRefreshedTopLevelUrl(segs, 'video', 1, 2, old), null) // 本机路径不算地址
  assert.equal(pickRefreshedTopLevelUrl(segs, 'video', 0, 1, old), null) // 个数变了，不配
  assert.equal(pickRefreshedTopLevelUrl(segs, 'record', 0, 1, old), null)
})

test('classifyFailure：超过大小上限算 permanent；数字要单独出现才算状态码', () => {
  assert.equal(classifyFailure('文件过大: 300MB > 200MB'), 'permanent')
  assert.equal(classifyFailure('maxContentLength size of 209715200 exceeded'), 'permanent')
  assert.equal(classifyFailure('connect ECONNREFUSED 10.0.0.1:44030'), 'transient')
  assert.equal(classifyFailure('请求失败（HTTP 410）'), 'gone')
  assert.equal(classifyFailure('下载超时（300秒）'), 'transient')
})

test('uploadWithRetry：超过大小上限不重试、不等待', async () => {
  let n = 0
  let slept = 0
  const r = await uploadWithRetry(T, {
    attempt: async () => { n++; return { ok: false, error: '文件过大: 300MB > 200MB' } },
    delays: [1, 1, 1],
    sleep: async () => { slept++ },
  })
  assert.equal(n, 1)
  assert.equal(slept, 0)
  assert.equal(r.attempts, 1)
})

test('retryStep：permanent 和换不到地址的 gone 都放弃且不调用 attempt', async () => {
  let n = 0
  const attempt = async () => { n++; return { ok: true, key: 'k' } }
  const p = await retryStep(T, '文件过大: 300MB > 200MB', 0, { attempt })
  assert.deepEqual([p.ok, p.attempted, p.giveUp, p.sourceUrl], [false, false, true, T])
  const g = await retryStep(T, '资源不存在（404）', 0, { attempt, refresh: async () => null })
  assert.deepEqual([g.ok, g.attempted, g.giveUp], [false, false, true])
  assert.equal(g.error, '资源不存在（404）')
  assert.equal(n, 0)
})

test('retryStep：偶发错误第 0 轮不换地址，第 1 轮起换；成功时带回存好的键名和地址，sourceUrl 是下载地址', async () => {
  const seen: string[] = []
  let refreshes = 0
  const opts = {
    attempt: async (url: string) => { seen.push(url); return { ok: true, key: 'k', url: 'https://bucket/k' } },
    refresh: async () => { refreshes++; return 'https://multimedia.nt.qq.com.cn/fresh' },
  }
  const a = await retryStep(T, '网络连接中断', 0, opts)
  assert.equal(refreshes, 0)
  assert.deepEqual([a.ok, a.attempted, a.giveUp, a.sourceUrl, a.url, a.key], [true, true, false, T, 'https://bucket/k', 'k'])
  const b = await retryStep(T, '网络连接中断', 1, opts)
  assert.equal(refreshes, 1)
  assert.equal(b.sourceUrl, 'https://multimedia.nt.qq.com.cn/fresh')
  assert.deepEqual(seen, [T, 'https://multimedia.nt.qq.com.cn/fresh'])
})

test('retryStep：gone 换到新地址就用新地址试；attempt 抛错当失败、不放弃', async () => {
  const r = await retryStep(T, 'download url has expired', 0, {
    attempt: async () => { throw new Error('boom') },
    refresh: async () => 'https://multimedia.nt.qq.com.cn/fresh',
  })
  assert.deepEqual([r.ok, r.attempted, r.giveUp, r.error, r.sourceUrl], [false, true, false, 'boom', 'https://multimedia.nt.qq.com.cn/fresh'])
})

test('createLimiter：几批任务加起来也不超过上限，全部跑完，抛错不占名额', async () => {
  const limit = createLimiter(2)
  let active = 0
  let peak = 0
  let done = 0
  const task = (fail: boolean) => async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    if (fail) throw new Error('x')
    done++
  }
  const batch = (n: number) => Promise.all(Array.from({ length: n }, (_, i) => limit(task(i % 3 === 0)).catch(() => {})))
  await Promise.all([batch(7), batch(5), batch(1)])
  assert.equal(peak, 2)
  assert.equal(done, 13 - 3 - 2 - 1)
  // 都跑完后名额要还清：再来 2 个应当能同时跑
  peak = 0
  await Promise.all([limit(task(false)), limit(task(false))])
  assert.equal(peak, 2)
})

test('findRefreshedUrl：文件名不是 md5 的（可能重名）位置对不上就不按名字找', () => {
  const fresh = collectForwardMedia([{
    type: 'forward',
    attrs: {
      id: '7000000000000000009',
      content: [
        { message: [{ type: 'video', data: { file: 'video.mp4', url: 'https://multimedia.nt.qq.com.cn/v1' } }] },
        { message: [{ type: 'video', data: { file: 'video.mp4', url: 'https://multimedia.nt.qq.com.cn/v2' } }] },
      ],
    },
  }])
  assert.equal(findRefreshedUrl(fresh, { kind: 'video', path: '1.0', file: 'video.mp4' }), 'https://multimedia.nt.qq.com.cn/v2')
  assert.equal(findRefreshedUrl(fresh, { kind: 'video', path: '5.0', file: 'video.mp4' }), null)
})
