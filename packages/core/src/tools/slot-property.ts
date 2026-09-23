/**
 * Слот как свойство компонента.
 *
 * В Figma место под содержимое — это не просто фрейм с пометкой, а свойство
 * компонента типа `SLOT` (в файле — `ComponentPropType.SLOT`, значение 7),
 * на которое фрейм ссылается через поле `ComponentPropNodeField.SLOT_CONTENT_ID`.
 *
 * Разница видна на практике. Фрейм, который мы просто пометили в pluginData,
 * формату неизвестен: положишь в него блок, он покажется на канвасе и пропадёт
 * при сохранении — дети инстанса в файл не пишутся. А настоящее свойство-место
 * делает содержимое значением свойства, и оно переживает перезапись.
 *
 * Эта функция доводит уже помеченный фрейм до настоящего места: заводит
 * свойство в ближайшем компоненте-владельце и привязывает фрейм к нему.
 */

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/**
 * Владелец свойств для узла.
 *
 * Свойства живут в компоненте. Но пользователь работает с рабочей копией —
 * узлом внутри инстанса, — поэтому по пути вверх встретится INSTANCE, а не
 * COMPONENT. В этом случае владельцем считается компонент, на который этот
 * инстанс ссылается: свойство заводим там, иначе место не станет настоящим.
 */
function ownerComponent(graph: SceneGraph, node: SceneNode): SceneNode | null {
  let current: SceneNode | undefined = node
  const visited = new Set<string>()
  while (current?.parentId) {
    const parent: SceneNode | undefined = graph.getNode(current.parentId)
    if (!parent) return null
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return parent
    if (parent.type === 'INSTANCE' && parent.componentId && !visited.has(parent.componentId)) {
      visited.add(parent.componentId)
      const master: SceneNode | undefined = graph.getNode(parent.componentId)
      if (master?.type === 'COMPONENT' || master?.type === 'COMPONENT_SET') return master
    }
    current = parent
  }
  return null
}

/**
 * Делает узел настоящим местом-слотом.
 *
 * Возвращает описание того, что сделано, либо null, если узел уже место или
 * владельца свойств рядом нет.
 */
export function ensureSlotProperty(
  graph: SceneGraph,
  nodeId: string
): { propertyId: string; ownerId: string; created: boolean } | null {
  const node = graph.getNode(nodeId)
  if (!node) return null

  // Уже настоящий слот — второй раз не заводим.
  if ((node.componentPropertyReferences ?? []).some((ref) => ref.field === 'SLOT')) {
    const existing = (node.componentPropertyReferences ?? []).find((ref) => ref.field === 'SLOT')
    return existing ? { propertyId: existing.propertyId, ownerId: '', created: false } : null
  }

  const owner = ownerComponent(graph, node)
  if (!owner) return null

  const definitions = owner.componentPropertyDefinitions ?? []
  if (definitions.some((definition) => definition.type === 'SLOT' && definition.name === node.name.trim())) {
    const found = definitions.find(
      (definition) => definition.type === 'SLOT' && definition.name === node.name.trim()
    )
    if (found) {
      graph.updateNode(node.id, {
        componentPropertyReferences: [
          ...(node.componentPropertyReferences ?? []),
          { propertyId: found.id, field: 'SLOT' }
        ]
      })
      return { propertyId: found.id, ownerId: owner.id, created: false }
    }
  }

  // Свойство называется по фрейму: имена вида «Main content», «Slot», «Menu slot».
  const name = node.name.trim() || 'Slot'
  const base = `slot_${node.id.replace(/[^a-zA-Z0-9]/g, '_')}`
  let propertyId = base
  let suffix = 2
  const taken = new Set(definitions.map((definition) => definition.id))
  while (taken.has(propertyId)) propertyId = `${base}_${suffix++}`

  graph.updateNode(owner.id, {
    componentPropertyDefinitions: [
      ...definitions,
      { id: propertyId, name, type: 'SLOT', defaultValue: '' }
    ]
  })
  graph.updateNode(node.id, {
    componentPropertyReferences: [
      ...(node.componentPropertyReferences ?? []),
      { propertyId, field: 'SLOT' }
    ]
  })

  return { propertyId, ownerId: owner.id, created: true }
}
