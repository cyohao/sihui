import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
const destination = resolve('public/excalidraw-assets/fonts')

await rm(destination, { force: true, recursive: true })
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true })
