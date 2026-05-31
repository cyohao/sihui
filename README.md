# sihui

本地优先的轻量白板应用。打开页面即可使用，画布数据保存在浏览器 IndexedDB 中。

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

将 `dist/` 部署到任意静态文件服务即可。首次在线访问后，PWA 会缓存应用资源，后续可离线打开。

## Windows 桌面应用

桌面版本使用 Tauri 2，仅加载构建后的本地资源，不依赖 CDN。

```bash
npm run tauri dev
npm run tauri build
```

Windows 安装包会生成在 `src-tauri/target/release/bundle/`。

桌面版会自动将全部白板保存到用户文档目录：

```text
文档\思绘数据\boards.json
```

工具栏中的“数据目录”可以直接打开该文件夹。“备份全部”和“恢复全部”用于迁移到其他电脑。浏览器版本仍使用 IndexedDB。

## 当前功能

- 无限画布、画笔、图形、文本、箭头、图片、撤销和重做
- 新建、切换、重命名和删除本地白板
- IndexedDB 自动保存
- 导入和导出 `.sihui.json`，并兼容已有 `.excalidraw` 文件
- 导出 PNG 和 SVG
- PWA 安装和离线缓存
