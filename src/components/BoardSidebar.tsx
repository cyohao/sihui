import type { Board } from '../types'

type BoardSidebarProps = {
  boards: Board[]
  currentBoardId: string
  isOpen: boolean
  onClose: () => void
  onCreate: () => void
  onDelete: (board: Board) => void
  onRename: (board: Board) => void
  onSelect: (id: string) => void
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function BoardSidebar({
  boards,
  currentBoardId,
  isOpen,
  onClose,
  onCreate,
  onDelete,
  onRename,
  onSelect,
}: BoardSidebarProps) {
  return (
    <>
      {isOpen && <button className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <header className="sidebar-header">
          <div>
            <strong>我的白板</strong>
            <span>{boards.length} 个本地白板</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <button className="new-board-button" onClick={onCreate}>
          + 新建白板
        </button>

        <div className="board-list">
          {boards.map((board) => (
            <article
              className={`board-card ${
                board.id === currentBoardId ? 'board-card-active' : ''
              }`}
              key={board.id}
            >
              <button className="board-main" onClick={() => onSelect(board.id)}>
                <strong>{board.title}</strong>
                <span>{formatDate(board.updatedAt)}</span>
              </button>
              <div className="board-actions">
                <button onClick={() => onRename(board)}>重命名</button>
                <button onClick={() => onDelete(board)}>删除</button>
              </div>
            </article>
          ))}
        </div>
      </aside>
    </>
  )
}
