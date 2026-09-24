export { CODEGEN_PROMPT } from './prompts'

export { getComponentCatalog, registerComponentCatalog } from './component-catalog'
export type {
  ComponentCatalog,
  ComponentCatalogInsertInput,
  ComponentCatalogLibraryAsset
} from './component-catalog'
export { ALL_TOOLS, CORE_TOOLS, EXTENDED_TOOLS } from './registry'
export { exportImage } from './vector'
export {
  defineTool,
  nodeToResult,
  nodeSummary,
  requireNode,
  NodeNotFoundError,
  toolChangesDocument
} from './schema'
export type { ToolDef, ToolExecution, ToolCapability } from './schema'
export { isAtomicTool, isToolExposed, type ToolInterface, type ToolExposure } from './schema'
export { toolNumber } from './input'
export { toolsToAI, buildDebugLog } from './ai-adapter'
export type { ToolLogEntry, ToolDebugLog, AIAdapterOptions, StepBudget } from './ai-adapter'
export { calcClusterConfidence, wrapEvalCode } from './analyze'
export {
  VALID_OVERLAP_CATEGORIES,
  VALID_OVERLAP_SCOPES,
  VALID_OVERLAP_SEVERITIES,
  parseOverlapCategories,
  parseOverlapScope,
  parseOverlapSeverity
} from './analyze/overlaps/params'
export { setPexelsAPIKey, setUnsplashAccessKey } from './stock-photo'
export { importSVG } from './create'
export { resolveDefaultVariant, markDefaultVariant } from './default-variant'
export {
  readComponentRules,
  writeComponentRules,
  RULES_KEY,
  RULES_PLUGIN_ID,
  type ComponentRules
} from './component-rules'
export {
  ensureSlotProperty,
  getSlotPropertyInfo,
  removeSlotProperty,
  type SlotPropertyResult
} from './slot-property'
export { swapSlotContent, getSlotContentId, clearSlotContent } from './modify/swap'
export { releaseOriginalFigArchive } from '../kiwi/fig/session/original-archive'
