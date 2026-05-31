import { invoke, isTauri } from '@tauri-apps/api/core'
import { openDB } from 'idb'
import type { Board, BoardScene } from '../types'

const DATABASE_NAME = 'baiban'
const STORE_NAME = 'boards'
const LAST_BOARD_KEY = 'baiban:last-board'

const dbPromise = openDB(DATABASE_NAME, 1, {
  upgrade(database) {
    const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
    store.createIndex('updatedAt', 'updatedAt')
  },
})

// 桌面端：一个白板一个文件（思绘数据/boards/<id>.json），内存缓存避免重复读盘。
let desktopBoards: Board[] | null = null

async function listBrowserBoards(): Promise<Board[]> {
  const database = await dbPromise
  return database.getAll(STORE_NAME)
}

async function saveDesktopBoardFile(board: Board): Promise<void> {
  await invoke('save_board_file', {
    id: board.id,
    content: JSON.stringify(board, null, 2),
  })
}

async function listDesktopBoards(): Promise<Board[]> {
  if (desktopBoards) return desktopBoards

  const contents = await invoke<string[]>('list_board_files')
  const boards: Board[] = []
  for (const content of contents) {
    try {
      boards.push(JSON.parse(content) as Board)
    } catch {
      // 跳过损坏的文件
    }
  }

  // 全新桌面端（无文件、无旧 boards.json）：迁移浏览器里已有的数据。
  if (boards.length === 0) {
    const browserBoards = await listBrowserBoards()
    if (browserBoards.length > 0) {
      for (const board of browserBoards) await saveDesktopBoardFile(board)
      desktopBoards = browserBoards
      return desktopBoards
    }
  }

  desktopBoards = boards
  return desktopBoards
}

export function createEmptyScene(): BoardScene {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'baiban',
    elements: [],
    appState: {},
    files: {},
  }
}

export function createBoard(title = '未命名白板'): Board {
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    title,
    scene: createEmptyScene(),
    createdAt: now,
    updatedAt: now,
  }
}

export async function listBoards(): Promise<Board[]> {
  const boards = isTauri() ? await listDesktopBoards() : await listBrowserBoards()
  return [...boards].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function putBoard(board: Board): Promise<void> {
  if (isTauri()) {
    const boards = await listDesktopBoards()
    desktopBoards = [...boards.filter((item) => item.id !== board.id), board]
    await saveDesktopBoardFile(board)
    return
  }

  const database = await dbPromise
  await database.put(STORE_NAME, board)
}

export async function removeBoard(id: string): Promise<void> {
  if (isTauri()) {
    const boards = await listDesktopBoards()
    desktopBoards = boards.filter((board) => board.id !== id)
    await invoke('delete_board_file', { id })
    return
  }

  const database = await dbPromise
  await database.delete(STORE_NAME, id)
}

export function getLastBoardId(): string | null {
  return localStorage.getItem(LAST_BOARD_KEY)
}

export function setLastBoardId(id: string): void {
  localStorage.setItem(LAST_BOARD_KEY, id)
}

export function createBackup(boards: Board[]): string {
  return JSON.stringify({ version: 1, boards }, null, 2)
}

export function parseBackup(content: string): Board[] {
  const value = JSON.parse(content) as { version?: number; boards?: unknown }
  if (!Array.isArray(value.boards)) {
    throw new Error('备份文件格式不正确')
  }

  return value.boards as Board[]
}

export async function restoreBackup(boards: Board[]): Promise<void> {
  if (isTauri()) {
    await invoke('clear_board_files')
    for (const board of boards) await saveDesktopBoardFile(board)
    desktopBoards = boards
    return
  }

  const database = await dbPromise
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  await transaction.store.clear()
  await Promise.all(boards.map((board) => transaction.store.put(board)))
  await transaction.done
}

export function hasDesktopFileStorage(): boolean {
  return isTauri()
}

export async function getDataDirectory(): Promise<string | null> {
  return isTauri() ? invoke<string>('get_data_directory') : null
}

export async function openDataDirectory(): Promise<void> {
  if (isTauri()) await invoke('open_data_directory')
}
