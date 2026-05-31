import {
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import { invoke, isTauri } from '@tauri-apps/api/core'
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
  // 桌面端（Tauri）的 webview 不支持 <a download> 下载，改走后端保存对话框。
  if (isTauri()) {
    void saveBlobOnDesktop(blob, filename)
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1)) // 去掉 data:...;base64, 前缀
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function saveBlobOnDesktop(blob: Blob, filename: string): Promise<void> {
  try {
    const dataBase64 = await blobToBase64(blob)
    await invoke('export_file', { filename, dataBase64 })
  } catch {
    window.alert('保存文件失败')
  }
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
