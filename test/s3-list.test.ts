import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listAllObjects, type ListPage } from '../src/s3-list.ts'

// 样本都是编的。假装桶里有 n 个文件、对端一页回 pageSize 个。
function fakeBucket(n: number, pageSize = 1000) {
  const keys = Array.from({ length: n }, (_, i) => `chat-logs/d${String(i).padStart(5, '0')}.json`)
  const calls: (string | undefined)[] = []
  const fetchPage = async (token?: string): Promise<ListPage> => {
    calls.push(token)
    const start = token ? Number(token) : 0
    const end = Math.min(start + pageSize, n)
    return {
      Contents: keys.slice(start, end).map(Key => ({ Key, Size: 1 })),
      IsTruncated: end < n,
      NextContinuationToken: end < n ? String(end) : undefined
    }
  }
  return { keys, calls, fetchPage }
}

test('listAllObjects：不满一页，要一次就完', async () => {
  const b = fakeBucket(3)
  const got = await listAllObjects(b.fetchPage)
  assert.deepEqual(got.map(o => o.Key), b.keys)
  assert.deepEqual(b.calls, [undefined])
})

test('listAllObjects：超过 1000 个也列得全（以前排在 1000 之后的会丢）', async () => {
  const b = fakeBucket(1004)
  const got = await listAllObjects(b.fetchPage)
  assert.equal(got.length, 1004)
  assert.equal(got[1003].Key, b.keys[1003])
  assert.deepEqual(b.calls, [undefined, '1000'])
})

test('listAllObjects：正好整页、好几页，都不多要也不少要', async () => {
  const exact = fakeBucket(2000)
  assert.equal((await listAllObjects(exact.fetchPage)).length, 2000)
  assert.deepEqual(exact.calls, [undefined, '1000'])

  const many = fakeBucket(25, 10)
  assert.equal((await listAllObjects(many.fetchPage)).length, 25)
  assert.deepEqual(many.calls, [undefined, '10', '20'])
})

test('listAllObjects：空目录回空数组', async () => {
  assert.deepEqual(await listAllObjects(async () => ({})), [])
})

test('listAllObjects：对端说还有却不给续接标记，拿到的照样返回、不死循环', async () => {
  let n = 0
  const got = await listAllObjects(async () => { n++; return { Contents: [{ Key: 'a', Size: 1 }], IsTruncated: true } })
  assert.equal(got.length, 1)
  assert.equal(n, 1)
})

test('listAllObjects：对端一直说还有，翻到上限就报错停下', async () => {
  let n = 0
  await assert.rejects(
    listAllObjects(async () => { n++; return { Contents: [], IsTruncated: true, NextContinuationToken: 'x' } }, 5),
    /翻了 5 页/
  )
  assert.equal(n, 5)
})
