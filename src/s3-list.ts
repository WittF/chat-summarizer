/**
 * 把一个前缀下的对象列全。
 *
 * S3 的列目录一次最多回 1000 个，多出来的要拿上一页给的续接标记接着要。
 * 以前只要了第一页：聊天记录文件攒过 1000 个以后，排在后面的日期就列不到了。
 */

export interface ListedObject {
  Key?: string
  Size?: number
}

export interface ListPage {
  Contents?: ListedObject[]
  IsTruncated?: boolean
  NextContinuationToken?: string
}

/** 最多翻多少页（一页 1000 个）。只是防对端一直说「还有」的保险，正常用不到。 */
export const MAX_LIST_PAGES = 1000

/**
 * 一页一页要，直到对端说没有了为止。
 * @param fetchPage 要一页；第一页不带标记，之后带上一页给的续接标记
 */
export async function listAllObjects(
  fetchPage: (continuationToken?: string) => Promise<ListPage>,
  maxPages: number = MAX_LIST_PAGES
): Promise<ListedObject[]> {
  const all: ListedObject[] = []
  let token: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPage(token)
    if (res.Contents) all.push(...res.Contents)

    // 没说还有，或者说还有却没给续接标记（再要只会拿到同一页），都到此为止
    if (!res.IsTruncated || !res.NextContinuationToken) return all
    token = res.NextContinuationToken
  }

  throw new Error(`列目录翻了 ${maxPages} 页还没到头，已停止`)
}
