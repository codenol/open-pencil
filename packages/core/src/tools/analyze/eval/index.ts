import * as v from 'valibot'

import { defineTool } from '#core/tools/schema'

import { wrapEvalCode } from './wrap'

export const evalCode = defineTool({
  name: 'eval',
  description:
    'Execute JavaScript with full Figma Plugin API access. Use for operations not covered by other tools. The `figma` global is available. Inspection only: node IDs that appear in the output may belong to a master or to a node that is no longer in the document, so never pass them to another tool — read the node again with get_node or describe and use the ID from that answer.',
  execution: { kind: 'async', mutation: 'document' },
  capabilities: ['document:read', 'document:write', 'code:execute'],
  availability: 'eval',
  input: v.object({
    code: v.pipe(v.string(), v.description('JavaScript code to execute'))
  }),

  execute: async (figma, { code }) => {
    type AsyncFunctionConstructor = new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>
    const AsyncFunction = Object.getPrototypeOf(async () => undefined)
      .constructor as AsyncFunctionConstructor
    const fn = new AsyncFunction('figma', wrapEvalCode(code))
    const result = await fn(figma)
    if (result && typeof result === 'object') {
      const toJSON = Reflect.get(result, 'toJSON')
      if (typeof toJSON === 'function') return toJSON.call(result)
    }
    if (result !== undefined && result !== null) return result
    return { ok: true, message: 'Code executed (no return value)' }
  }
})
