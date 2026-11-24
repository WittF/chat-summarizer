import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPokeEntry, createNameCache, DEFAULT_POKE_ACTION, isNoticeEntry, pokeWords, readPoke } from '../src/poke.ts'

// 样本都是编的：群 20001，人 10001、10002

test('readPoke：群里的戳一戳读得出谁戳了谁、什么时候', () => {
  const raw = { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id: 20001, user_id: 10001, target_id: 10002, time: 1795000000 }
  const poke = readPoke({ type: 'notice', subtype: 'poke', guildId: '20001', userId: '10001', targetId: '10002' }, raw, 5)
  assert.deepEqual(poke, { guildId: '20001', userId: '10001', targetId: '10002', timestamp: 1795000000000, action: DEFAULT_POKE_ACTION, suffix: '' })
})

test('readPoke：会话自己带时间就用它；都没有用现在', () => {
  const s = { type: 'notice', subtype: 'poke', guildId: '20001', userId: '10001', targetId: '10002' }
  assert.equal(readPoke({ ...s, timestamp: 1234 }, { time: 99 })?.timestamp, 1234)
  assert.equal(readPoke(s, undefined, 777)?.timestamp, 777)
})

test('readPoke：会话上没有的字段从原始事件里补；带平台前缀的号去掉前缀', () => {
  const poke = readPoke({ type: 'notice', subtype: 'poke', userId: 'onebot:10001' }, { group_id: 20001, target_id: 10002 }, 1)
  assert.equal(poke?.guildId, '20001')
  assert.equal(poke?.userId, '10001')
  assert.equal(poke?.targetId, '10002')
})

test('readPoke：不是戳一戳、私聊里的、缺人的，都不记', () => {
  const ok = { type: 'notice', subtype: 'poke', guildId: '20001', userId: '10001', targetId: '10002' }
  assert.equal(readPoke({ ...ok, subtype: 'honor' }, {}), null)
  assert.equal(readPoke({ ...ok, type: 'message' }, {}), null)
  assert.equal(readPoke({ ...ok, guildId: undefined }, {}), null)
  assert.equal(readPoke({ ...ok, targetId: undefined }, {}), null)
  assert.equal(readPoke({ ...ok, userId: '' }, {}), null)
})

test('pokeWords：raw_info 里第一段文字是动作、第二段是后半句；没有就是「戳了戳」', () => {
  const info = [{ type: 'qq', uid: 'u_a' }, { type: 'nor', txt: '拍了拍' }, { type: 'qq', uid: 'u_b' }, { type: 'nor', txt: '的头' }]
  assert.deepEqual(pokeWords(info), { action: '拍了拍', suffix: '的头' })
  assert.deepEqual(pokeWords([{ type: 'nor', txt: '揉了揉' }]), { action: '揉了揉', suffix: '' })
  for (const bad of [undefined, null, 'x', {}, [], [null, 3, { txt: '  ' }]]) assert.deepEqual(pokeWords(bad), { action: DEFAULT_POKE_ACTION, suffix: '' })
})

test('buildPokeEntry：和消息的那一行字段对齐，多出 notice 和 targetId；名字问不到就用号', () => {
  const poke = { guildId: '20001', userId: '10001', targetId: '10002', timestamp: 1795000000000, action: '戳了戳', suffix: '' }
  const entry = buildPokeEntry(poke, { user: '阿一', target: '阿二' }, '2026-11-25 10:00:00')
  assert.deepEqual(entry, {
    timestamp: 1795000000000,
    time: '2026-11-25 10:00:00',
    messageId: 'poke-1795000000000-10001-10002',
    guildId: '20001',
    channelId: '20001',
    userId: '10001',
    username: '阿一',
    content: '[戳一戳] 戳了戳 阿二',
    messageType: 'other',
    imageUrls: [],
    fileUrls: [],
    videoUrls: [],
    originalElements: [],
    notice: 'poke',
    targetId: '10002',
    targetName: '阿二',
    pokeAction: '戳了戳',
  })
  const bare = buildPokeEntry({ ...poke, action: '拍了拍', suffix: '的头' }, {}, 't')
  assert.equal(bare.username, '10001')
  assert.equal(bare.content, '[戳一戳] 拍了拍 10002的头')
  assert.equal(bare.pokeSuffix, '的头')
})

test('isNoticeEntry：凭 notice 字段把戳一戳和消息分开', () => {
  assert.equal(isNoticeEntry({ notice: 'poke', userId: '10001' }), true)
  assert.equal(isNoticeEntry({ messageType: 'text', content: '[戳一戳]' }), false)
  for (const x of [null, undefined, 'poke', 3, []]) assert.equal(isNoticeEntry(x), false)
})

test('createNameCache：一小时里同一个人只问一次；问不到记成空、也不再问', async () => {
  const cache = createNameCache(1000)
  let asked = 0
  const lookup = async () => { asked++; return '阿一' }
  assert.equal(await cache('20001:10001', lookup, 0), '阿一')
  assert.equal(await cache('20001:10001', lookup, 999), '阿一')
  assert.equal(asked, 1)
  assert.equal(await cache('20001:10001', lookup, 1000), '阿一')
  assert.equal(asked, 2)
  let failed = 0
  const boom = async () => { failed++; throw new Error('问不到') }
  assert.equal(await cache('20001:10002', boom, 0), '')
  assert.equal(await cache('20001:10002', boom, 10), '')
  assert.equal(failed, 1)
})
