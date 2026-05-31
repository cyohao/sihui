import {
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BoardScene } from '../types'

export function createScene(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): BoardScene {
  return JSON.parse(
    serializeAsJSON(elements, appState, files, 'local'),
  ) as BoardScene
}

export function parseScene(value: string): BoardScene {
  const scene = JSON.parse(value) as Partial<BoardScene>

  if (
    scene.type !== 'excalidraw' ||
    !Array.isArray(scene.elements) ||
    typeof scene.appState !== 'object' ||
    typeof scene.files !== 'object'
  ) {
    throw new Error('文件不是有效的白板文件')
  }

  return scene as BoardScene
}

export function downloadText(text: string, filename: string): void {
  downloadBlob(new Blob([text], { type: 'application/json' }), filename)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export async function exportSceneAsPng(scene: BoardScene): Promise<void> {
  const blob = await exportToBlob({
    elements: scene.elements,
    appState: { ...scene.appState, exportBackground: true },
    files: scene.files,
    mimeType: 'image/png',
  })

  downloadBlob(blob, '白板.png')
}

export async function exportSceneAsSvg(scene: BoardScene): Promise<void> {
  const svg = await exportToSvg({
    elements: scene.elements,
    appState: { ...scene.appState, exportBackground: true },
    files: scene.files,
  })

  downloadBlob(
    new Blob([svg.outerHTML], { type: 'image/svg+xml' }),
    '白板.svg',
  )
}
