import { describe, expect, test } from 'bun:test'

import { buildVariableRows, groupPathOf, groupPathsOf, leafNameOf } from '@open-pencil/vue'
import type { Variable } from '@open-pencil/scene-graph'

function variable(name: string, id = name): Variable {
  return {
    id,
    name,
    type: 'COLOR',
    collectionId: 'collection',
    valuesByMode: { mode: { r: 0, g: 0, b: 0, a: 1 } },
    description: '',
    hiddenFromPublishing: false
  }
}

const variables = [
  variable('default'),
  variable('accordion-status/background/default'),
  variable('accordion-status/background/hover'),
  variable('accordion-status/border/default'),
  variable('button/filled/accent/background/default'),
  variable('button/filled/accent/background/hover'),
  variable('badge/background/default')
]

describe('variable rows by path', () => {
  test('collapsed by default shows only top-level groups and plain variables', () => {
    const rows = buildVariableRows(variables, new Set())

    // Сначала группы по алфавиту, затем переменные этого уровня — как в Figma.
    expect(rows.map((row) => `${row.kind}:${row.kind === 'group' ? row.path : row.variable.name}`)).toEqual([
      'group:accordion-status',
      'group:badge',
      'group:button',
      'variable:default'
    ])
  })

  test('a group reports how many variables it holds, nested groups included', () => {
    const rows = buildVariableRows(variables, new Set())
    const button = rows.find((row) => row.kind === 'group' && row.path === 'button')

    expect(button?.kind === 'group' ? button.count : null).toBe(2)
  })

  test('expanding reveals nested groups first and then variables, with depth', () => {
    const rows = buildVariableRows(variables, new Set(['accordion-status', 'accordion-status/background']))

    expect(
      rows.map((row) =>
        row.kind === 'group'
          ? `g${row.depth}:${row.path}`
          : `v${row.depth}:${leafNameOf(row.variable.name)}`
      )
    ).toEqual([
      'g0:accordion-status',
      'g1:accordion-status/background',
      'v2:default',
      'v2:hover',
      'g1:accordion-status/border',
      'g0:badge',
      'g0:button',
      'v0:default'
    ])
  })

  test('group paths list every level, and names split at the last slash', () => {
    expect([...groupPathsOf(variables)].sort()).toEqual([
      'accordion-status',
      'accordion-status/background',
      'accordion-status/border',
      'badge',
      'badge/background',
      'button',
      'button/filled',
      'button/filled/accent',
      'button/filled/accent/background'
    ])
    expect(groupPathOf('button/filled/accent/background/default')).toBe(
      'button/filled/accent/background'
    )
    expect(leafNameOf('button/filled/accent/background/default')).toBe('default')
    expect(groupPathOf('default')).toBe('')
    expect(leafNameOf('default')).toBe('default')
  })
})
