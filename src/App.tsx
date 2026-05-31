import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { BoardSidebar } from './components/BoardSidebar'
import { MindMapPanel } from './components/MindMapPanel'
import {
  createScene,
  downloadText,
  exportSceneAsPng,
  exportSceneAsSvg,
  parseScene,
} from './editor/scene'
import {
  collectDescendantRectIds,
  layoutPositions,
  makeNodeElements,
  outlineToElements,
  readMindNodes,
  reconcileMindMap,
  rectSignature,
} from './editor/mindmap'
import {
  createBackup,
  createBoard,
  getLastBoardId,
  hasDesktopFileStorage,
  listBoards,
  openDataDirectory,
  parseBackup,
  putBoard,
  removeBoard,
  restoreBackup,
  setLastBoardId,
} from './storage/boards'
import type { Board, BoardScene, SaveState } from './types'

const SAVE_DELAY = 350

type MindRect = ExcalidrawElement & {
  containerId?: string | null
  customData?: {
    mindmap?: {
      parentId?: string | null
      depth?: number
      connector?: boolean
      collapsed?: boolean
      stash?: ExcalidrawElement[]
    }
  } | null
}

function fileSafeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-')
}

function App() {
  const [boards, setBoards] = useState<Board[]>([])
  const [currentBoard, setCurrentBoard] = useState<Board | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mindMapOpen, setMindMapOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [loading, setLoading] = useState(true)
  const editorApi = useRef<ExcalidrawImperativeAPI | null>(null)
  const pendingScene = useRef<BoardScene | null>(null)
  const saveTimer = useRef<number | null>(null)
  const importInput = useRef<HTMLInputElement | null>(null)
  const backupInput = useRef<HTMLInputElement | null>(null)
  // 思维导图对账状态：节点位置签名 + 上一帧各节点位置（用于检测拖动）。
  const mindSig = useRef('')
  const mindPositions = useRef<Map<string, { x: number; y: number }>>(new Map())

  const refreshBoards = useCallback(async () => {
    setBoards(await listBoards())
  }, [])

  const saveCurrentBoard = useCallback(async (): Promise<Board | null> => {
    if (!currentBoard || !pendingScene.current) return currentBoard

    const updatedBoard = {
      ...currentBoard,
      scene: pendingScene.current,
      updatedAt: Date.now(),
    }

    try {
      await putBoard(updatedBoard)
      pendingScene.current = null
      setCurrentBoard(updatedBoard)
      await refreshBoards()
      setSaveState('saved')
      return updatedBoard
    } catch {
      setSaveState('error')
      return null
    }
  }, [currentBoard, refreshBoards])

  const flushSave = useCallback(async (): Promise<Board | null> => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }

    return saveCurrentBoard()
  }, [saveCurrentBoard])

  useEffect(() => {
    async function initialize() {
      let storedBoards = await listBoards()

      if (storedBoards.length === 0) {
        const firstBoard = createBoard()
        await putBoard(firstBoard)
        storedBoards = [firstBoard]
      }

      const lastBoardId = getLastBoardId()
      const initialBoard =
        storedBoards.find((board) => board.id === lastBoardId) ?? storedBoards[0]

      setBoards(storedBoards)
      setCurrentBoard(initialBoard)
      setLastBoardId(initialBoard.id)
      setLoading(false)
    }

    void initialize()
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    const handlePageHide = () => {
      if (!currentBoard || !pendingScene.current) return
      void putBoard({
        ...currentBoard,
        scene: pendingScene.current,
        updatedAt: Date.now(),
      })
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [currentBoard])

  // 切换白板时重置思维导图对账状态，避免沿用上一个白板的节点位置。
  useEffect(() => {
    mindSig.current = ''
    mindPositions.current = new Map()
  }, [currentBoard?.id])

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      // 思维导图对账：节点位置变化时（拖动/增删/折叠），重建连线并带动子树。
      const api = editorApi.current
      if (api) {
        const sig = rectSignature(elements)
        if (sig !== mindSig.current) {
          const result = reconcileMindMap(elements, mindPositions.current)
          mindPositions.current = result.positions
          mindSig.current = rectSignature(result.elements)
          api.updateScene({
            elements: result.elements,
            captureUpdate: CaptureUpdateAction.NEVER,
          })
          // 由 updateScene 触发的下一次 onChange 负责落盘，这里直接返回避免重复。
          return
        }
      }

      pendingScene.current = createScene(elements, appState, files)
      setSaveState('saving')

      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null
        void saveCurrentBoard()
      }, SAVE_DELAY)
    },
    [saveCurrentBoard],
  )

  async function selectBoard(id: string) {
    await flushSave()
    const selected = boards.find((board) => board.id === id)
    if (!selected) return
    setCurrentBoard(selected)
    setLastBoardId(selected.id)
    setSidebarOpen(false)
  }

  async function addBoard() {
    await flushSave()
    const board = createBoard()
    await putBoard(board)
    await refreshBoards()
    setCurrentBoard(board)
    setLastBoardId(board.id)
    setSidebarOpen(false)
  }

  async function renameBoard(board: Board) {
    const title = window.prompt('请输入白板名称', board.title)?.trim()
    if (!title || title === board.title) return

    const savedBoard = currentBoard?.id === board.id ? await flushSave() : null
    const updated = { ...(savedBoard ?? board), title, updatedAt: Date.now() }
    await putBoard(updated)
    if (currentBoard?.id === updated.id) setCurrentBoard(updated)
    await refreshBoards()
  }

  async function deleteBoard(board: Board) {
    if (!window.confirm(`确认删除“${board.title}”吗？此操作无法撤销。`)) return

    await flushSave()
    await removeBoard(board.id)
    let remainingBoards = await listBoards()

    if (remainingBoards.length === 0) {
      const replacement = createBoard()
      await putBoard(replacement)
      remainingBoards = [replacement]
    }

    setBoards(remainingBoards)

    if (currentBoard?.id === board.id) {
      setCurrentBoard(remainingBoards[0])
      setLastBoardId(remainingBoards[0].id)
    }
  }

  async function exportJson() {
    const board = await flushSave()
    if (!board) return
    downloadText(
      JSON.stringify(board.scene, null, 2),
      `${fileSafeName(board.title)}.sihui.json`,
    )
  }

  async function exportImage(format: 'png' | 'svg') {
    const board = await flushSave()
    if (!board) return

    try {
      if (format === 'png') await exportSceneAsPng(board.scene)
      else await exportSceneAsSvg(board.scene)
    } catch {
      window.alert('导出失败，请确认画布中有可导出的内容。')
    }
  }

  async function importJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const scene = parseScene(await file.text())
      await flushSave()
      const board = {
        ...createBoard(file.name.replace(/\.(?:excalidraw|sihui)(?:\.json)?$/i, '')),
        scene,
      }
      await putBoard(board)
      await refreshBoards()
      setCurrentBoard(board)
      setLastBoardId(board.id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '导入失败')
    }
  }

  async function exportBackup() {
    await flushSave()
    downloadText(createBackup(await listBoards()), '思绘数据备份.json')
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      await flushSave()
      let restoredBoards = parseBackup(await file.text())

      if (restoredBoards.length === 0) {
        restoredBoards = [createBoard()]
      }

      await restoreBackup(restoredBoards)
      await refreshBoards()
      setCurrentBoard(restoredBoards[0])
      setLastBoardId(restoredBoards[0].id)
      window.alert('全部白板已恢复')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '恢复失败')
    }
  }

  function generateMindMap(outline: string) {
    const api = editorApi.current
    if (!api) return

    try {
      const newElements = outlineToElements(outline)
      if (newElements.length === 0) return

      const existing = api.getSceneElements()
      api.updateScene({ elements: [...existing, ...newElements] })
      api.scrollToContent(newElements, { fitToContent: true, animate: true })
      setMindMapOpen(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '生成失败')
    }
  }

  // 取当前选中的唯一思维导图节点（矩形），否则返回 null。
  function getSelectedMindRect() {
    const api = editorApi.current
    if (!api) return null
    const appState = api.getAppState()
    const selectedIds = Object.keys(appState.selectedElementIds ?? {}).filter(
      (id) => appState.selectedElementIds[id],
    )
    if (selectedIds.length !== 1) return null
    const el = api
      .getSceneElements()
      .find((item) => item.id === selectedIds[0]) as MindRect | undefined
    if (!el || el.type !== 'rectangle' || !el.customData?.mindmap || el.customData.mindmap.connector) {
      return null
    }
    return el
  }

  // Tab=添加子节点，Enter=添加同级节点。新增后整张图自动重新排版。
  const addRelatedNode = useCallback((kind: 'child' | 'sibling'): boolean => {
    const api = editorApi.current
    if (!api) return false
    const sel = getSelectedMindRect()
    if (!sel) return false

    const selMind = sel.customData!.mindmap!
    const parentId = kind === 'child' ? sel.id : selMind.parentId ?? null

    const elements = api.getSceneElements() as MindRect[]
    const nodes = readMindNodes(elements)
    const selIdx = nodes.findIndex((node) => node.id === sel.id)
    if (selIdx < 0) return false

    // 插入到选中节点子树之后：child 成为其最后一个子节点，sibling 成为其下一个兄弟。
    const subtree = new Set<string>([sel.id])
    let insertAt = selIdx
    for (let i = selIdx + 1; i < nodes.length; i += 1) {
      const pid = nodes[i].parentId
      if (pid && subtree.has(pid)) {
        subtree.add(nodes[i].id)
        insertAt = i
      }
    }
    const newId = crypto.randomUUID()
    nodes.splice(insertAt + 1, 0, { id: newId, parentId, text: '新节点' })

    const placed = layoutPositions(nodes)
    // 以第一个根节点的当前位置为锚点，避免整张图跳到远处。
    const rootId = nodes.find((node) => !node.parentId)?.id
    const rootRect = rootId ? elements.find((el) => el.id === rootId) : undefined
    const rootTarget = rootId ? placed.get(rootId) : undefined
    const offsetX = rootRect && rootTarget ? rootRect.x - rootTarget.x : 0
    const offsetY = rootRect && rootTarget ? rootRect.y - rootTarget.y : 0

    const targetById = new Map<string, { x: number; y: number }>()
    for (const [id, pos] of placed) targetById.set(id, { x: pos.x + offsetX, y: pos.y + offsetY })

    const repositioned = elements.map((el) => {
      const target = targetById.get(el.id)
      if (target && el.type === 'rectangle') return { ...el, x: target.x, y: target.y }
      if (el.type === 'text' && el.containerId && targetById.has(el.containerId)) {
        const container = elements.find((item) => item.id === el.containerId)!
        const t = targetById.get(el.containerId)!
        return { ...el, x: el.x + (t.x - container.x), y: el.y + (t.y - container.y) }
      }
      return el
    })

    const newPlaced = placed.get(newId)!
    const newPos = targetById.get(newId)!
    const newEls = makeNodeElements({
      id: newId,
      parentId,
      text: '新节点',
      depth: newPlaced.depth,
      x: newPos.x,
      y: newPos.y,
    })

    const combined = [...repositioned, ...newEls] as ExcalidrawElement[]
    // 自行重建连线并对齐对账状态，避免 onChange 把整张图当成拖动再平移一遍。
    const newPositions = new Map<string, { x: number; y: number }>()
    for (const el of combined as MindRect[]) {
      if (el.type === 'rectangle' && el.customData?.mindmap && !el.customData.mindmap.connector) {
        newPositions.set(el.id, { x: el.x, y: el.y })
      }
    }
    const result = reconcileMindMap(combined, newPositions)
    mindPositions.current = result.positions
    mindSig.current = rectSignature(result.elements)
    api.updateScene({
      elements: result.elements,
      appState: { selectedElementIds: { [newId]: true } },
    })
    return true
  }, [])

  // 折叠/展开选中节点的子树。
  const toggleCollapse = useCallback(() => {
    const api = editorApi.current
    if (!api) return
    const sel = getSelectedMindRect()
    if (!sel) {
      window.alert('请先选中一个思维导图节点')
      return
    }

    const selMind = sel.customData!.mindmap!
    const elements = api.getSceneElements() as MindRect[]
    const stash = selMind.stash

    if (stash && stash.length > 0) {
      // 展开：还原暂存的子树元素。
      const restored = elements.map((el) =>
        el.id === sel.id
          ? ({
              ...el,
              strokeStyle: 'solid',
              customData: { ...el.customData, mindmap: { ...selMind, collapsed: false, stash: undefined } },
            } as MindRect)
          : el,
      )
      api.updateScene({
        elements: [...restored, ...stash] as ExcalidrawElement[],
        appState: { selectedElementIds: { [sel.id]: true } },
      })
      return
    }

    // 折叠：把后代矩形 + 其绑定文字暂存进本节点，从画布移除。
    const descIds = new Set(collectDescendantRectIds(elements, sel.id))
    if (descIds.size === 0) {
      window.alert('该节点没有子节点')
      return
    }
    const toStash = elements.filter(
      (el) => descIds.has(el.id) || (el.type === 'text' && descIds.has(el.containerId ?? '')),
    )
    const stashIds = new Set(toStash.map((el) => el.id))
    const remaining = elements
      .filter((el) => !stashIds.has(el.id))
      .map((el) =>
        el.id === sel.id
          ? ({
              ...el,
              strokeStyle: 'dashed',
              customData: { ...el.customData, mindmap: { ...selMind, collapsed: true, stash: toStash } },
            } as MindRect)
          : el,
      )
    api.updateScene({
      elements: remaining as ExcalidrawElement[],
      appState: { selectedElementIds: { [sel.id]: true } },
    })
  }, [])

  // 删除选中节点及其整棵子树（连同绑定文字）。返回是否处理了该按键。
  const deleteSelectedSubtree = useCallback((): boolean => {
    const api = editorApi.current
    if (!api) return false

    const appState = api.getAppState()
    const selectedIds = Object.keys(appState.selectedElementIds ?? {}).filter(
      (id) => appState.selectedElementIds[id],
    )
    if (selectedIds.length === 0) return false

    const elements = api.getSceneElements() as MindRect[]
    const byId = new Map(elements.map((el) => [el.id, el]))
    const selectedRects = selectedIds.map((id) => byId.get(id)).filter(Boolean) as MindRect[]
    // 仅当选中的全是思维导图节点时才接管删除，否则交给 Excalidraw 默认行为。
    const allMindNodes =
      selectedRects.length === selectedIds.length &&
      selectedRects.length > 0 &&
      selectedRects.every(
        (el) => el.type === 'rectangle' && el.customData?.mindmap && !el.customData.mindmap.connector,
      )
    if (!allMindNodes) return false

    const removeRectIds = new Set<string>()
    for (const rect of selectedRects) {
      removeRectIds.add(rect.id)
      for (const desc of collectDescendantRectIds(elements, rect.id)) removeRectIds.add(desc)
    }

    const removeIds = new Set<string>()
    for (const el of elements) {
      if (removeRectIds.has(el.id)) removeIds.add(el.id)
      else if (el.type === 'text' && el.containerId && removeRectIds.has(el.containerId)) {
        removeIds.add(el.id)
      }
    }

    // 删除后选中第一个被删节点的父节点（若仍存在）。
    const parentId = selectedRects[0].customData?.mindmap?.parentId ?? null
    const selectParent = parentId && !removeRectIds.has(parentId)
    const remaining = elements.filter((el) => !removeIds.has(el.id))
    api.updateScene({
      elements: remaining as ExcalidrawElement[],
      appState: { selectedElementIds: selectParent ? { [parentId]: true } : {} },
    })
    return true
  }, [])

  // 一键重新排版：按 tidy-tree 重新计算所有可见节点位置（保留文字、折叠状态等）。
  const tidyLayout = useCallback(() => {
    const api = editorApi.current
    if (!api) return

    const elements = api.getSceneElements() as MindRect[]
    const nodes = readMindNodes(elements)
    if (nodes.length === 0) {
      window.alert('当前白板没有思维导图')
      return
    }

    const placed = layoutPositions(nodes)
    // 以第一个根节点的当前位置为锚点，避免整张图跳到远处。
    const rootId = nodes.find((node) => !node.parentId)?.id
    const rootRect = rootId ? elements.find((el) => el.id === rootId) : undefined
    const rootTarget = rootId ? placed.get(rootId) : undefined
    const offsetX = rootRect && rootTarget ? rootRect.x - rootTarget.x : 0
    const offsetY = rootRect && rootTarget ? rootRect.y - rootTarget.y : 0

    const targetById = new Map<string, { x: number; y: number }>()
    for (const [id, pos] of placed) targetById.set(id, { x: pos.x + offsetX, y: pos.y + offsetY })

    const repositioned = elements.map((el) => {
      const target = targetById.get(el.id)
      if (target && el.type === 'rectangle') return { ...el, x: target.x, y: target.y }
      if (el.type === 'text' && el.containerId && targetById.has(el.containerId)) {
        const container = elements.find((item) => item.id === el.containerId)!
        const target2 = targetById.get(el.containerId)!
        return { ...el, x: el.x + (target2.x - container.x), y: el.y + (target2.y - container.y) }
      }
      return el
    })

    // 自行重建连线，并把对账状态对齐到新位置，避免 onChange 再次把子树平移一遍。
    const newPositions = new Map<string, { x: number; y: number }>()
    for (const el of repositioned) {
      if (el.type === 'rectangle' && el.customData?.mindmap && !el.customData.mindmap.connector) {
        newPositions.set(el.id, { x: el.x, y: el.y })
      }
    }
    const result = reconcileMindMap(repositioned as ExcalidrawElement[], newPositions)
    mindPositions.current = result.positions
    mindSig.current = rectSignature(result.elements)
    api.updateScene({ elements: result.elements })
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isAddKey = event.key === 'Tab' || event.key === 'Enter'
      const isDeleteKey = event.key === 'Delete' || event.key === 'Backspace'
      if (!isAddKey && !isDeleteKey) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      const handled = isAddKey
        ? addRelatedNode(event.key === 'Tab' ? 'child' : 'sibling')
        : deleteSelectedSubtree()

      if (handled) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [addRelatedNode, deleteSelectedSubtree])

  if (loading || !currentBoard) {
    return <main className="loading-screen">正在打开白板...</main>
  }

  return (
    <main className="app-shell">
      <div className="editor-shell">
        <Excalidraw
          key={currentBoard.id}
          excalidrawAPI={(api) => {
            editorApi.current = api
          }}
          initialData={currentBoard.scene}
          langCode="zh-CN"
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: true,
            },
          }}
        />
      </div>

      <header className="topbar">
        <button className="topbar-button" onClick={() => setSidebarOpen(true)}>
          ☰ 白板
        </button>
        <strong className="board-title">{currentBoard.title}</strong>
        <span className={`save-state save-state-${saveState}`}>
          {saveState === 'saved' && '已保存'}
          {saveState === 'saving' && '保存中...'}
          {saveState === 'error' && '保存失败'}
        </span>
        <div className="topbar-spacer" />
        <button className="topbar-button" onClick={() => setMindMapOpen(true)}>
          思维导图
        </button>
        <button className="topbar-button" onClick={toggleCollapse}>
          折叠/展开
        </button>
        <button className="topbar-button" onClick={tidyLayout}>
          整理
        </button>
        <button className="topbar-button" onClick={() => importInput.current?.click()}>
          导入
        </button>
        {hasDesktopFileStorage() && (
          <button className="topbar-button" onClick={() => void openDataDirectory()}>
            数据目录
          </button>
        )}
        <button className="topbar-button" onClick={() => void exportBackup()}>
          备份全部
        </button>
        <button className="topbar-button" onClick={() => backupInput.current?.click()}>
          恢复全部
        </button>
        <button className="topbar-button" onClick={exportJson}>
          导出 JSON
        </button>
        <button className="topbar-button" onClick={() => void exportImage('png')}>
          PNG
        </button>
        <button className="topbar-button" onClick={() => void exportImage('svg')}>
          SVG
        </button>
      </header>

      <input
        ref={importInput}
        className="hidden-input"
        type="file"
        accept=".sihui,.excalidraw,.json,application/json"
        onChange={importJson}
      />
      <input
        ref={backupInput}
        className="hidden-input"
        type="file"
        accept=".json,application/json"
        onChange={importBackup}
      />

      <MindMapPanel
        isOpen={mindMapOpen}
        onClose={() => setMindMapOpen(false)}
        onGenerate={generateMindMap}
      />

      <BoardSidebar
        boards={boards}
        currentBoardId={currentBoard.id}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCreate={() => void addBoard()}
        onDelete={(board) => void deleteBoard(board)}
        onRename={(board) => void renameBoard(board)}
        onSelect={(id) => void selectBoard(id)}
      />
    </main>
  )
}

export default App
