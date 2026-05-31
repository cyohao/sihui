import { useState } from 'react'

type MindMapPanelProps = {
  isOpen: boolean
  onClose: () => void
  onGenerate: (outline: string) => void
}

const SAMPLE = `产品规划
  目标用户
    个人创作者
    小型团队
  核心功能
    无限画布
    思维导图
    导出分享
  发布节奏
    内测
    公测`

export function MindMapPanel({ isOpen, onClose, onGenerate }: MindMapPanelProps) {
  const [outline, setOutline] = useState(SAMPLE)

  if (!isOpen) return null

  return (
    <div className="mindmap-backdrop" onClick={onClose}>
      <div className="mindmap-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="mindmap-header">
          <strong>生成思维导图</strong>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <p className="mindmap-hint">
          每行一个节点，用缩进（空格或 Tab）表示层级。生成后选中任意节点：
          <strong>Tab</strong> 加子节点，<strong>Enter</strong> 加同级，
          <strong>Delete</strong> 删整棵子树，双击改名。顶栏<strong>折叠/展开</strong>收起子树、
          <strong>整理</strong>一键重新排版。拖动节点连线会自动跟随。
        </p>

        <textarea
          className="mindmap-input"
          value={outline}
          spellCheck={false}
          onChange={(event) => setOutline(event.target.value)}
        />

        <div className="mindmap-actions">
          <button className="topbar-button" onClick={onClose}>
            取消
          </button>
          <button
            className="topbar-button mindmap-primary"
            onClick={() => onGenerate(outline)}
          >
            生成
          </button>
        </div>
      </div>
    </div>
  )
}
