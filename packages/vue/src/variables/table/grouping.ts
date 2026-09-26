import type { Variable } from '@open-pencil/scene-graph'

/**
 * Строки таблицы переменных: группы пути и сами переменные.
 *
 * Имя переменной — это путь (`accordion-status/background/default`), и в
 * таблице он раскладывается на сворачиваемые группы, как в Figma: иначе
 * полторы тысячи строк подряд не читаются, а по последнему сегменту
 * (`default`) невозможно понять, откуда токен.
 */
export interface VariableGroupRow {
  kind: 'group'
  /** Идентификатор строки-группы: по нему её и раскрывают. */
  id: string
  path: string
  name: string
  depth: number
  /** Сколько переменных внутри, включая вложенные группы. */
  count: number
  expanded: boolean
}

export interface VariableItemRow {
  kind: 'variable'
  id: string
  variable: Variable
  depth: number
}

export type VariableRow = VariableGroupRow | VariableItemRow

/** Путь группы: всё до последнего сегмента. */
export function groupPathOf(name: string): string {
  const index = name.lastIndexOf('/')
  return index === -1 ? '' : name.slice(0, index)
}

/** Имя переменной без пути группы. */
export function leafNameOf(name: string): string {
  const index = name.lastIndexOf('/')
  return index === -1 ? name : name.slice(index + 1)
}

interface GroupNode {
  name: string
  path: string
  groups: Map<string, GroupNode>
  variables: Variable[]
}

function createGroup(name: string, path: string): GroupNode {
  return { name, path, groups: new Map(), variables: [] }
}

function countOf(node: GroupNode): number {
  let count = node.variables.length
  for (const child of node.groups.values()) count += countOf(child)
  return count
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'ru')
}

/**
 * Плоский список строк с учётом раскрытых групп: сверху группы по алфавиту,
 * внутри — переменные, вложенные группы идут перед переменными своего уровня.
 */
export function buildVariableRows(
  variables: readonly Variable[],
  expanded: ReadonlySet<string>
): VariableRow[] {
  const root = createGroup('', '')
  for (const variable of variables) {
    const parts = variable.name.split('/').filter((part) => part !== '')
    if (parts.length === 0) continue
    let node = root
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part
      const existing = node.groups.get(part)
      if (existing) {
        node = existing
        continue
      }
      const created = createGroup(part, path)
      node.groups.set(part, created)
      node = created
    }
    node.variables.push(variable)
  }

  const rows: VariableRow[] = []
  const walk = (node: GroupNode, depth: number) => {
    for (const group of [...node.groups.values()].sort((a, b) => compareNames(a.name, b.name))) {
      const isExpanded = expanded.has(group.path)
      rows.push({
        kind: 'group',
        id: `group:${group.path}`,
        path: group.path,
        name: group.name,
        depth,
        count: countOf(group),
        expanded: isExpanded
      })
      if (isExpanded) walk(group, depth + 1)
    }
    for (const variable of [...node.variables].sort((a, b) =>
      compareNames(leafNameOf(a.name), leafNameOf(b.name))
    )) {
      rows.push({ kind: 'variable', id: variable.id, variable, depth })
    }
  }
  walk(root, 0)
  return rows
}

/** Все пути групп в списке — чтобы раскрыть их при поиске. */
export function groupPathsOf(variables: readonly Variable[]): Set<string> {
  const paths = new Set<string>()
  for (const variable of variables) {
    const parts = variable.name.split('/').filter((part) => part !== '')
    let path = ''
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part
      paths.add(path)
    }
  }
  return paths
}
