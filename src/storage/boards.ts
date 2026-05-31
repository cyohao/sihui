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

let desktopBoards: Board[] | null = null

async function listBrowserBoards(): Promise<Board[]> {
  const database = await dbPromise
  return database.getAll(STORE_NAME)
}

async function writeDesktopBoards(boards: Board[]): Promise<void> {
  await invoke('save_boards_file', {
    content: JSON.stringify({ version: 1, boards }, null, 2),
  })
  desktopBoards = boards
}

async function listDesktopBoards(): Promise<Board[]> {
  if (desktopBoards) return desktopBoards

  const content = await invoke<string | null>('load_boards_file')
  if (content) {
    const boards = parseBackup(content)
    if (boards.length > 0) {
      desktopBoards = boards
      return desktopBoards
    }
  }

  // First desktop launch: keep existing browser data if the user has any.
  desktopBoards = await listBrowserBoards()
  await writeDesktopBoards(desktopBoards)
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
    const nextBoards = boards.filter((item) => item.id !== board.id)
    nextBoards.push(board)
    await writeDesktopBoards(nextBoards)
    return
  }

  const database = await dbPromise
  await database.put(STORE_NAME, board)
}

export async function removeBoard(id: string): Promise<void> {
  if (isTauri()) {
    const boards = await listDesktopBoards()
    await writeDesktopBoards(boards.filter((board) => board.id !== id))
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
    await writeDesktopBoards(boards)
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
