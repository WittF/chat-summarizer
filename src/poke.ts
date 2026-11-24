// 群里的「戳一戳」（双击头像）。它不是消息，是一种通知事件：OneBot 报的是
//   { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id, user_id, target_id, raw_info? }
// 适配器把它变成 type = 'notice'、subtype = 'poke' 的会话，谁戳的在 userId、戳了谁在 targetId。
//
// 记成聊天记录文件里的一行，和消息放在同一个文件里（按时间先后）：多一个 notice: 'poke' 和 targetId，
// messageType 是 'other'、没有元素。读这个文件的地方凭 notice 这个字段把它和消息分开。
// 这里只有纯函数，不碰 Koishi，好测。

export interface PokeEvent {
  guildId: string
  /** 谁戳的 */
  userId: string
  /** 戳了谁 */
  targetId: string
  /** 毫秒 */
  timestamp: number
  /** 动作的字样，多数是「戳了戳」，也可能是自己设的（「拍了拍」「揉了揉」……） */
  action: string
  /** 动作后面跟的半句（「的头」之类），没有是 '' */
  suffix: string
}

export const DEFAULT_POKE_ACTION = '戳了戳'

/** 去掉适配器加的「平台:」前缀 */
const bareId = (id: unknown): string => {
  const s = id === undefined || id === null ? '' : String(id)
  const i = s.indexOf(':')
  return i === -1 ? s : s.slice(i + 1)
}

/**
 * 从 raw_info 里把动作的字样找出来。它是一串小片段，文字片段带 txt：第一段是动作，第二段是后半句。
 * 各家实现给的不一样，也可能压根没有；找不到就用「戳了戳」。
 */
export function pokeWords(rawInfo: unknown): { action: string; suffix: string } {
  const texts: string[] = []
  if (Array.isArray(rawInfo)) {
    for (const part of rawInfo) {
      const txt = part && typeof part === 'object' ? (part as Record<string, unknown>).txt : undefined
      if (typeof txt === 'string' && txt.trim()) texts.push(txt.trim().slice(0, 40))
    }
  }
  return { action: texts[0] || DEFAULT_POKE_ACTION, suffix: texts[1] || '' }
}

/**
 * 把一个通知会话读成戳一戳。不是戳一戳、不在群里、缺了谁戳的或者戳了谁，返回 null。
 * raw 是 OneBot 的原始事件（没有也行）；now 只在事件自己不带时间时用。
 */
export function readPoke(
  session: { type?: string; subtype?: string; guildId?: string; userId?: string; targetId?: string; timestamp?: number },
  raw: unknown,
  now: number = Date.now(),
): PokeEvent | null {
  if (session.type !== 'notice' || session.subtype !== 'poke') return null
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const guildId = bareId(session.guildId ?? data.group_id)
  const userId = bareId(session.userId ?? data.user_id)
  const targetId = bareId(session.targetId ?? data.target_id)
  if (!guildId || !userId || !targetId) return null
  // OneBot 的 time 是秒
  const seconds = typeof data.time === 'number' && data.time > 0 ? data.time : 0
  const timestamp = session.timestamp && session.timestamp > 0 ? session.timestamp : seconds ? seconds * 1000 : now
  return { guildId, userId, targetId, timestamp, ...pokeWords(data.raw_info) }
}

/** 写进聊天记录文件的那一行（字段和消息的那一行对齐，多出 notice、targetId 等几个） */
export function buildPokeEntry(
  poke: PokeEvent,
  names: { user?: string; target?: string },
  time: string,
): Record<string, unknown> {
  const username = names.user || poke.userId
  const targetName = names.target || poke.targetId
  return {
    timestamp: poke.timestamp,
    time,
    messageId: `poke-${poke.timestamp}-${poke.userId}-${poke.targetId}`,
    guildId: poke.guildId,
    channelId: poke.guildId,
    userId: poke.userId,
    username,
    content: `[戳一戳] ${poke.action} ${targetName}${poke.suffix}`,
    messageType: 'other',
    imageUrls: [],
    fileUrls: [],
    videoUrls: [],
    originalElements: [],
    notice: 'poke',
    targetId: poke.targetId,
    targetName,
    pokeAction: poke.action,
    ...(poke.suffix ? { pokeSuffix: poke.suffix } : {}),
  }
}

/** 记录文件里的一行是不是通知（戳一戳），不是消息 */
export function isNoticeEntry(record: unknown): boolean {
  return Boolean(record && typeof record === 'object' && typeof (record as Record<string, unknown>).notice === 'string')
}

/**
 * 记一小会儿「号 → 群名片」，免得同一个人连着戳的时候每次都去问一遍。
 * lookup 问不到（抛错、给空）就记成 ''，这段时间里也不再问。
 */
export function createNameCache(ttlMs = 3_600_000, max = 5000) {
  const seen = new Map<string, { at: number; name: string }>()
  return async (key: string, lookup: () => Promise<string | undefined>, now: number = Date.now()): Promise<string> => {
    const hit = seen.get(key)
    if (hit && now - hit.at < ttlMs) return hit.name
    let name = ''
    try {
      name = (await lookup()) || ''
    } catch {
      name = ''
    }
    seen.delete(key)
    seen.set(key, { at: now, name })
    if (seen.size > max) seen.delete(seen.keys().next().value as string)
    return name
  }
}
