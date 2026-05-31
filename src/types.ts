import type {
  AppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

export type BoardScene = {
  type: 'excalidraw'
  version: number
  source: string
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export type Board = {
  id: string
  title: string
  scene: BoardScene
  createdAt: number
  updatedAt: number
}

export type SaveState = 'saved' | 'saving' | 'error'
