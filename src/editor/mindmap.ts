import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

// 思维导图：节点 = 矩形 + 绑定文字，父子关系存于 customData.mindmap.parentId，
// 连线 = 带弧度的曲线（customData.mindmap.connector）。连线由对账逻辑根据节点
// 当前位置实时重建，因此拖动节点时连线会跟随拉伸，而不是断开。

export type MindNode = {
  id: string
  parentId: string | null
  text: string
}

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 52
export const H_GAP = 90 // 列间距（父子之间的水平间隔）
export const V_GAP = 22 // 叶子节点之间的垂直间隔

const PALETTE = [
  { background: '#4263eb', stroke: '#1c2f80', text: '#ffffff' }, // 中心主题
  { background: '#e7f5ff', stroke: '#1c7ed6', text: '#1c2f3a' },
  { background: '#fff9db', stroke: '#f08c00', text: '#3a2f1c' },
  { background: '#ebfbee', stroke: '#2f9e44', text: '#1c3a22' },
  { background: '#fff0f6', stroke: '#c2255c', text: '#3a1c2a' },
]

export function paletteFor(depth: number) {
  return PALETTE[Math.min(Math.max(depth, 0), PALETTE.length - 1)]
}

type Box = { x: number; y: number; width: number; height: number }

type MindElement = ExcalidrawElement & {
  containerId?: string | null
  text?: string
  customData?: {
    mindmap?: {
      parentId?: string | null
      depth?: number
      connector?: boolean
      collapsed?: boolean
    }
  } | null
}

function isMindRect(el: MindElement): boolean {
  return el.type === 'rectangle' && !!el.customData?.mindmap && !el.customData.mindmap.connector
}

// ---------- 连线骨架（弧线） ----------

function connectorSkeleton(parent: Box, child: Box): ExcalidrawElementSkeleton {
  const parentCx = parent.x + parent.width / 2
  const childCx = child.x + child.width / 2
  const rightward = childCx >= parentCx

  const startX = rightward ? parent.x + parent.width : parent.x
  const endX = rightward ? child.x : child.x + child.width
  const startY = parent.y + parent.height / 2
  const endY = child.y + child.height / 2
  const bend = (endX - startX) / 2 // 控制点水平偏移，越大弧度越柔

  const points: [number, number][] = [
    [0, 0],
    [bend, 0],
    [endX - startX - bend, endY - startY],
    [endX - startX, endY - startY],
  ]

  return {
    type: 'line',
    x: startX,
    y: startY,
    points,
    roundness: { type: 2 },
    strokeColor: '#b0b6bf',
    strokeWidth: 2,
    customData: { mindmap: { connector: true } },
  }
}

function boxSkeleton(node: MindNode, x: number, y: number, depth: number): ExcalidrawElementSkeleton {
  const color = paletteFor(depth)
  return {
    type: 'rectangle',
    id: node.id,
    x,
    y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    backgroundColor: color.background,
    strokeColor: color.stroke,
    fillStyle: 'solid',
    roundness: { type: 3 },
    customData: { mindmap: { parentId: node.parentId, depth } },
    label: {
      text: node.text,
      strokeColor: color.text,
      fontSize: depth === 0 ? 20 : 16,
    },
  }
}

// ---------- 文本大纲解析（生成入口用） ----------

type OutlineNode = { id: string; text: string; children: OutlineNode[] }

function indentWidth(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4
    else break
  }
  return width
}

export function parseOutline(text: string): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: { indent: number; node: OutlineNode }[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const title = rawLine.trim()
    if (!title) continue

    const indent = indentWidth(rawLine)
    const node: OutlineNode = { id: crypto.randomUUID(), text: title, children: [] }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1].node.children.push(node)

    stack.push({ indent, node })
  }

  return roots
}

// ---------- 逻辑树 → 画布元素（整树自动布局，用于初次生成） ----------

// tidy-tree 布局：x 由层级决定，叶子顺序排布，父节点居中于子节点。兄弟顺序即数组顺序。
export function layoutPositions(
  nodes: MindNode[],
): Map<string, { x: number; y: number; depth: number }> {
  const ids = new Set(nodes.map((node) => node.id))
  const childrenMap = new Map<string | null, MindNode[]>()
  for (const node of nodes) {
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null
    const list = childrenMap.get(key) ?? []
    list.push(node)
    childrenMap.set(key, list)
  }

  const placed = new Map<string, { x: number; y: number; depth: number }>()
  let nextLeafY = 0

  function visit(node: MindNode, depth: number): { x: number; y: number; depth: number } {
    const x = depth * (NODE_WIDTH + H_GAP)
    const kids = childrenMap.get(node.id) ?? []
    let y: number

    if (kids.length === 0) {
      y = nextLeafY
      nextLeafY += NODE_HEIGHT + V_GAP
    } else {
      const placedKids = kids.map((kid) => visit(kid, depth + 1))
      y = (placedKids[0].y + placedKids[placedKids.length - 1].y) / 2
    }

    const position = { x, y, depth }
    placed.set(node.id, position)
    return position
  }

  for (const root of childrenMap.get(null) ?? []) {
    visit(root, 0)
    nextLeafY += NODE_HEIGHT + V_GAP
  }

  return placed
}

export function nodesToElements(nodes: MindNode[]): ExcalidrawElement[] {
  if (nodes.length === 0) return []

  const placed = layoutPositions(nodes)
  const connectors: ExcalidrawElementSkeleton[] = []
  const boxes: ExcalidrawElementSkeleton[] = []

  for (const node of nodes) {
    const p = placed.get(node.id)!
    boxes.push(boxSkeleton(node, p.x, p.y, p.depth))

    const parent = node.parentId ? placed.get(node.parentId) : undefined
    if (parent) {
      connectors.push(
        connectorSkeleton(
          { x: parent.x, y: parent.y, width: NODE_WIDTH, height: NODE_HEIGHT },
          { x: p.x, y: p.y, width: NODE_WIDTH, height: NODE_HEIGHT },
        ),
      )
    }
  }

  // 连线在前（渲染在底层），节点在后（覆盖在上层）。
  return convertToExcalidrawElements([...connectors, ...boxes], { regenerateIds: false })
}

// 从画布读出可见的逻辑树（兄弟按当前 y 排序的先序），折叠隐藏的子节点不在其中。
export function readMindNodes(elements: readonly ExcalidrawElement[]): MindNode[] {
  const all = elements as readonly MindElement[]
  const rects = all.filter(isMindRect)
  const rectIds = new Set(rects.map((rect) => rect.id))

  const textByContainer = new Map<string, string>()
  for (const el of all) {
    if (el.type === 'text' && el.containerId && rectIds.has(el.containerId)) {
      textByContainer.set(el.containerId, el.text ?? '')
    }
  }

  const childrenMap = new Map<string | null, MindElement[]>()
  for (const rect of rects) {
    const parentId = rect.customData?.mindmap?.parentId ?? null
    const key = parentId && rectIds.has(parentId) ? parentId : null
    const list = childrenMap.get(key) ?? []
    list.push(rect)
    childrenMap.set(key, list)
  }
  for (const list of childrenMap.values()) list.sort((a, b) => a.y - b.y)

  const nodes: MindNode[] = []
  function preorder(rect: MindElement) {
    nodes.push({
      id: rect.id,
      parentId: rect.customData?.mindmap?.parentId ?? null,
      text: textByContainer.get(rect.id) ?? '',
    })
    for (const child of childrenMap.get(rect.id) ?? []) preorder(child)
  }
  for (const root of childrenMap.get(null) ?? []) preorder(root)

  return nodes
}

export function outlineToElements(text: string): ExcalidrawElement[] {
  const roots = parseOutline(text)
  if (roots.length === 0) {
    throw new Error('请输入至少一行内容')
  }

  const nodes: MindNode[] = []
  function flatten(node: OutlineNode, parentId: string | null) {
    nodes.push({ id: node.id, parentId, text: node.text })
    for (const child of node.children) flatten(child, node.id)
  }
  for (const root of roots) flatten(root, null)

  return nodesToElements(nodes)
}

// ---------- 增量插入单个节点（用于 Tab / Enter，保留现有布局） ----------

export function makeNodeElements(node: MindNode & { depth: number; x: number; y: number }): ExcalidrawElement[] {
  return convertToExcalidrawElements([boxSkeleton(node, node.x, node.y, node.depth)], {
    regenerateIds: false,
  })
}

// ---------- 折叠：收集某节点的所有后代矩形 id ----------

export function collectDescendantRectIds(
  elements: readonly ExcalidrawElement[],
  rootId: string,
): string[] {
  const all = elements as readonly MindElement[]
  const childrenOf = new Map<string, string[]>()
  for (const el of all) {
    if (!isMindRect(el)) continue
    const parentId = el.customData?.mindmap?.parentId ?? null
    if (!parentId) continue
    const list = childrenOf.get(parentId) ?? []
    list.push(el.id)
    childrenOf.set(parentId, list)
  }

  const out: string[] = []
  const stack = [...(childrenOf.get(rootId) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop()!
    out.push(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return out
}

// ---------- 用于对账的轻量签名（仅节点矩形的 id+位置） ----------

export function rectSignature(elements: readonly ExcalidrawElement[]): string {
  const all = elements as readonly MindElement[]
  return all
    .filter(isMindRect)
    .map((el) => `${el.id}:${Math.round(el.x)}:${Math.round(el.y)}`)
    .sort()
    .join('|')
}

// ---------- 对账：拖动后重建连线 + 整棵子树跟随平移 ----------

export type ReconcileResult = {
  elements: ExcalidrawElement[]
  positions: Map<string, { x: number; y: number }>
}

export function reconcileMindMap(
  elements: readonly ExcalidrawElement[],
  prev: Map<string, { x: number; y: number }>,
): ReconcileResult {
  const all = elements as readonly MindElement[]
  const rects = all.filter(isMindRect)

  const parentOf = (id: string, byId: Map<string, MindElement>): string | null => {
    const parentId = byId.get(id)?.customData?.mindmap?.parentId ?? null
    return parentId && byId.has(parentId) ? parentId : null
  }

  const rectById = new Map(rects.map((rect) => [rect.id, rect]))

  // 1) 检测被移动的节点，并把「最上层被移动节点」的整棵子树一起平移。
  const movedSet = new Set<string>()
  for (const rect of rects) {
    const before = prev.get(rect.id)
    if (before && (before.x !== rect.x || before.y !== rect.y)) movedSet.add(rect.id)
  }

  const childrenOf = new Map<string, string[]>()
  for (const rect of rects) {
    const parentId = parentOf(rect.id, rectById)
    if (!parentId) continue
    const list = childrenOf.get(parentId) ?? []
    list.push(rect.id)
    childrenOf.set(parentId, list)
  }

  const hasMovedAncestor = (id: string): boolean => {
    let parentId = parentOf(id, rectById)
    while (parentId) {
      if (movedSet.has(parentId)) return true
      parentId = parentOf(parentId, rectById)
    }
    return false
  }

  const shift = new Map<string, { dx: number; dy: number }>()
  for (const id of movedSet) {
    if (hasMovedAncestor(id)) continue // 由更上层的祖先统一带动
    const before = prev.get(id)!
    const current = rectById.get(id)!
    const dx = current.x - before.x
    const dy = current.y - before.y
    if (dx === 0 && dy === 0) continue

    const stack = [...(childrenOf.get(id) ?? [])]
    while (stack.length > 0) {
      const descId = stack.pop()!
      // 多选时，被用户直接拖动的后代已由 Excalidraw 平移，避免重复位移。
      if (!movedSet.has(descId)) shift.set(descId, { dx, dy })
      for (const child of childrenOf.get(descId) ?? []) stack.push(child)
    }
  }

  let working: MindElement[] = all as MindElement[]
  if (shift.size > 0) {
    working = all.map((el) => {
      const direct = shift.get(el.id)
      if (direct) return { ...el, x: el.x + direct.dx, y: el.y + direct.dy }
      if (el.type === 'text' && el.containerId && shift.has(el.containerId)) {
        const s = shift.get(el.containerId)!
        return { ...el, x: el.x + s.dx, y: el.y + s.dy }
      }
      return el
    })
  }

  // 2) 重建连线：移除旧连线，按当前节点位置重新生成弧线。
  const finalRects = working.filter(isMindRect)
  const finalById = new Map(finalRects.map((rect) => [rect.id, rect]))
  const connectorSkeletons: ExcalidrawElementSkeleton[] = []
  for (const rect of finalRects) {
    const parentId = rect.customData?.mindmap?.parentId ?? null
    const parent = parentId ? finalById.get(parentId) : undefined
    if (parent) connectorSkeletons.push(connectorSkeleton(parent, rect))
  }
  const newConnectors = convertToExcalidrawElements(connectorSkeletons, { regenerateIds: true })

  const withoutConnectors = working.filter(
    (el) => !(el.type === 'line' && el.customData?.mindmap?.connector),
  )

  const positions = new Map<string, { x: number; y: number }>()
  for (const rect of finalRects) positions.set(rect.id, { x: rect.x, y: rect.y })

  return { elements: [...withoutConnectors, ...newConnectors], positions }
}
