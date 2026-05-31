import { useCallback, useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { BoardSidebar } from './components/BoardSidebar'
import {
  createScene,
  downloadText,
  exportSceneAsPng,
  exportSceneAsSvg,
  parseScene,
} from './editor/scene'
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

function fileSafeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-')
}

function App() {
  const [boards, setBoards] = useState<Board[]>([])
  const [currentBoard, setCurrentBoard] = useState<Board | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [loading, setLoading] = useState(true)
  const editorApi = useRef<ExcalidrawImperativeAPI | null>(null)
  const pendingScene = useRef<BoardScene | null>(null)
  const saveTimer = useRef<number | null>(null)
  const importInput = useRef<HTMLInputElement | null>(null)
  const backupInput = useRef<HTMLInputElement | null>(null)

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

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
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
