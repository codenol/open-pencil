import { resolve } from 'node:path'

import { defineCommand } from 'citty'

import { bold, fmtList, ok } from '#cli/format'
import { loadDocument, populateWholeDocument } from '#cli/headless'
import { FileSystemLibraryCatalog } from '#cli/library/catalog'

const list = defineCommand({
  meta: { description: 'List component libraries in a filesystem catalog' },
  args: {
    root: { type: 'string', description: 'Library catalog directory', required: true },
    json: { type: 'boolean', description: 'Output as JSON' }
  },
  async run({ args }) {
    const libraries = await new FileSystemLibraryCatalog(args.root).listLibraries()
    if (args.json) {
      console.log(JSON.stringify(libraries, null, 2))
      return
    }
    console.log('')
    console.log(bold(`  ${libraries.length} component libraries`))
    console.log('')
    console.log(
      fmtList(
        libraries.map((library) => ({
          header: `${library.name} (${library.libraryId})`,
          details: {
            revision: library.latestRevisionId,
            assets: library.assetCount,
            published: library.publishedAt
          }
        })),
        { compact: true }
      )
    )
    console.log('')
  }
})

const publish = defineCommand({
  meta: { description: 'Publish a document as a component library revision' },
  args: {
    file: { type: 'positional', description: 'Source .fig file', required: true },
    root: { type: 'string', description: 'Library catalog directory', required: true },
    id: { type: 'string', description: 'Stable library ID', required: true },
    name: { type: 'string', description: 'Library name', required: true },
    description: { type: 'string', description: 'Revision description' },
    previous: { type: 'string', description: 'Expected previous revision ID' },
    pages: {
      type: 'string',
      description: 'Comma-separated page-name filters (substring match); empty = all pages'
    },
    exclude: {
      type: 'string',
      description: 'Comma-separated page-name substrings to skip'
    },
    offset: { type: 'string', description: 'Skip first N collected assets (for chunked publishing)' },
    count: { type: 'string', description: 'Take at most N collected assets (for chunked publishing)' },
    json: { type: 'boolean', description: 'Output as JSON' }
  },
  async run({ args }) {
    const graph = await loadDocument(resolve(args.file))
    const pageFilters = (args.pages ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const offset = Number.parseInt(args.offset ?? '0', 10) || 0
    const count = args.count ? Number.parseInt(args.count, 10) : undefined
    const excluded = (args.exclude ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    let assetNodeIds: string[] | undefined
    if (pageFilters.length > 0 || excluded.length > 0 || offset > 0 || count !== undefined) {
      populateWholeDocument(graph)
      const pages = graph.getPages().filter(
        (page) =>
          (pageFilters.length === 0 || pageFilters.some((filter) => page.name.includes(filter))) &&
          !excluded.some((filter) => page.name.includes(filter))
      )
      const collected: string[] = []
      const seen = new Set<string>()
      const walk = (id: string) => {
        const node = graph.getNode(id)
        if (!node || seen.has(id)) return
        seen.add(id)
        if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
          const parent = node.parentId ? graph.getNode(node.parentId) : null
          if (parent?.type !== 'COMPONENT_SET') collected.push(node.id)
        }
        for (const childId of node.childIds) walk(childId)
      }
      for (const page of pages) for (const childId of page.childIds) walk(childId)
      assetNodeIds = collected.slice(offset, count !== undefined ? offset + count : undefined)
      console.error(
        `Отобрано ассетов: ${assetNodeIds.length} из ${collected.length} (страниц: ${pages.length})`
      )
    }

    const revision = await new FileSystemLibraryCatalog(args.root).publishRevision({
      libraryId: args.id,
      name: args.name,
      graph,
      description: args.description,
      previousRevisionId: args.previous || null,
      assetNodeIds
    })
    if (args.json) {
      console.log(JSON.stringify(revision.manifest, null, 2))
      return
    }
    console.log(ok(`Published ${revision.manifest.name} @ ${revision.manifest.revisionId}`))
  }
})

export default defineCommand({
  meta: { description: 'Manage component library catalogs' },
  subCommands: { list, publish }
})
