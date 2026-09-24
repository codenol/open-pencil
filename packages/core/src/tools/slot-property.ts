/**
 * Слот как свойство компонента.
 *
 * В Figma место под содержимое — не просто фрейм с пометкой, а свойство
 * компонента типа `SLOT` (в файле — `ComponentPropType.SLOT`, значение 7),
 * на которое фрейм ссылается полем `ComponentPropNodeField.SLOT_CONTENT_ID`.
 *
 * Разница видна на практике. Фрейм, помеченный только в pluginData, формату
 * неизвестен: положишь в него блок — он покажется на канвасе и пропадёт при
 * сохранении. А настоящее свойство-место делает содержимое значением свойства,
 * и оно переживает перезапись.
 *
 * Важная тонкость: свойство живёт у **слота мастера**, а не у того, что в
 * рабочей копии. Слот внутри инстанса знает своего мастера через `componentId`
 * — по этой связи и находим, где заводить свойство. Правку в самом инстансе
 * файл не сохранит.
 */

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/** Ближайший владелец свойств: компонент или набор вариантов. */
function ownerComponent(graph: SceneGraph, node: SceneNode): SceneNode | null {
  let current: SceneNode | undefined = node
  const visited = new Set<string>()
  while (current?.parentId) {
    const parent: SceneNode | undefined = graph.getNode(current.parentId)
    if (!parent) return null
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return parent
    if (parent.type === 'INSTANCE' && parent.componentId && !visited.has(parent.componentId)) {
      visited.add(parent.componentId)
      const master = graph.getNode(parent.componentId)
      if (master?.type === 'COMPONENT' || master?.type === 'COMPONENT_SET') return master
    }
    current = parent
  }
  return null
}

/**
 * Узел мастера, которому принадлежит место.
 *
 * Слот внутри инстанса — это копия слота мастера, и `componentId` указывает
 * прямо на неё. Если узел уже в мастере, он и есть искомый.
 */
function masterSlot(graph: SceneGraph, node: SceneNode): SceneNode {
  if (!node.componentId || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return node
  const master = graph.getNode(node.componentId)
  if (!master) return node
  // Слот инстанса ссылается на фрейм мастера; если это компонент-владелец,
  // значит связи нет и работаем с самим узлом.
  if (master.type === 'COMPONENT' || master.type === 'COMPONENT_SET') return node
  return master
}

export interface SlotPropertyResult {
  /** Узел, который стал настоящим местом. */
  slotId: string
  propertyId: string
  ownerId: string
  created: boolean
  /** Куда смотрит место: узел в мастере или в рабочей копии. */
  scope: 'master' | 'instance'
}

/**
 * Чтение состояния слота: привязан ли узел (или его мастер-двойник) к
 * свойству типа SLOT. Ничего не меняет — для UI и проверок.
 */
export function getSlotPropertyInfo(graph: SceneGraph, nodeId: string): SlotPropertyResult | null {
  const found = graph.getNode(nodeId)
  if (!found) return null
  const target = masterSlot(graph, found)
  const scope: 'master' | 'instance' = target.id === found.id ? 'master' : 'instance'
  const ref = (target.componentPropertyReferences ?? []).find((r) => r.field === 'SLOT')
  if (!ref) return null
  const owner = ownerComponent(graph, target)
  return { slotId: target.id, propertyId: ref.propertyId, ownerId: owner?.id ?? '', created: false, scope }
}

/**
 * Снимает пометку слота: убирает ссылку у узла мастера, само свойство у
 * владельца (если его больше никто не использует) и наполнение этого места
 * во всех инстансах. Без зачистки assignments в файл ушла бы ссылка на
 * несуществующее свойство.
 */
export function removeSlotProperty(graph: SceneGraph, nodeId: string): SlotPropertyResult | null {
  const info = getSlotPropertyInfo(graph, nodeId)
  if (!info) return null

  // Ссылку снимаем со всех узлов: с мастера и с производных копий в инстансах —
  // иначе копии продолжают ссылаться на свойство, и оно не снимается у владельца.
  for (const node of graph.getAllNodes()) {
    const refs = node.componentPropertyReferences
    if (!refs?.some((ref) => ref.field === 'SLOT' && ref.propertyId === info.propertyId)) continue
    graph.updateNode(node.id, {
      componentPropertyReferences: refs.filter(
        (ref) => !(ref.field === 'SLOT' && ref.propertyId === info.propertyId)
      )
    })
  }

  // Наполнение места во всех инстансах снимаем вместе с пометкой.
  for (const node of graph.getAllNodes()) {
    const assignments = node.componentPropertyAssignments
    if (assignments && info.propertyId in assignments) {
      const rest = { ...assignments }
      delete rest[info.propertyId]
      graph.updateNode(node.id, { componentPropertyAssignments: rest })
    }
  }

  const owner = info.ownerId ? graph.getNode(info.ownerId) : undefined
  if (owner?.componentPropertyDefinitions) {
    // Свойство могут использовать другие слоты владельца — тогда оставляем.
    let usedElsewhere = false
    for (const node of graph.getAllNodes()) {
      if (
        node.componentPropertyReferences?.some(
          (ref) => ref.field === 'SLOT' && ref.propertyId === info.propertyId
        )
      ) {
        usedElsewhere = true
        break
      }
    }
    if (!usedElsewhere) {
      graph.updateNode(owner.id, {
        componentPropertyDefinitions: owner.componentPropertyDefinitions.filter(
          (definition) => definition.id !== info.propertyId
        )
      })
    }
  }

  return info
}

/**
 * Делает узел настоящим местом-слотом.
 *
 * Возвращает описание того, что сделано, либо null, если владельца свойств
 * рядом нет.
 */
export function ensureSlotProperty(graph: SceneGraph, nodeId: string): SlotPropertyResult | null {
  const found = graph.getNode(nodeId)
  if (!found) return null

  const target = masterSlot(graph, found)
  const scope: 'master' | 'instance' = target.id === found.id ? 'master' : 'instance'

  // Уже настоящий слот — второй раз не заводим.
  const existingRef = (target.componentPropertyReferences ?? []).find((ref) => ref.field === 'SLOT')
  if (existingRef) {
    return {
      slotId: target.id,
      propertyId: existingRef.propertyId,
      ownerId: '',
      created: false,
      scope
    }
  }

  const owner = ownerComponent(graph, target)
  if (!owner) return null

  const definitions = owner.componentPropertyDefinitions ?? []
  const name = target.name.trim() || 'Slot'
  const sameName = definitions.find((definition) => definition.type === 'SLOT' && definition.name === name)
  if (sameName) {
    graph.updateNode(target.id, {
      componentPropertyReferences: [
        ...(target.componentPropertyReferences ?? []),
        { propertyId: sameName.id, field: 'SLOT' }
      ]
    })
    return { slotId: target.id, propertyId: sameName.id, ownerId: owner.id, created: false, scope }
  }

  const base = `slot_${target.id.replace(/[^a-zA-Z0-9]/g, '_')}`
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
  graph.updateNode(target.id, {
    componentPropertyReferences: [
      ...(target.componentPropertyReferences ?? []),
      { propertyId, field: 'SLOT' }
    ]
  })

  return { slotId: target.id, propertyId, ownerId: owner.id, created: true, scope }
}
