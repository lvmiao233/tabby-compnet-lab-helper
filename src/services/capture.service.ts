import { Injectable, NgZone, Injector, Component } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'
import { AppService, ThemesService } from 'tabby-core'

// xterm.js类型定义
interface IBuffer {
    getLine(y: number): IBufferLine | undefined
    length: number
}

interface IBufferLine {
    translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string
    isWrapped: boolean
    length: number
}

interface ITerminal {
    buffer: {
        active: IBuffer
        normal: IBuffer
    }
    rows: number
    cols: number
}

export interface CaptureBlock {
    id: string
    lineStart: number
    lineEnd: number
    content: string
    selected: boolean
    command?: string // 提取的命令部分
    output?: string  // 提取的输出部分
    selectedLines?: boolean[] // 按行选择模式下每一行的选择状态
}

// 选择窗口组件
@Component({
    template: `
        <div class="netty-selection-modal">
            <div class="netty-modal-header">
                <h3>选择要导出的命令区块</h3>
                <button class="netty-close-btn" (click)="close()">×</button>
            </div>

            <div class="netty-modal-body">
                <div class="netty-stats">
                    <span>共发现 {{ blocks.length }} 个命令区块</span>
                </div>

                <div class="netty-blocks-list">
                    <div *ngFor="let block of blocks; let i = index"
                         class="netty-block-item"
                         [class.selected]="block.selected"
                         (click)="toggleBlockSelection(block)">

                        <div class="netty-block-header">
                            <input type="checkbox"
                                   [checked]="block.selected"
                                   (change)="toggleBlockSelection(block)"
                                   (click)="$event.stopPropagation()">
                            <span class="netty-block-title">
                                区块 {{ i + 1 }} (行 {{ block.lineStart }}-{{ block.lineEnd }})
                            </span>
                        </div>

                        <div class="netty-block-content">
                            <div class="netty-command" *ngIf="block.command">
                                <strong>命令:</strong> {{ block.command }}
                            </div>
                            <div class="netty-output" *ngIf="block.output">
                                <strong>输出:</strong>
                                <pre>{{ block.output.length > 200 ? block.output.substring(0, 200) + '...' : block.output }}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="netty-modal-footer">
                <button class="netty-btn netty-btn-secondary" (click)="selectAll()">全选</button>
                <button class="netty-btn netty-btn-secondary" (click)="clearAll()">清空</button>
                <button class="netty-btn netty-btn-primary" (click)="copyToClipboard()" [disabled]="getSelectedCount() === 0">
                    📋 复制到剪贴板 ({{ getSelectedCount() }})
                </button>
                <button class="netty-btn netty-btn-success" (click)="downloadAndCopy()" [disabled]="getSelectedCount() === 0">
                    💾 下载并复制 ({{ getSelectedCount() }})
                </button>
                <button class="netty-btn netty-btn-cancel" (click)="close()">取消</button>
            </div>
        </div>
    `,
    styles: [`
        .netty-selection-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            max-width: 800px;
            max-height: 80vh;
            width: 90%;
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        .netty-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px;
            border-bottom: 1px solid #e0e0e0;
            background: #f8f9fa;
            border-radius: 8px 8px 0 0;
        }

        .netty-modal-header h3 {
            margin: 0;
            color: #333;
            font-size: 18px;
            font-weight: 600;
        }

        .netty-close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background-color 0.2s;
        }

        .netty-close-btn:hover {
            background: #e0e0e0;
        }

        .netty-modal-body {
            padding: 20px;
            max-height: 50vh;
            overflow-y: auto;
        }

        .netty-stats {
            margin-bottom: 15px;
            color: #666;
            font-size: 14px;
        }

        .netty-blocks-list {
            max-height: 40vh;
            overflow-y: auto;
        }

        .netty-block-item {
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .netty-block-item:hover {
            border-color: #4CAF50;
            box-shadow: 0 2px 8px rgba(76, 175, 80, 0.1);
        }

        .netty-block-item.selected {
            border-color: #4CAF50;
            background: #E8F5E8;
        }

        .netty-block-header {
            display: flex;
            align-items: center;
            padding: 12px 15px;
            border-bottom: 1px solid #f0f0f0;
            background: #fafafa;
            border-radius: 6px 6px 0 0;
        }

        .netty-block-header input[type="checkbox"] {
            margin-right: 10px;
        }

        .netty-block-title {
            font-weight: 500;
            color: #333;
        }

        .netty-block-content {
            padding: 12px 15px;
        }

        .netty-command {
            margin-bottom: 8px;
            color: #2E7D32;
            font-family: 'Consolas', 'Monaco', monospace;
        }

        .netty-output {
            color: #555;
        }

        .netty-output pre {
            background: #f5f5f5;
            padding: 8px;
            border-radius: 4px;
            margin: 5px 0 0 0;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 100px;
            overflow-y: auto;
        }

        .netty-modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 20px;
            border-top: 1px solid #e0e0e0;
            background: #f8f9fa;
            border-radius: 0 0 8px 8px;
        }

        .netty-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .netty-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .netty-btn-primary {
            background: #4CAF50;
            color: white;
        }

        .netty-btn-primary:hover:not(:disabled) {
            background: #45a049;
        }

        .netty-btn-secondary {
            background: #f5f5f5;
            color: #333;
            border: 1px solid #ddd;
        }

        .netty-btn-secondary:hover {
            background: #e8f5e8;
            border-color: #4CAF50;
        }

        .netty-btn-cancel {
            background: #f44336;
            color: white;
        }

        .netty-btn-cancel:hover {
            background: #d32f2f;
        }

        .netty-btn-success {
            background: #4CAF50;
            color: white;
        }

        .netty-btn-success:hover {
            background: #45a049;
        }
    `]
})
export class BlockSelectionModalComponent {
    blocks: CaptureBlock[] = []
    onConfirm?: (selectedBlocks: CaptureBlock[]) => void
    onCopyToClipboard?: (selectedBlocks: CaptureBlock[]) => void
    onDownloadAndCopy?: (selectedBlocks: CaptureBlock[]) => void
    onClose?: () => void

    toggleBlockSelection(block: CaptureBlock): void {
        block.selected = !block.selected
    }

    selectAll(): void {
        this.blocks.forEach(block => block.selected = true)
    }

    clearAll(): void {
        this.blocks.forEach(block => block.selected = false)
    }

    getSelectedCount(): number {
        return this.blocks.filter(block => block.selected).length
    }

    // 复制到剪贴板
    copyToClipboard(): void {
        const selectedBlocks = this.blocks.filter(block => block.selected)
        if (this.onCopyToClipboard) {
            this.onCopyToClipboard(selectedBlocks)
        }
        // 不关闭窗口，让用户可以继续操作
    }

    // 下载并复制
    downloadAndCopy(): void {
        const selectedBlocks = this.blocks.filter(block => block.selected)
        if (this.onDownloadAndCopy) {
            this.onDownloadAndCopy(selectedBlocks)
        }
        this.close()
    }

    // 兼容旧的confirm方法（保留）
    confirm(): void {
        this.downloadAndCopy()
    }

    close(): void {
        if (this.onClose) {
            this.onClose()
        }
    }
}

@Injectable({
    providedIn: 'root'
})
export class CaptureService {
    private isCaptureModeSubject = new BehaviorSubject<boolean>(false)
    private selectedBlocksSubject = new BehaviorSubject<CaptureBlock[]>([])
    private statusBarElement: HTMLElement | null = null
    private currentBrowseIndex = -1 // 当前浏览的区块索引
    private availableBlocks: CaptureBlock[] = [] // 所有可用的区块
    private selectionMode: 'block' | 'line' = 'block' // 选择模式：按区块或按行
    private themesService: ThemesService | null = null // 主题服务

    public isCaptureMode$: Observable<boolean> = this.isCaptureModeSubject.asObservable()
    public selectedBlocks$: Observable<CaptureBlock[]> = this.selectedBlocksSubject.asObservable()

    constructor(private ngZone: NgZone, private injector: Injector) {
        // 获取主题服务
        try {
            this.themesService = this.injector.get(ThemesService)
            console.log('🎨 主题服务已注入')
        } catch (error) {
            console.warn('⚠️ 无法获取主题服务:', error)
        }
        console.log('📸 CaptureService 初始化')

        // 监听状态变化，更新状态栏
        this.isCaptureMode$.subscribe(isCapture => {
            if (isCapture) {
                this.showStatusBar()
            } else {
                this.hideStatusBar()
            }
        })

        // 监听区块变化，更新状态栏
        this.selectedBlocks$.subscribe(() => {
            if (this.isCaptureModeSubject.value) {
                this.updateStatusBar()
            }
        })
    }

    toggleCaptureMode(): void {
        const currentMode = this.isCaptureModeSubject.value
        const newMode = !currentMode

        this.isCaptureModeSubject.next(newMode)

        if (newMode) {
            console.log('🎯 进入捕获模式')
            this.clearSelection()

            // 自动解析终端缓冲区
            setTimeout(() => {
                this.parseTerminalBuffer()
            }, 100) // 短暂延迟确保状态栏已显示
        } else {
            console.log('✅ 退出捕获模式')
        }
    }

    private showStatusBar(): void {
        if (this.statusBarElement) {
            this.statusBarElement.style.display = 'block'
            this.updateStatusBar()
            return
        }

        // 查找终端内容区域
        const terminalContent = document.querySelector('.content')
        if (!terminalContent) {
            console.warn('⚠️ 找不到终端内容区域')
            return
        }

        // 创建状态栏
        const statusBar = document.createElement('div')
        statusBar.id = 'netty-status-bar'
        statusBar.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 28px;
            background: rgba(0, 0, 0, 0.8);
            color: #ffffff;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            display: flex;
            align-items: center;
            padding: 0 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            z-index: 100;
            backdrop-filter: blur(5px);
        `

                       statusBar.innerHTML = `
                   <span class="netty-status-icon">🎯</span>
                   <span class="netty-status-text">Netty捕获</span>
                   <span class="netty-status-blocks">区块: 0</span>
                   <span class="netty-status-shortcuts">快捷键: Ctrl+方向键浏览, Ctrl+空格选择, Ctrl+A全选, Ctrl+D清空, Enter完成, Esc取消</span>
                   <span class="netty-status-state">状态: 就绪</span>
               `

        // 添加到终端内容区域
        terminalContent.appendChild(statusBar)
        this.statusBarElement = statusBar

        console.log('✅ 状态栏已显示')

        // 绑定键盘事件
        this.bindKeyboardEvents()
    }

    private hideStatusBar(): void {
        if (this.statusBarElement) {
            this.statusBarElement.style.display = 'none'
            console.log('✅ 状态栏已隐藏')
        }
    }

    private updateStatusBar(): void {
        if (!this.statusBarElement) return

        const selectedCount = this.selectedBlocksSubject.value.length
        const totalBlocks = this.availableBlocks.length
        const currentIndex = this.currentBrowseIndex + 1

        let statusText = '状态: 就绪'
        let blocksText = `区块: ${selectedCount}/${totalBlocks}`

        if (this.availableBlocks.length > 0 && this.currentBrowseIndex >= 0) {
            const currentBlock = this.availableBlocks[this.currentBrowseIndex]
            const isSelected = this.selectedBlocksSubject.value.some(b => b.id === currentBlock.id)
            statusText = `浏览中 [${currentIndex}/${totalBlocks}] ${isSelected ? '✅' : '⬜'}`
            blocksText = `选择: ${selectedCount}/${totalBlocks} | 浏览: ${currentIndex}`
        } else if (selectedCount > 0) {
            statusText = `已选择 ${selectedCount} 个区块`
        }

        // 更新状态栏内容
        const blocksElement = this.statusBarElement.querySelector('.netty-status-blocks') as HTMLElement
        const stateElement = this.statusBarElement.querySelector('.netty-status-state') as HTMLElement

        if (blocksElement) blocksElement.textContent = blocksText
        if (stateElement) stateElement.textContent = statusText

        console.log(`🔄 状态栏已更新: ${blocksText} | ${statusText}`)
    }

    private bindKeyboardEvents(): void {
        if (!this.isCaptureModeSubject.value) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!this.isCaptureModeSubject.value) {
                document.removeEventListener('keydown', handleKeyDown)
                return
            }

            switch (event.key) {
                case 'Enter':
                    event.preventDefault()
                    console.log('⏎ Enter键按下 - 完成捕获')
                    this.completeCapture()
                    break
                case 'Escape':
                    event.preventDefault()
                    console.log('⎋ Escape键按下 - 取消捕获')
                    this.toggleCaptureMode()
                    break
                case 'ArrowRight':
                case 'ArrowDown':
                    if (event.ctrlKey || event.metaKey) {
                        event.preventDefault()
                        console.log('→ Ctrl+右箭头 - 浏览下一个区块')
                        this.browseNextBlock()
                    }
                    break
                case 'ArrowLeft':
                case 'ArrowUp':
                    if (event.ctrlKey || event.metaKey) {
                        event.preventDefault()
                        console.log('← Ctrl+左箭头 - 浏览上一个区块')
                        this.browsePreviousBlock()
                    }
                    break
                case ' ': // 空格键
                    if (event.ctrlKey || event.metaKey) {
                        event.preventDefault()
                        console.log('␣ Ctrl+空格 - 选择/取消选择当前区块')
                        this.toggleCurrentBlockSelection()
                    }
                    break
                case 'a':
                case 'A':
                    if (event.ctrlKey || event.metaKey) {
                        event.preventDefault()
                        console.log('🄰 Ctrl+A - 选择所有区块')
                        this.selectAllBlocks()
                    }
                    break
                case 'd':
                case 'D':
                    if (event.ctrlKey || event.metaKey) {
                        event.preventDefault()
                        console.log('🄳 Ctrl+D - 取消所有选择')
                        this.clearAllSelections()
                    }
                    break
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        console.log('⌨️ 键盘事件已绑定')
    }

    // 获取当前终端实例
    private getCurrentTerminal(): ITerminal | null {
        try {
            console.log('🔍 开始获取当前终端实例...')

            // 方法1: 通过AppService获取当前活动标签页
            const appService = this.injector.get(AppService)
            const activeTab = appService.activeTab

            if (!activeTab) {
                console.warn('⚠️ 未找到活动标签页')
                return null
            }

            console.log('✅ 找到活动标签页:', activeTab.constructor.name)

            let targetTab = activeTab

            // 特殊处理：如果当前是SplitTabComponent，获取其聚焦的子标签页
            if (activeTab.constructor.name === 'SplitTabComponent') {
                console.log('🔀 检测到SplitTabComponent，尝试获取聚焦的子标签页')
                const splitTab = activeTab as any
                if (splitTab.focusedTab) {
                    targetTab = splitTab.focusedTab
                    console.log('🎯 获取到聚焦的子标签页:', targetTab.constructor.name)
                } else {
                    // 如果没有聚焦的标签页，获取第一个子标签页
                    const allTabs = splitTab.root?.getAllTabs() || []
                    if (allTabs.length > 0) {
                        targetTab = allTabs[0]
                        console.log('📋 使用第一个子标签页:', targetTab.constructor.name)
                    } else {
                        console.warn('⚠️ SplitTabComponent中没有找到任何子标签页')
                        return null
                    }
                }
            }

            // 检查目标标签页是否是终端标签页
            if (!this.isTerminalTab(targetTab)) {
                console.warn('⚠️ 当前活动标签页不是终端标签页')
                // 尝试备用检查：是否有frontend属性
                if ((targetTab as any).frontend) {
                    console.log('🔄 检测到frontend属性，尝试作为终端处理')
                } else {
                    return null
                }
            }

            // 获取终端组件的frontend
            const terminalComponent = targetTab as any
            if (!terminalComponent.frontend) {
                console.warn('⚠️ 终端组件没有frontend属性')
                return null
            }

            const frontend = terminalComponent.frontend
            console.log('✅ 获取到frontend实例')

            // 从frontend获取xterm实例
            if (!frontend.xterm) {
                console.warn('⚠️ Frontend没有xterm属性')
                return null
            }

            console.log('🎉 成功获取xterm实例!')
            return frontend.xterm as ITerminal

        } catch (error) {
            console.error('❌ 获取终端实例失败:', error)
            return null
        }
    }

    // 检查标签页是否是终端标签页
    private isTerminalTab(tab: any): boolean {
        // 检查类名是否包含Terminal
        const className = tab.constructor.name
        console.log('🔍 检查标签页类型:', className)

        // 扩展检查条件，包含更多可能的终端类型
        const terminalPatterns = [
            'Terminal', 'ConnectableTerminal', 'BaseTerminal',
            'SSHTerminal', 'LocalTerminal', 'SerialTerminal',
            'TelnetTerminal', 'PowerShellTerminal', 'CmdTerminal',
            'BashTerminal', 'ZshTerminal', 'FishTerminal'
        ]

        const isTerminal = terminalPatterns.some(pattern => className.includes(pattern))

        if (!isTerminal) {
            console.log('⚠️ 当前标签页类型不支持:', className)
            console.log('💡 支持的终端类型模式:', terminalPatterns.join(', '))
        } else {
            console.log('✅ 识别为终端标签页:', className)
        }

        return isTerminal
    }





    // 解析终端缓冲区，识别命令交互区块
    parseTerminalBuffer(): void {
        const terminal = this.getCurrentTerminal()
        if (!terminal) {
            console.warn('⚠️ 无法访问终端缓冲区')
            return
        }

        console.log('📊 开始解析终端缓冲区...')
        console.log('🔍 终端信息:', {
            rows: terminal.rows,
            cols: terminal.cols,
            bufferLength: terminal.buffer.active.length
        })

        const buffer = terminal.buffer.active
        const lines: string[] = []

        // 读取缓冲区中的所有行
        console.log('📖 开始读取缓冲区内容...')
        for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i)
            if (line) {
                const lineText = line.translateToString(true)
                if (lineText.trim()) {
                    lines.push(lineText)
                    console.log(`📄 行 ${i}: "${lineText}"`)
                }
            }
        }

        console.log(`📝 总共读取到 ${lines.length} 行有效内容`)
        console.log('📋 完整内容预览:', lines.slice(-10)) // 显示最后10行

        if (lines.length === 0) {
            console.warn('⚠️ 缓冲区为空，可能需要先在终端中输入一些命令')
            return
        }

        // 识别命令交互区块
        console.log('🎯 开始识别命令交互区块...')
        const blocks = this.identifyCommandBlocks(lines)
        console.log(`🎯 识别到 ${blocks.length} 个命令交互区块`)

        // 保存所有可用区块
        this.availableBlocks = blocks
        this.currentBrowseIndex = -1

        // 显示识别到的区块详情
        blocks.forEach((block, index) => {
            console.log(`📦 区块 ${index + 1}:`, {
                id: block.id,
                行范围: `${block.lineStart} - ${block.lineEnd}`,
                内容长度: block.content.length,
                内容预览: block.content.substring(0, 100) + (block.content.length > 100 ? '...' : '')
            })
        })

        // 显示选择窗口
        if (blocks.length > 0) {
            this.showBlockSelectionModal(blocks)
        } else {
            console.log('⚠️ 未识别到任何命令区块')
        }

        console.log('✅ 终端缓冲区解析完成')
        console.log('📊 解析统计:', {
            总行数: lines.length,
            识别区块数: blocks.length,
            当前选择数: this.selectedBlocksSubject.value.length
        })
    }

    // 识别命令交互区块
    private identifyCommandBlocks(lines: string[]): CaptureBlock[] {
        const blocks: CaptureBlock[] = []
        let currentBlock: { start: number, lines: string[] } | null = null

        // 简化的提示符检测：基于模式匹配而不是复杂正则
        // 这个方法会更可靠，因为不依赖于复杂的正则表达式

        console.log('🔍 开始详细分析每一行...')
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const isPrompt = this.isPromptLineSimple(line)

            console.log(`🔍 行 ${i}: "${line}" -> ${isPrompt ? '是提示符' : '不是提示符'}`)

            if (isPrompt) {
                // 如果有正在处理的区块，先保存
                if (currentBlock && currentBlock.lines.length > 0) {
                    // 保存前一个区块
                    blocks.push({
                        id: `block-${blocks.length}`,
                        lineStart: currentBlock.start,
                        lineEnd: i - 1,
                        content: currentBlock.lines.join('\n'),
                        selected: false,
                        command: this.extractCommand(currentBlock.lines),
                        output: this.extractOutput(currentBlock.lines)
                    })
                    console.log(`📦 保存区块: 行 ${currentBlock.start}-${i-1}`)
                }

                // 开始新的区块
                currentBlock = {
                    start: i,
                    lines: [line]
                }
            } else if (currentBlock) {
                // 继续当前区块
                currentBlock.lines.push(line)
            } else {
                // 如果是第一行且不是提示符，开始新区块
                currentBlock = {
                    start: i,
                    lines: [line]
                }
            }
        }

        // 保存最后一个区块
        if (currentBlock && currentBlock.lines.length > 0) {
            const hasCommandContent = currentBlock.lines.some(l =>
                !this.isPromptLineSimple(l) && l.trim().length > 0
            )

            if (hasCommandContent) {
                blocks.push({
                    id: `block-${blocks.length}`,
                    lineStart: currentBlock.start,
                    lineEnd: lines.length - 1,
                    content: currentBlock.lines.join('\n'),
                    selected: false,
                    command: this.extractCommand(currentBlock.lines),
                    output: this.extractOutput(currentBlock.lines)
                })
                console.log(`📦 保存最后一个区块: 行 ${currentBlock.start}-${lines.length-1}`)
            }
        }

        return blocks
    }

    // 提取命令部分
    private extractCommand(lines: string[]): string | undefined {
        // 找到第一行后的非空行作为命令
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim()
            if (line.length > 0 && !this.isPromptLineSimple(line)) {
                return line
            }
        }
        return undefined
    }

    // 提取输出部分
    private extractOutput(lines: string[]): string | undefined {
        const outputLines: string[] = []
        let foundCommand = false

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim()
            if (line.length > 0 && !this.isPromptLineSimple(line)) {
                if (!foundCommand) {
                    foundCommand = true
                    continue // 跳过命令行
                }
                outputLines.push(lines[i])
            }
        }

        return outputLines.length > 0 ? outputLines.join('\n') : undefined
    }

    // 简化的提示符检测方法（解决方案A）
    private isPromptLineSimple(line: string): boolean {
        const trimmed = line.trim()

        // 方法1: 基于关键词的简单识别
        if (trimmed.includes('>') && (
            trimmed.includes(':\\') ||  // Windows路径: C:\, D:\CompNetDocRefactor>
            trimmed.includes('$ ') ||   // Unix提示符: user@host: $
            trimmed.includes('# ') ||   // 管理员提示符: root@host: #
            trimmed.endsWith('>')       // 通用提示符结尾
        )) {
            return true
        }

        // 方法2: 基于位置的识别
        const promptIndicators = ['>', '#', '$']
        const lastChar = trimmed.slice(-1)
        if (promptIndicators.includes(lastChar)) {
            // 检查前面是否有路径或命令提示
            const beforePrompt = trimmed.slice(0, -1).trim()
            if (beforePrompt.length > 0) {
                // Windows路径模式: X:\path\to\dir
                if (/^[A-Za-z]:/.test(beforePrompt)) {
                    return true
                }
                // SSH/Unix模式: user@host:/path
                if (beforePrompt.includes('@') || beforePrompt.includes(':')) {
                    return true
                }
                // 简单的路径模式: /path/to/dir
                if (beforePrompt.includes('/') || beforePrompt.includes('\\')) {
                    return true
                }
                // 简单的名称模式: name
                if (beforePrompt.length > 0 && !beforePrompt.includes(' ')) {
                    return true
                }
            }
        }

        return false
    }

    // 兼容旧方法（保留以防其他地方使用）
    private isPromptLine(line: string): boolean {
        return this.isPromptLineSimple(line)
    }

    get isCaptureMode(): boolean {
        return this.isCaptureModeSubject.value
    }

    clearSelection(): void {
        this.selectedBlocksSubject.next([])
        console.log('🧹 清除所有选择')
    }

    addBlock(block: CaptureBlock): void {
        const currentBlocks = this.selectedBlocksSubject.value
        const newBlocks = [...currentBlocks, block]
        this.selectedBlocksSubject.next(newBlocks)
        console.log(`➕ 添加区块: ${block.lineStart}-${block.lineEnd}`)
    }

    removeBlock(blockId: string): void {
        const currentBlocks = this.selectedBlocksSubject.value
        const newBlocks = currentBlocks.filter(block => block.id !== blockId)
        this.selectedBlocksSubject.next(newBlocks)
        console.log(`➖ 移除区块: ${blockId}`)
    }

    // 浏览区块
    browseNextBlock(): void {
        if (this.availableBlocks.length === 0) return

        this.currentBrowseIndex = (this.currentBrowseIndex + 1) % this.availableBlocks.length
        this.updateStatusBar()
        console.log(`🔄 浏览到区块 ${this.currentBrowseIndex + 1}/${this.availableBlocks.length}`)
        console.log(`📋 当前区块内容: ${this.availableBlocks[this.currentBrowseIndex].content.substring(0, 50)}...`)
    }

    browsePreviousBlock(): void {
        if (this.availableBlocks.length === 0) return

        this.currentBrowseIndex = this.currentBrowseIndex <= 0 ?
            this.availableBlocks.length - 1 : this.currentBrowseIndex - 1
        this.updateStatusBar()
        console.log(`🔄 浏览到区块 ${this.currentBrowseIndex + 1}/${this.availableBlocks.length}`)
        console.log(`📋 当前区块内容: ${this.availableBlocks[this.currentBrowseIndex].content.substring(0, 50)}...`)
    }

    // 选择/取消选择当前浏览的区块
    toggleCurrentBlockSelection(): void {
        if (this.currentBrowseIndex < 0 || this.currentBrowseIndex >= this.availableBlocks.length) return

        const block = this.availableBlocks[this.currentBrowseIndex]
        const isSelected = this.selectedBlocksSubject.value.some(b => b.id === block.id)

        if (isSelected) {
            this.removeBlock(block.id)
            console.log(`❌ 取消选择区块 ${this.currentBrowseIndex + 1}: ${block.content.substring(0, 30)}...`)
        } else {
            // 创建新的区块对象，确保selected为true
            const selectedBlock = { ...block, selected: true }
            this.addBlock(selectedBlock)
            console.log(`✅ 选择区块 ${this.currentBrowseIndex + 1}: ${block.content.substring(0, 30)}...`)
        }

        this.updateStatusBar()
        this.updateAllBlockHighlights() // 更新所有高亮
    }

    // 选择所有区块
    selectAllBlocks(): void {
        this.clearSelection()
        this.availableBlocks.forEach(block => {
            const selectedBlock = { ...block, selected: true }
            this.addBlock(selectedBlock)
        })
        console.log(`✅ 选择所有 ${this.availableBlocks.length} 个区块`)
        this.updateStatusBar()
        this.updateAllBlockHighlights() // 更新所有高亮
    }

    // 取消选择所有区块
    clearAllSelections(): void {
        this.clearSelection()
        console.log('❌ 取消所有选择')
        this.updateStatusBar()
        this.updateAllBlockHighlights() // 更新高亮状态
    }

    // 添加区块高亮（优先使用选择窗口）
    private addBlockHighlight(block: CaptureBlock): void {
        try {
            console.log(`🎨 区块选择: ${block.id} (行 ${block.lineStart}-${block.lineEnd})`)

            // 由于终端高亮不可靠，我们改用选择窗口
            // 这里暂时只记录选择状态，不进行视觉高亮
            console.log(`📝 区块已选择: ${block.command || block.content.substring(0, 50)}...`)

        } catch (error) {
            console.warn('⚠️ 区块选择失败:', error)
        }
    }

    // 使用xterm.js原生装饰器API（解决方案B）
    private addXtermNativeHighlight(block: CaptureBlock, terminal: any): void {
        try {
            console.log('🔧 尝试使用xterm.js装饰器API进行高亮...')
            console.log('🔍 终端对象信息:', {
                hasRegisterDecoration: typeof terminal.registerDecoration === 'function',
                hasRegisterMarker: typeof terminal.registerMarker === 'function',
                terminalType: terminal.constructor.name,
                terminalMethods: Object.getOwnPropertyNames(terminal).filter(name =>
                    name.includes('decoration') || name.includes('marker') || name.includes('add')
                )
            })

            // 检查终端是否有装饰器支持
            if (!terminal || typeof terminal.registerDecoration !== 'function') {
                console.log('⚠️ xterm装饰器API不可用，检查替代方法...')

                // 尝试其他可能的装饰器方法
                const alternativeMethods = [
                    'addDecoration',
                    'createDecoration',
                    'registerMarker',
                    'addMarker'
                ]

                let foundMethod = false
                for (const method of alternativeMethods) {
                    if (typeof terminal[method] === 'function') {
                        console.log(`✅ 发现替代方法: ${method}`)
                        foundMethod = true
                    }
                }

                if (!foundMethod) {
                    console.log('❌ 未找到任何装饰器相关方法')
                }

                throw new Error('xterm decoration API not available')
            }

            // 为区块的每一行添加装饰器
            const decorations: any[] = []

            for (let i = block.lineStart; i <= block.lineEnd; i++) {
                try {
                    console.log(`🎯 尝试为第${i}行创建装饰器...`)

                    // 尝试不同的装饰器API格式
                    let decoration = null

                    // 方法1: 标准xterm.js v5+格式
                    try {
                        if (typeof terminal.registerMarker === 'function') {
                            const marker = terminal.registerMarker(i)
                            if (marker) {
                                decoration = terminal.registerDecoration({
                                    marker: marker,
                                    backgroundColor: '#4CAF5010',
                                    width: '100%'
                                })
                                console.log(`✅ 方法1成功: 使用marker + decoration`)
                            }
                        }
                    } catch (e) {
                        console.log(`⚠️ 方法1失败:`, e instanceof Error ? e.message : String(e))
                    }

                    // 方法2: 简化格式（如果marker不可用）
                    if (!decoration) {
                        try {
                            decoration = terminal.registerDecoration({
                                line: i,
                                backgroundColor: '#4CAF5010',
                                width: '100%'
                            })
                            console.log(`✅ 方法2成功: 直接指定line`)
                        } catch (e) {
                            console.log(`⚠️ 方法2失败:`, e instanceof Error ? e.message : String(e))
                        }
                    }

                    // 方法3: 最简单的格式
                    if (!decoration) {
                        try {
                            decoration = terminal.registerDecoration({
                                x: 0,
                                y: i,
                                width: terminal.cols,
                                height: 1,
                                backgroundColor: '#4CAF50'
                            })
                            console.log(`✅ 方法3成功: 使用坐标格式`)
                        } catch (e) {
                            console.log(`⚠️ 方法3失败:`, e instanceof Error ? e.message : String(e))
                        }
                    }

                    if (decoration) {
                        decorations.push(decoration)
                        console.log(`✅ 已为第${i}行添加xterm装饰器`)
                    } else {
                        console.log(`❌ 第${i}行所有装饰器方法都失败了`)
                    }
                } catch (lineError) {
                    console.warn(`⚠️ 第${i}行装饰器创建失败:`, lineError)
                }
            }

            // 存储装饰器引用用于后续清理
            if (decorations.length > 0) {
                this.storeDecorations(block.id, decorations)
                console.log(`🎨 区块 ${block.id} 高亮完成: ${decorations.length} 个装饰器`)
            } else {
                console.log(`⚠️ 区块 ${block.id} 未能创建任何装饰器`)
                throw new Error('No decorations created')
            }

        } catch (error) {
            console.warn('⚠️ xterm原生装饰器方法失败:', error)
            throw error // 重新抛出错误，让调用方处理
        }
    }

    // 存储装饰器引用
    private decorations: Map<string, any[]> = new Map()

    private storeDecorations(blockId: string, decorations: any[]): void {
        this.decorations.set(blockId, decorations)
        console.log(`💾 已存储 ${decorations.length} 个装饰器引用 for ${blockId}`)
    }

    private getDecorations(blockId: string): any[] {
        return this.decorations.get(blockId) || []
    }

    // 备用DOM操作高亮方法（回退方案）
    private addDOMHighlightFallback(block: CaptureBlock): void {
        try {
            console.log('🔍 开始DOM高亮回退方案...')
            console.log(`📍 区块信息: ${block.id}, 行范围: ${block.lineStart}-${block.lineEnd}`)

            // 首先获取终端容器
            const terminalContainer = this.findTerminalContainer()
            if (!terminalContainer) {
                console.log('❌ 未找到终端容器')
                this.debugTerminalDOM()
                return
            }

            console.log(`✅ 找到终端容器: ${terminalContainer.tagName}.${terminalContainer.className}`)

            // 查找终端行元素
            const rowElements = this.findTerminalRowElements(terminalContainer)
            if (!rowElements || rowElements.length === 0) {
                console.log('❌ 未找到终端行元素')
                return
            }

            console.log(`🎯 找到 ${rowElements.length} 个行元素`)

            // 计算行索引偏移（缓冲区行号可能与DOM行号不同）
            const rowOffset = this.calculateRowOffset(block, rowElements)
            console.log(`📊 计算出行偏移: ${rowOffset}`)

            // 为区块行添加高亮样式
            let highlightedCount = 0
            for (let i = block.lineStart; i <= block.lineEnd; i++) {
                const domIndex = i - rowOffset

                if (domIndex >= 0 && domIndex < rowElements.length) {
                    const rowElement = rowElements[domIndex] as HTMLElement

                    if (this.applyHighlightToElement(rowElement, i)) {
                        highlightedCount++
                    }
                } else {
                    console.log(`⚠️ 行 ${i} (DOM索引: ${domIndex}) 超出范围`)
                }
            }

            console.log(`🎨 DOM高亮完成: ${highlightedCount}/${block.lineEnd - block.lineStart + 1} 行已高亮`)

        } catch (error) {
            console.warn('⚠️ DOM高亮回退方法失败:', error)
            this.debugTerminalDOM()
        }
    }

    // 查找终端容器
    private findTerminalContainer(): Element | null {
        const containerSelectors = [
            '.terminal',
            '.xterm',
            '[data-terminal]',
            '.tab-body .terminal',
            '.tab-content .terminal'
        ]

        for (const selector of containerSelectors) {
            const element = document.querySelector(selector)
            if (element) {
                console.log(`✅ 终端容器选择器匹配: ${selector}`)
                return element
            }
        }

        console.log('❌ 所有终端容器选择器都未匹配')
        return null
    }

    // 查找终端行元素
    private findTerminalRowElements(container: Element): HTMLElement[] | null {
        const rowSelectors = [
            '.xterm-rows > div',
            '.xterm-rows div',
            '.xterm-screen div',
            '.xterm-text-layer div',
            'div[style*="position: absolute"]', // 可能的位置样式
            'div' // 最后的回退
        ]

        for (const selector of rowSelectors) {
            const elements = container.querySelectorAll(selector)
            if (elements.length > 0) {
                console.log(`✅ 行元素选择器匹配: ${selector}, 找到 ${elements.length} 个元素`)

                // 验证这些元素是否真的是行元素
                const validRows = Array.from(elements).filter(el =>
                    el.textContent || el.children.length > 0 || el.getAttribute('style')
                )

                if (validRows.length > 0) {
                    console.log(`✅ 验证为有效行元素: ${validRows.length} 个`)
                    return validRows as HTMLElement[]
                }
            }
        }

        console.log('❌ 未找到有效的行元素')
        return null
    }

    // 计算行索引偏移
    private calculateRowOffset(block: CaptureBlock, rowElements: HTMLElement[]): number {
        // 简单的启发式方法：假设第一个可见的行对应缓冲区的第0行
        // 在实际应用中，可能需要更复杂的逻辑

        // 查找第一个有内容的行
        for (let i = 0; i < rowElements.length && i < 10; i++) {
            const element = rowElements[i]
            const text = element.textContent?.trim()

            if (text && text.length > 0) {
                console.log(`📍 第一个有内容的行为DOM索引 ${i}, 内容: "${text.substring(0, 30)}..."`)
                return 0 // 假设没有偏移，或者使用更复杂的计算
            }
        }

        return 0 // 默认没有偏移
    }

    // 应用高亮样式到元素
    private applyHighlightToElement(element: HTMLElement, lineIndex: number): boolean {
        try {
            // 保存原始样式
            const originalStyles = {
                backgroundColor: element.style.backgroundColor,
                borderLeft: element.style.borderLeft,
                borderRadius: element.style.borderRadius,
                boxShadow: element.style.boxShadow
            }

            // 应用高亮样式
            element.style.backgroundColor = '#4CAF5010' // 半透明绿色
            element.style.borderLeft = '3px solid #4CAF50' // 绿色左边框
            element.style.borderRadius = '2px'
            element.style.boxShadow = 'inset 0 0 2px rgba(76, 175, 80, 0.3)'
            element.style.transition = 'all 0.2s ease'

            // 存储原始样式用于恢复
            ;(element as any)._nettyOriginalStyles = originalStyles
            ;(element as any)._nettyHighlightLine = lineIndex

            console.log(`✅ 已高亮DOM元素: ${element.tagName}.${element.className || ''} (行 ${lineIndex})`)
            return true

        } catch (error) {
            console.warn(`⚠️ 应用高亮到元素失败 (行 ${lineIndex}):`, error)
            return false
        }
    }

    // 调试终端DOM结构
    private debugTerminalDOM(): void {
        console.log('🔍 调试终端DOM结构...')

        const terminalSelectors = [
            '.terminal',
            '.xterm',
            '.xterm-rows',
            '.xterm-screen',
            '.xterm-text-layer',
            '[data-terminal]'
        ]

        terminalSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector)
            if (elements.length > 0) {
                console.log(`📋 ${selector}: 找到 ${elements.length} 个元素`)
                elements.forEach((el, index) => {
                    console.log(`   ${index}: ${el.tagName}.${el.className} (${el.children.length} 子元素)`)
                })
            }
        })

        // 输出终端相关元素的层次结构
        const terminals = document.querySelectorAll('.terminal')
        terminals.forEach((terminal, index) => {
            console.log(`🏗️ 终端 ${index} 结构:`)
            this.printElementTree(terminal, 1, 3) // 只打印3层深度
        })
    }

    // 递归打印元素树结构
    private printElementTree(element: Element, depth: number, maxDepth: number): void {
        if (depth > maxDepth) return

        const indent = '  '.repeat(depth)
        console.log(`${indent}${element.tagName}.${element.className || ''} (${element.children.length} 子元素)`)

        for (let i = 0; i < element.children.length && i < 5; i++) { // 只打印前5个子元素
            this.printElementTree(element.children[i], depth + 1, maxDepth)
        }

        if (element.children.length > 5) {
            console.log(`${indent}... 还有 ${element.children.length - 5} 个子元素`)
        }
    }

    // 移除区块高亮
    private removeBlockHighlight(block: CaptureBlock): void {
        try {
            console.log(`🎨 取消高亮区块: ${block.id}`)

            // 方法1: 清理xterm装饰器
            const decorations = this.getDecorations(block.id)
            if (decorations.length > 0) {
                console.log(`🧹 清理 ${decorations.length} 个xterm装饰器`)
                decorations.forEach((decoration, index) => {
                    try {
                        if (decoration && typeof decoration.dispose === 'function') {
                            decoration.dispose()
                            console.log(`✅ 已清理装饰器 ${index}`)
                        }
                    } catch (error) {
                        console.warn(`⚠️ 清理装饰器 ${index} 失败:`, error)
                    }
                })
                // 从存储中移除
                this.decorations.delete(block.id)
            } else {
                // 方法2: 如果没有装饰器，尝试移除DOM样式
                console.log('⚠️ 未找到装饰器，尝试移除DOM样式')
                this.removeDOMHighlightFallback(block)
            }

        } catch (error) {
            console.warn('⚠️ 移除区块高亮失败:', error)
            // 最后的回退方案
            this.removeDOMHighlightFallback(block)
        }
    }

    // 移除DOM高亮（回退方案）
    private removeDOMHighlightFallback(block: CaptureBlock): void {
        try {
            console.log('🔍 开始移除DOM高亮...')

            // 查找所有带有高亮标记的元素
            const highlightedElements = document.querySelectorAll('[style*="background-color"][style*="border-left"]')

            console.log(`🎯 找到 ${highlightedElements.length} 个可能高亮的元素`)

            let removedCount = 0
            highlightedElements.forEach((element) => {
                const htmlElement = element as HTMLElement
                const highlightLine = (htmlElement as any)._nettyHighlightLine

                // 检查是否属于当前区块
                if (highlightLine !== undefined &&
                    highlightLine >= block.lineStart &&
                    highlightLine <= block.lineEnd) {

                    // 恢复原始样式
                    const originalStyles = (htmlElement as any)._nettyOriginalStyles
                    if (originalStyles) {
                        htmlElement.style.backgroundColor = originalStyles.backgroundColor || ''
                        htmlElement.style.borderLeft = originalStyles.borderLeft || ''
                        htmlElement.style.borderRadius = originalStyles.borderRadius || ''
                        htmlElement.style.boxShadow = originalStyles.boxShadow || ''
                        htmlElement.style.transition = ''

                        // 清理存储的原始样式
                        delete (htmlElement as any)._nettyOriginalStyles
                        delete (htmlElement as any)._nettyHighlightLine

                        removedCount++
                        console.log(`✅ 已移除行 ${highlightLine} 的高亮`)
                    }
                }
            })

            console.log(`🎨 区块高亮移除完成: ${removedCount} 行已移除高亮`)

        } catch (error) {
            console.warn('⚠️ 移除DOM高亮失败:', error)
        }
    }

    // 更新所有区块的高亮状态
    private updateAllBlockHighlights(): void {
        try {
            console.log('🔄 开始更新所有区块高亮状态...')

            // 获取当前选中的区块
            const selectedBlocks = this.selectedBlocksSubject.value
            const selectedBlockIds = new Set(selectedBlocks.map(b => b.id))

            // 为所有可用区块更新高亮状态
            this.availableBlocks.forEach(block => {
                const shouldBeHighlighted = selectedBlockIds.has(block.id)

                if (shouldBeHighlighted) {
                    // 确保有高亮
                    this.addBlockHighlight(block)
                } else {
                    // 移除高亮
                    this.removeBlockHighlight(block)
                }
            })

            console.log(`🔄 更新高亮状态完成: ${selectedBlocks.length} 个区块被高亮`)

        } catch (error) {
            console.warn('⚠️ 更新区块高亮失败:', error)
        }
    }

    toggleBlockSelection(block: CaptureBlock): void {
        const currentBlocks = this.selectedBlocksSubject.value
        const existingBlock = currentBlocks.find(b => b.id === block.id)

        if (existingBlock) {
            this.removeBlock(block.id)
        } else {
            this.addBlock(block)
        }
    }

    getSelectedBlocks(): CaptureBlock[] {
        return this.selectedBlocksSubject.value
    }

    // 切换选择模式
    toggleSelectionMode(): void {
        this.selectionMode = this.selectionMode === 'block' ? 'line' : 'block'
        console.log(`🔄 切换选择模式: ${this.selectionMode === 'block' ? '按区块选择' : '按行选择'}`)
    }

    // 获取当前选择模式
    getSelectionMode(): 'block' | 'line' {
        return this.selectionMode
    }

    // 获取主题颜色
    private getThemeColors() {
        const root = document.documentElement

        // 获取基础主题色
        const bgColor = getComputedStyle(root).getPropertyValue('--body-bg') || '#131d27'
        const fgColor = getComputedStyle(root).getPropertyValue('--bs-body-color') || '#ccc'

        // 计算更亮的文字颜色，确保对比度足够
        const isDarkBg = this.isColorDark(bgColor)
        const textColor = isDarkBg ? '#ffffff' : '#000000'  // 在深色背景下用白色，在浅色背景下用黑色

        return {
            background: bgColor,
            backgroundSecondary: getComputedStyle(root).getPropertyValue('--body-bg2') || '#20333e',
            foreground: textColor,  // 使用计算出的高对比度文字色
            originalForeground: fgColor,  // 保存原始前景色用于其他用途
            border: getComputedStyle(root).getPropertyValue('--bs-border-color') || '#495057',
            primary: getComputedStyle(root).getPropertyValue('--bs-primary') || '#4CAF50',
            success: getComputedStyle(root).getPropertyValue('--bs-success') || '#28a745',
            danger: getComputedStyle(root).getPropertyValue('--bs-danger') || '#dc3545',
            muted: getComputedStyle(root).getPropertyValue('--bs-muted-color') || '#6c757d',
            // 选择状态的高亮色
            selectionBg: isDarkBg ? 'rgba(76, 175, 80, 0.2)' : 'rgba(76, 175, 80, 0.1)',
            selectionBorder: '#4CAF50'
        }
    }

    // 判断颜色是否为深色
    private isColorDark(color: string): boolean {
        // 移除可能的透明度
        if (color.startsWith('rgba')) {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
            if (match) {
                const r = parseInt(match[1])
                const g = parseInt(match[2])
                const b = parseInt(match[3])
                // 计算亮度 (YIQ公式)
                const brightness = (r * 299 + g * 587 + b * 114) / 1000
                return brightness < 128
            }
        }

        // 简单的十六进制颜色判断
        const hex = color.replace('#', '')
        if (hex.length === 3) {
            const r = parseInt(hex[0] + hex[0], 16)
            const g = parseInt(hex[1] + hex[1], 16)
            const b = parseInt(hex[2] + hex[2], 16)
            const brightness = (r * 299 + g * 587 + b * 114) / 1000
            return brightness < 128
        } else if (hex.length === 6) {
            const r = parseInt(hex.substring(0, 2), 16)
            const g = parseInt(hex.substring(2, 4), 16)
            const b = parseInt(hex.substring(4, 6), 16)
            const brightness = (r * 299 + g * 587 + b * 114) / 1000
            return brightness < 128
        }

        // 默认假设为深色
        return true
    }

    completeCapture(): void {
        const selectedBlocks = this.getSelectedBlocks()
        console.log(`🎉 完成捕获，共选择 ${selectedBlocks.length} 个区块`)

        if (selectedBlocks.length > 0) {
            this.exportSelection()
        }

        this.toggleCaptureMode()
    }

    private exportSelection(): void {
        const selectedBlocks = this.getSelectedBlocks()
        const content = selectedBlocks
            .sort((a, b) => a.lineStart - b.lineStart)
            .map(block => block.content)
            .join('\n')

        console.log('📤 导出内容:', content)

        // TODO: 实现实际的图片导出功能
        alert(`已捕获 ${selectedBlocks.length} 个区块！\n\n内容预览:\n${content.substring(0, 100)}...`)
    }

    // 显示区块选择窗口
    private showBlockSelectionModal(blocks: CaptureBlock[]): void {
        console.log('🪟 显示区块选择窗口...')

        // 获取主题颜色
        const themeColors = this.getThemeColors()

        // 创建模态框容器
        const modalContainer = document.createElement('div')
        modalContainer.id = 'netty-selection-modal'
        modalContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `

        // 设置关闭回调
        const closeCallback = () => this.closeModal(modalContainer)

        // 创建模态框内容
        const modalContent = document.createElement('div')
        modalContent.style.cssText = `
            background: ${themeColors.background};
            border: 1px solid ${themeColors.border};
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            max-width: 800px;
            max-height: 80vh;
            width: 90%;
            overflow: hidden;
            color: ${themeColors.foreground};
        `

        // 模态框头部
        const modalHeader = document.createElement('div')
        modalHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid ${themeColors.border};
            background: ${themeColors.backgroundSecondary};
            border-radius: 8px 8px 0 0;
            color: ${themeColors.foreground};
            min-height: 48px;
        `

        const title = document.createElement('h3')
        title.textContent = '选择要导出的命令区块'
        title.style.cssText = `
            margin: 0;
            color: ${themeColors.foreground};
            font-size: 16px;
            font-weight: 600;
        `

        const closeBtn = document.createElement('button')
        closeBtn.textContent = '×'
        closeBtn.style.cssText = `
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: ${themeColors.muted};
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background-color 0.2s;
        `
        closeBtn.onmouseover = () => closeBtn.style.backgroundColor = '#e0e0e0'
        closeBtn.onmouseout = () => closeBtn.style.backgroundColor = 'transparent'
        closeBtn.onclick = () => this.closeModal(modalContainer)

        modalHeader.appendChild(title)
        modalHeader.appendChild(closeBtn)

        // 模态框主体
        const modalBody = document.createElement('div')
        modalBody.style.cssText = `
            padding: 16px;
            max-height: 60vh;
            overflow-y: auto;
        `

        // 统计信息
        const stats = document.createElement('div')
        stats.textContent = `共发现 ${blocks.length} 个命令区块`
        stats.style.cssText = `
            margin-bottom: 15px;
            color: ${themeColors.muted};
            font-size: 14px;
        `
        modalBody.appendChild(stats)

        // 区块列表
        const blocksList = document.createElement('div')
        blocksList.style.cssText = `
            max-height: 50vh;
            overflow-y: auto;
        `

        // 正序显示区块（最早的命令在前），但自动滚动到底部显示最新内容
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]
            const blockItem = this.createBlockItem(block, i, blocksList, blocks, themeColors)
            blocksList.appendChild(blockItem)
        }

        modalBody.appendChild(blocksList)

        // 自动滚动到底部显示最新内容
        setTimeout(() => {
            blocksList.scrollTop = blocksList.scrollHeight
        }, 10)



        // 模态框底部
        const modalFooter = document.createElement('div')
        modalFooter.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            border-top: 1px solid ${themeColors.border};
            background: ${themeColors.backgroundSecondary};
            border-radius: 0 0 8px 8px;
            color: ${themeColors.foreground};
            min-height: 48px;
        `

        const selectAllBtn = this.createModalButton('全选', 'secondary', () => {
            if (this.selectionMode === 'line') {
                // 行选择模式：选中所有行
                blocks.forEach(block => {
                    block.selected = true
                    if (block.selectedLines) {
                        block.selectedLines.fill(true)
                    }
                })
            } else {
                // 区块选择模式：选中所有区块
                blocks.forEach(block => block.selected = true)
            }
            this.updateModalDisplay(blocksList, blocks, modalFooter)
        }, themeColors)

        const clearAllBtn = this.createModalButton('清空', 'secondary', () => {
            if (this.selectionMode === 'line') {
                // 行选择模式：取消选中所有行
                blocks.forEach(block => {
                    block.selected = false
                    if (block.selectedLines) {
                        block.selectedLines.fill(false)
                    }
                })
            } else {
                // 区块选择模式：取消选中所有区块
                blocks.forEach(block => block.selected = false)
            }
            this.updateModalDisplay(blocksList, blocks, modalFooter)
        }, themeColors)

        const copyBtn = this.createModalButton('📋 复制到剪贴板', 'primary', () => {
            let selectedBlocks = blocks.filter(block => block.selected)

            // 在行选择模式下，进一步筛选出真正有选中行的区块
            if (this.selectionMode === 'line') {
                selectedBlocks = selectedBlocks.filter(block =>
                    block.selectedLines && block.selectedLines.some(selected => selected)
                )
            }

            this.copyBlocksToClipboard(selectedBlocks)
            // 不关闭窗口，让用户可以继续操作
        }, themeColors)

        const downloadBtn = this.createModalButton('💾 下载并复制', 'success', () => {
            let selectedBlocks = blocks.filter(block => block.selected)

            // 在行选择模式下，进一步筛选出真正有选中行的区块
            if (this.selectionMode === 'line') {
                selectedBlocks = selectedBlocks.filter(block =>
                    block.selectedLines && block.selectedLines.some(selected => selected)
                )
            }

            this.downloadBlocksAndCopy(selectedBlocks)
            this.closeModal(modalContainer)
        }, themeColors)

        const cancelBtn = this.createModalButton('取消', 'cancel', () => {
            this.closeModal(modalContainer)
        }, themeColors)

        // 左侧：全选、清空和行选择开关
        const leftButtons = document.createElement('div')
        leftButtons.style.cssText = 'display: flex; gap: 10px; align-items: center;'

        // 行选择开关
        const lineSelectSwitch = document.createElement('label')
        lineSelectSwitch.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #666;
            cursor: pointer;
            user-select: none;
        `

        const lineSelectCheckbox = document.createElement('input')
        lineSelectCheckbox.type = 'checkbox'
        lineSelectCheckbox.checked = this.selectionMode === 'line'
        lineSelectCheckbox.style.cssText = `
            width: 14px;
            height: 14px;
            cursor: pointer;
        `

        const lineSelectLabel = document.createElement('span')
        lineSelectLabel.textContent = '按行选择'
        lineSelectLabel.style.cssText = 'font-weight: 500;'

        lineSelectCheckbox.onchange = () => {
            const previousMode = this.selectionMode
            this.selectionMode = lineSelectCheckbox.checked ? 'line' : 'block'
            console.log(`🔄 切换到${this.selectionMode === 'block' ? '按区块选择' : '按行选择'}模式`)

            // 重新渲染区块列表以应用新的选择模式
            this.refreshBlockDisplay(blocksList, blocks, modalFooter, themeColors)
        }

        lineSelectSwitch.appendChild(lineSelectCheckbox)
        lineSelectSwitch.appendChild(lineSelectLabel)

        leftButtons.appendChild(selectAllBtn)
        leftButtons.appendChild(clearAllBtn)
        leftButtons.appendChild(lineSelectSwitch)

        // 右侧：操作按钮
        const rightButtons = document.createElement('div')
        rightButtons.style.cssText = 'display: flex; gap: 10px;'
        rightButtons.appendChild(copyBtn)
        rightButtons.appendChild(downloadBtn)
        rightButtons.appendChild(cancelBtn)

        modalFooter.appendChild(leftButtons)
        modalFooter.appendChild(rightButtons)

        // 组装模态框
        modalContent.appendChild(modalHeader)
        modalContent.appendChild(modalBody)
        modalContent.appendChild(modalFooter)
        modalContainer.appendChild(modalContent)

        // 添加到页面
        document.body.appendChild(modalContainer)

        // 初始更新按钮文本
        this.updateModalDisplay(blocksList, blocks, modalFooter)

        console.log('✅ 区块选择窗口已显示')
    }

    // 创建区块项
    private createBlockItem(block: CaptureBlock, index: number, container: HTMLElement, allBlocks: CaptureBlock[], themeColors?: any): HTMLElement {
        // 如果没有提供主题颜色，使用默认值
        const colors = themeColors || {
            border: '#e0e0e0',
            background: '#ffffff',
            success: '#4CAF50'
        }

        const item = document.createElement('div')
        item.style.cssText = `
            border: 1px solid ${colors.border};
            border-radius: 6px;
            margin-bottom: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
            background: ${colors.background};
        `

        const updateSelectedStyle = () => {
            item.style.borderColor = block.selected ? colors.selectionBorder : colors.border
            item.style.backgroundColor = block.selected ? colors.selectionBg : colors.background
        }

        item.onmouseover = () => {
            item.style.borderColor = colors.selectionBorder
            item.style.boxShadow = `0 2px 8px rgba(76, 175, 80, 0.15)`
        }
        item.onmouseout = () => updateSelectedStyle()

        // 区块头部 - 完全移除，极简设计
        // 不再显示任何标题或信息，只保留内容和高亮选择状态

        // 创建内容容器
        const contentContainer = document.createElement('div')
        contentContainer.style.cssText = `
            padding: 12px 15px;
            border-radius: 6px;
            transition: all 0.2s ease;
        `

        if (this.selectionMode === 'block') {
            // 按区块选择模式：整个区块作为一个可选择单元
            contentContainer.style.cssText += `
                cursor: pointer;
                color: ${colors.foreground};
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 13px;
                line-height: 1.4;
                white-space: pre-wrap;
                overflow-wrap: break-word;
                word-break: break-word;
            `

            // 直接显示原始区块内容
            contentContainer.textContent = block.content || '无内容'

            // 点击切换整个区块的选择状态
            contentContainer.onclick = () => {
                block.selected = !block.selected
                updateSelectedStyle()

                // 更新按钮文本显示
                const modalFooter = container.closest('.netty-selection-modal')?.querySelector('.netty-modal-footer') as HTMLElement
                if (modalFooter) {
                    this.updateModalDisplay(container, allBlocks, modalFooter)
                }
            }
        } else {
            // 按行选择模式：将区块内容按行分割，每行都可以单独选择
            const lines = (block.content || '无内容').split('\n')

            // 为每一行创建单独的可选择元素
            lines.forEach((line, lineIndex) => {
                const lineElement = document.createElement('div')
                lineElement.style.cssText = `
                    cursor: pointer;
                    padding: 2px 4px;
                    margin: 1px 0;
                    border-radius: 3px;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 13px;
                    line-height: 1.4;
                    white-space: pre-wrap;
                    overflow-wrap: break-word;
                    word-break: break-word;
                    transition: all 0.2s ease;
                    color: ${colors.foreground};
                `
                lineElement.textContent = line || ' '

                // 为每一行创建选择状态跟踪
                if (!block.selectedLines) {
                    // 根据区块的整体选择状态初始化所有行的选择状态
                    block.selectedLines = new Array(lines.length).fill(block.selected)
                }

                // 设置行的高亮状态
                const updateLineStyle = () => {
                    if (block.selectedLines![lineIndex]) {
                        lineElement.style.backgroundColor = colors.selectionBg
                        lineElement.style.border = `1px solid ${colors.selectionBorder}`
                        lineElement.style.color = colors.foreground
                    } else {
                        lineElement.style.backgroundColor = 'transparent'
                        lineElement.style.border = '1px solid transparent'
                        lineElement.style.color = colors.foreground
                    }
                }

                updateLineStyle()

                // 点击切换这一行的选择状态
                lineElement.onclick = (e) => {
                    e.stopPropagation() // 防止事件冒泡
                    block.selectedLines![lineIndex] = !block.selectedLines![lineIndex]
                    updateLineStyle()

                    // 检查是否所有行都被选中，更新区块的整体选择状态
                    const allSelected = block.selectedLines!.every(selected => selected)
                    const anySelected = block.selectedLines!.some(selected => selected)
                    block.selected = anySelected // 如果有任何行被选中，区块就被认为是选中的

                    // 更新整体区块的高亮样式
                    updateSelectedStyle()

                    // 更新按钮文本显示
                    const modalFooter = container.closest('.netty-selection-modal')?.querySelector('.netty-modal-footer') as HTMLElement
                    if (modalFooter) {
                        this.updateModalDisplay(container, allBlocks, modalFooter)
                    }
                }

                contentContainer.appendChild(lineElement)
            })

            // 移除高度限制，让区块根据内容自动调整高度
            // contentContainer.style.maxHeight = '200px'
            // contentContainer.style.overflowY = 'auto'
        }

        updateSelectedStyle()
        item.appendChild(contentContainer)

        return item
    }

    // 刷新区块显示（用于切换选择模式后重新渲染）
    private refreshBlockDisplay(blocksList: HTMLElement, blocks: CaptureBlock[], modalFooter: HTMLElement, themeColors?: any): void {
        console.log('🔄 正在刷新区块显示...')

        // 清空现有的区块列表
        while (blocksList.firstChild) {
            blocksList.removeChild(blocksList.firstChild)
        }

        // 重新为每个区块创建显示元素
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]

            // 如果切换到行选择模式，需要初始化或更新 selectedLines
            if (this.selectionMode === 'line') {
                const lines = block.content.split('\n')
                if (!block.selectedLines) {
                    // 首次切换到行选择模式，根据区块选择状态初始化所有行
                    block.selectedLines = new Array(lines.length).fill(block.selected)
                } else if (block.selectedLines.length !== lines.length) {
                    // 如果行数发生变化，重新初始化
                    block.selectedLines = new Array(lines.length).fill(block.selected)
                }
            }
            // 如果切换回区块选择模式，需要根据行的选择状态更新区块状态
            else if (this.selectionMode === 'block' && block.selectedLines) {
                // 如果有任何行被选中，则区块被认为是选中的
                block.selected = block.selectedLines.some(selected => selected)
                delete block.selectedLines
            }

            const blockItem = this.createBlockItem(block, i, blocksList, blocks, themeColors)
            blocksList.appendChild(blockItem)
        }

        // 重新应用自动滚动到底部的逻辑
        setTimeout(() => {
            blocksList.scrollTop = blocksList.scrollHeight
        }, 10)

        // 更新按钮和计数显示
        this.updateModalDisplay(blocksList, blocks, modalFooter)

        console.log('✅ 区块显示已刷新')
    }

    // 创建模态框按钮
    private createModalButton(text: string, type: 'primary' | 'secondary' | 'success' | 'cancel', onClick: () => void, themeColors?: any): HTMLElement {
        const button = document.createElement('button')
        button.textContent = text
        button.onclick = onClick

        // 使用主题颜色
        const colors = themeColors || {
            primary: '#4CAF50',
            success: '#28a745',
            secondary: '#f5f5f5',
            border: '#ddd',
            foreground: '#333',
            background: '#ffffff'
        }

        const baseStyle = `
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s ease;
        `

        switch (type) {
            case 'primary':
                button.style.cssText = baseStyle + `
                    background: ${colors.primary};
                    color: white;
                `
                button.onmouseover = () => button.style.backgroundColor = '#45a049'
                button.onmouseout = () => button.style.backgroundColor = colors.primary
                break
            case 'secondary':
                button.style.cssText = baseStyle + `
                    background: ${colors.secondary};
                    color: ${colors.foreground};
                    border: 1px solid ${colors.border};
                `
                button.onmouseover = () => {
                    button.style.backgroundColor = '#e8f5e8'
                    button.style.borderColor = colors.primary
                }
                button.onmouseout = () => {
                    button.style.backgroundColor = colors.secondary
                    button.style.borderColor = colors.border
                }
                break
            case 'success':
                button.style.cssText = baseStyle + `
                    background: ${colors.primary};
                    color: white;
                `
                button.onmouseover = () => button.style.backgroundColor = '#45a049'
                button.onmouseout = () => button.style.backgroundColor = colors.primary
                break
            case 'cancel':
                button.style.cssText = baseStyle + `
                    background: ${colors.danger || '#f44336'};
                    color: white;
                `
                button.onmouseover = () => button.style.backgroundColor = '#d32f2f'
                button.onmouseout = () => button.style.backgroundColor = colors.danger || '#f44336'
                break
        }

        return button
    }

    // 更新模态框显示
    private updateModalDisplay(container: HTMLElement, blocks: CaptureBlock[], footer: HTMLElement): void {
        let displayText = ''

        if (this.selectionMode === 'line') {
            // 行选择模式：计算选中的行数
            let selectedLinesCount = 0
            blocks.forEach(block => {
                if (block.selectedLines) {
                    selectedLinesCount += block.selectedLines.filter(selected => selected).length
                }
            })
            displayText = `${selectedLinesCount} 行已选中`
        } else {
            // 区块选择模式：计算选中的区块数
            const selectedCount = blocks.filter(b => b.selected).length
            displayText = `${selectedCount} 个区块已选中`
        }

        // 更新复制按钮文本 (第3个按钮)
        const copyBtn = footer.querySelector('button:nth-child(3)') as HTMLButtonElement
        if (copyBtn) {
            copyBtn.textContent = `📋 复制到剪贴板`
        }

        // 更新下载按钮文本 (第4个按钮)
        const downloadBtn = footer.querySelector('button:nth-child(4)') as HTMLButtonElement
        if (downloadBtn) {
            downloadBtn.textContent = `💾 下载并复制`
        }

        console.log(`🔄 更新模态框显示: ${displayText}`)
    }

    // 关闭模态框
    private closeModal(modal: HTMLElement): void {
        if (modal && modal.parentNode) {
            modal.parentNode.removeChild(modal)
            console.log('🪟 区块选择窗口已关闭')
        }
    }

    // 使用选择的区块完成捕获
    private completeCaptureWithBlocks(selectedBlocks: CaptureBlock[]): void {
        console.log(`🎯 使用 ${selectedBlocks.length} 个选中区块完成捕获`)

        // 清空当前选择
        this.clearSelection()

        // 添加选中的区块
        selectedBlocks.forEach(block => this.addBlock(block))

        // 完成捕获
        this.completeCapture()

        // 立即开始图片导出
        this.exportSelectedBlocksToImage(selectedBlocks)
    }

    // 复制区块到剪贴板（只复制，不下载）
    private copyBlocksToClipboard(blocks: CaptureBlock[]): void {
        console.log(`📋 开始复制 ${blocks.length} 个区块到剪贴板`)

        if (blocks.length === 0) {
            console.warn('⚠️ 没有选中的区块，无法复制')
            return
        }

        // 生成图片并复制到剪贴板
        this.generateImageAndCopyToClipboard(blocks, false)
    }

    // 下载并复制区块（下载+复制）
    private downloadBlocksAndCopy(blocks: CaptureBlock[]): void {
        console.log(`💾 开始下载并复制 ${blocks.length} 个区块`)

        if (blocks.length === 0) {
            console.warn('⚠️ 没有选中的区块，无法操作')
            return
        }

        // 生成图片并同时下载和复制
        this.generateImageAndCopyToClipboard(blocks, true)
    }

    // 生成图片并复制到剪贴板
    private generateImageAndCopyToClipboard(blocks: CaptureBlock[], shouldDownload: boolean): void {
        try {
            // 创建HTML内容
            const htmlContent = this.generateTerminalHTML(blocks)

            // 创建隐藏的渲染容器
            const renderContainer = this.createRenderContainer(htmlContent)

            // 等待样式加载后渲染图片
            setTimeout(() => {
                this.renderHTMLToImage(renderContainer, blocks.length)
                    .then(blob => {
                        if (blob) {
                            // 复制到剪贴板
                            this.copyImageToClipboard(blob).then(() => {
                                // 如果需要下载，同时下载
                                if (shouldDownload) {
                                    this.performDownload(blob, blocks.length)
                                }
                            }).catch(() => {
                                // 即使剪贴板失败，如果需要下载也要下载
                                if (shouldDownload) {
                                    this.performDownload(blob, blocks.length)
                                }
                            })
                        }
                    })
                    .catch(error => {
                        console.error('❌ 图片生成失败:', error)
                        alert('图片生成失败，请查看控制台了解详情')
                    })
                    .finally(() => {
                        // 清理渲染容器
                        if (renderContainer.parentNode) {
                            renderContainer.parentNode.removeChild(renderContainer)
                        }
                    })
            }, 100)

        } catch (error) {
            console.error('❌ 图片生成初始化失败:', error)
            alert('图片生成初始化失败，请查看控制台了解详情')
        }
    }

    // HTML转义
    private escapeHtml(text: string): string {
        const div = document.createElement('div')
        div.textContent = text
        return div.innerHTML
    }

    // 导出选中区块为图片
    private exportSelectedBlocksToImage(blocks: CaptureBlock[]): void {
        console.log(`%c🖼️ NettyTabby图片导出开始`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
        console.log(`📊 准备导出 ${blocks.length} 个命令区块`)

        if (blocks.length === 0) {
            console.warn('⚠️ 没有选中的区块，无法导出图片')
            return
        }

        try {
            // 创建HTML内容
            const htmlContent = this.generateTerminalHTML(blocks)

            // 创建隐藏的渲染容器
            const renderContainer = this.createRenderContainer(htmlContent)

            // 等待样式加载后渲染图片
            setTimeout(() => {
                this.renderHTMLToImage(renderContainer, blocks.length)
                    .then(blob => {
                        if (blob) {
                            this.downloadImage(blob, blocks.length)
                        }
                    })
                    .catch(error => {
                        console.error('❌ 图片导出失败:', error)
                        alert('图片导出失败，请查看控制台了解详情')
                    })
                    .finally(() => {
                        // 清理渲染容器
                        if (renderContainer.parentNode) {
                            renderContainer.parentNode.removeChild(renderContainer)
                        }
                    })
            }, 100)

        } catch (error) {
            console.error('❌ 图片导出初始化失败:', error)
            alert('图片导出初始化失败，请查看控制台了解详情')
        }
    }

    // 生成终端样式的HTML
    private generateTerminalHTML(blocks: CaptureBlock[]): string {
        const timestamp = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })

        let html = `
            <div class="terminal-export">
                <div class="terminal-header">
                    <div class="terminal-title">终端命令导出</div>
                    <div class="terminal-info">
                        <span class="timestamp">${timestamp}</span>
                        <span class="block-count">${blocks.length} 个命令区块</span>
                    </div>
                </div>
                <div class="terminal-content">
        `

        blocks.forEach((block, index) => {
            if (this.selectionMode === 'line' && block.selectedLines) {
                // 按行选择模式：只导出选中的行
                const lines = block.content.split('\n')
                const selectedContent = lines
                    .filter((line, lineIndex) => block.selectedLines![lineIndex])
                    .join('\n')

                if (selectedContent.trim()) {
                    html += `
                        <div class="terminal-block">
                            <div class="terminal-content">${this.escapeHtml(selectedContent)}</div>
                        </div>
                    `
                }
            } else {
                // 按区块选择模式：直接使用原始区块内容
                html += `
                    <div class="terminal-block">
                        <div class="terminal-content">${this.escapeHtml(block.content)}</div>
                    </div>
                `
            }
        })

        html += `
                </div>
                <div class="terminal-footer">
                    <div class="export-info">由 NettyTabby 插件生成</div>
                </div>
            </div>
        `

        return html
    }

    // 创建渲染容器
    private createRenderContainer(htmlContent: string): HTMLElement {
        const container = document.createElement('div')
        container.id = 'netty-render-container'
        container.style.cssText = `
            position: absolute;
            top: -9999px;
            left: -9999px;
            width: 800px;
            background: #1e1e1e;
            border-radius: 8px;
            overflow: hidden;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.4;
            color: #cccccc;
        `

        // 添加CSS样式
        const style = document.createElement('style')
        style.textContent = this.getTerminalStyles()
        container.appendChild(style)

        // 添加HTML内容
        const contentDiv = document.createElement('div')
        contentDiv.innerHTML = htmlContent
        container.appendChild(contentDiv)

        document.body.appendChild(container)
        return container
    }

    // 获取终端样式
    private getTerminalStyles(): string {
        return `
            .terminal-export {
                width: 100%;
                background: #1e1e1e;
                color: #cccccc;
                padding: 20px;
                border-radius: 8px;
                box-sizing: border-box;
            }

            .terminal-header {
                border-bottom: 1px solid #3e3e3e;
                padding-bottom: 15px;
                margin-bottom: 20px;
            }

            .terminal-title {
                font-size: 18px;
                font-weight: bold;
                color: #ffffff;
                margin-bottom: 8px;
            }

            .terminal-info {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                color: #888888;
            }

            .terminal-content {
                margin-bottom: 20px;
            }

            .terminal-block {
                margin-bottom: 15px;
                padding: 12px;
                background: #2d2d2d;
                border-radius: 6px;
                border-left: 3px solid #4CAF50;
            }

            .terminal-content {
                color: #cccccc;
                white-space: pre-wrap;
                word-break: break-all;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.4;
                background: #2d2d2d;
                padding: 12px;
                border-radius: 6px;
                border-left: 3px solid #4CAF50;
            }

            .terminal-footer {
                border-top: 1px solid #3e3e3e;
                padding-top: 15px;
                text-align: center;
                font-size: 12px;
                color: #666666;
            }

            .export-info {
                color: #888888;
            }
        `
    }

    // 将HTML渲染为图片
    private async renderHTMLToImage(container: HTMLElement, blockCount: number): Promise<Blob | null> {
        console.log(`%c🎨 开始将HTML渲染为图片...`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        try {
            // 获取容器尺寸 - 根据内容动态调整宽度和高度
            const rect = container.getBoundingClientRect()
            const width = rect.width // 移除固定的最小宽度，根据内容自适应
            const height = rect.height // 根据内容动态调整高度

            console.log(`%c📐 图片尺寸: ${width}x${height}`, 'background: #9C27B0; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

            // 创建canvas
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height

            const ctx = canvas.getContext('2d')
            if (!ctx) {
                throw new Error('无法获取canvas 2d上下文')
            }

            // 设置背景
            ctx.fillStyle = '#1e1e1e'
            ctx.fillRect(0, 0, width, height)

            // 简单的文本渲染（由于html2canvas可能不可用，我们使用基础的canvas文本渲染）
            await this.renderTerminalContentToCanvas(ctx, container, width, height, blockCount)

            // 转换为blob
            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    resolve(blob)
                }, 'image/png', 0.9)
            })

        } catch (error) {
            console.error('❌ Canvas渲染失败:', error)
            return null
        }
    }

    // 将终端内容渲染到canvas
    private async renderTerminalContentToCanvas(
        ctx: CanvasRenderingContext2D,
        container: HTMLElement,
        width: number,
        height: number,
        blockCount: number
    ): Promise<void> {
        console.log(`%c✏️ 开始渲染终端内容到Canvas...`, 'background: #607D8B; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        // 设置字体
        ctx.font = '14px Consolas, Monaco, "Courier New", monospace'
        ctx.fillStyle = '#ffffff'
        ctx.textBaseline = 'top'

        let y = 30

        // 标题
        ctx.font = 'bold 18px Arial'
        ctx.fillText('终端命令导出', 20, y)
        y += 30

        // 信息行
        ctx.font = '12px Arial'
        ctx.fillStyle = '#888888'
        const timestamp = new Date().toLocaleString('zh-CN')
        ctx.fillText(timestamp, 20, y)
        ctx.fillText(`${blockCount} 个命令区块`, width - 150, y)
        y += 40

        // 绘制分割线
        ctx.strokeStyle = '#3e3e3e'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(20, y)
        ctx.lineTo(width - 20, y)
        ctx.stroke()
        y += 20

        // 获取区块内容并渲染 - 直接使用原始内容
        const blocks = container.querySelectorAll('.terminal-block')
        blocks.forEach((block, index) => {
            const contentElement = block.querySelector('.terminal-content')

            if (contentElement && contentElement.textContent) {
                // 直接渲染原始区块内容
                ctx.fillStyle = '#cccccc'
                ctx.font = '14px Consolas, Monaco, "Courier New", monospace'

                const contentLines = contentElement.textContent.split('\n')
                contentLines.forEach(line => {
                    // 处理长行自动换行
                    const maxWidth = width - 40
                    let currentLine = line
                    let lineY = y

                    while (currentLine.length > 0) {
                        const metrics = ctx.measureText(currentLine)
                        if (metrics.width <= maxWidth) {
                            ctx.fillText(currentLine, 20, lineY)
                            break
                        } else {
                            // 找到可以断开的位置
                            let breakPoint = Math.floor((maxWidth / metrics.width) * currentLine.length)
                            while (breakPoint > 0 && currentLine.charAt(breakPoint) !== ' ') {
                                breakPoint--
                            }
                            if (breakPoint === 0) breakPoint = Math.floor(currentLine.length / 2)

                            const linePart = currentLine.substring(0, breakPoint)
                            ctx.fillText(linePart, 20, lineY)
                            currentLine = currentLine.substring(breakPoint).trim()
                            lineY += 18
                        }
                    }

                    y = lineY + 18
                })

                y += 10 // 区块间距
            }
        })

        // 页脚
        ctx.font = '12px Arial'
        ctx.fillStyle = '#666666'
        ctx.fillText('由 NettyTabby 插件生成', width / 2 - 80, height - 30)

        console.log(`%c✅ Canvas渲染完成`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
    }

    // 下载图片并提供剪贴板选项
    private downloadImage(blob: Blob, blockCount: number): void {
        console.log(`%c💾 开始下载图片...`, 'background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
        console.log(`%c📁 文件名: terminal-commands-${new Date().getTime()}-${blockCount}-blocks.png`, 'background: #00BCD4; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        // 首先复制到剪贴板，然后再处理下载
        this.copyImageToClipboard(blob).then(() => {
            // 剪贴板复制完成后，再处理下载
            this.performDownload(blob, blockCount)
        }).catch(() => {
            // 即使剪贴板失败，也要尝试下载
            this.performDownload(blob, blockCount)
        })
    }

    // 执行实际的下载操作
    private performDownload(blob: Blob, blockCount: number): void {
        try {
            const timestamp = new Date().getTime()
            const filename = `terminal-commands-${timestamp}-${blockCount}-blocks.png`

            // 方法1: 使用 download 属性 (某些浏览器会直接下载)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            a.style.display = 'none'

            // 尝试直接触发下载
            document.body.appendChild(a)

            // 在某些浏览器中，我们需要用户交互后才能下载
            // 这里我们使用一个小的延迟来确保DOM更新
            setTimeout(() => {
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)

                console.log(`%c✅ 图片下载触发成功`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
                console.log(`%c📁 如果浏览器弹出保存对话框，请选择保存位置`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
                console.log(`%c💡 提示: 某些浏览器会弹出保存对话框，这是正常行为`, 'background: #9C27B0; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

                // 显示下载提示
                this.showDownloadNotification()
            }, 100)

        } catch (error) {
            console.error('❌ 图片下载失败:', error)
            console.log(`%c⚠️ 下载失败，尝试备用方案...`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

            // 备用方案：创建一个新的窗口显示图片，让用户右键保存
            this.fallbackDownload(blob, blockCount)
        }
    }

    // 备用下载方案：新窗口显示图片
    private fallbackDownload(blob: Blob, blockCount: number): void {
        try {
            console.log(`%c🔄 使用备用下载方案...`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

            const url = URL.createObjectURL(blob)
            const newWindow = window.open('', '_blank')

            if (newWindow) {
                newWindow.document.write(`
                    <html>
                        <head>
                            <title>Terminal Commands Export</title>
                            <style>
                                body {
                                    margin: 0;
                                    padding: 20px;
                                    font-family: Arial, sans-serif;
                                    background: #f5f5f5;
                                }
                                .container {
                                    max-width: 1200px;
                                    margin: 0 auto;
                                    background: white;
                                    border-radius: 8px;
                                    padding: 20px;
                                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                                }
                                h1 {
                                    color: #333;
                                    text-align: center;
                                    margin-bottom: 20px;
                                }
                                .image-container {
                                    text-align: center;
                                }
                                img {
                                    max-width: 100%;
                                    border-radius: 8px;
                                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                                }
                                .instructions {
                                    margin-top: 20px;
                                    padding: 15px;
                                    background: #e8f5e8;
                                    border-left: 4px solid #4CAF50;
                                    border-radius: 4px;
                                }
                                .instructions h3 {
                                    margin-top: 0;
                                    color: #2E7D32;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="container">
                                <h1>终端命令导出图片</h1>
                                <div class="image-container">
                                    <img src="${url}" alt="Terminal Commands Export" />
                                </div>
                                <div class="instructions">
                                    <h3>💡 如何保存图片：</h3>
                                    <p>1. 右键点击图片</p>
                                    <p>2. 选择"图片另存为"或"Save image as"</p>
                                    <p>3. 选择保存位置并确认</p>
                                </div>
                            </div>
                        </body>
                    </html>
                `)

                newWindow.document.close()
                console.log(`%c✅ 已在新窗口中打开图片，请右键保存`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
            } else {
                console.error('❌ 无法打开新窗口')
                alert('下载失败，请检查浏览器设置是否阻止了弹出窗口')
            }

        } catch (error) {
            console.error('❌ 备用下载方案也失败:', error)
            alert('图片导出失败，请查看控制台了解详情或尝试其他浏览器')
        }
    }

    // 复制图片到剪贴板
    private async copyImageToClipboard(blob: Blob): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                console.log(`%c📋 正在复制图片到剪贴板...`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

                // 检查剪贴板API是否可用
                if (!navigator.clipboard || !navigator.clipboard.write) {
                    throw new Error('Clipboard API not available')
                }

                const clipboardItem = new ClipboardItem({ 'image/png': blob })
                navigator.clipboard.write([clipboardItem]).then(() => {
                    console.log(`%c✅ 图片已复制到剪贴板！`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
                    console.log(`%c💡 现在可以在其他应用中直接粘贴使用了`, 'background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

                    // 显示成功提示
                    this.showSuccessNotification()
                    resolve()
                }).catch((error) => {
                    console.error('❌ 剪贴板复制失败:', error)
                    console.log(`%c⚠️ 剪贴板复制失败，可能是权限问题`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

                    // 显示备用提示
                    this.showFallbackNotification()
                    reject(error)
                })

            } catch (error) {
                console.error('❌ 剪贴板复制失败:', error)
                console.log(`%c⚠️ 剪贴板复制失败，可能是权限问题`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

                // 显示备用提示
                this.showFallbackNotification()
                reject(error)
            }
        })
    }

    // 显示下载通知
    private showDownloadNotification(): void {
        const notification = document.createElement('div')
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #2196F3;
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(33, 150, 243, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 10001;
            opacity: 0;
            transform: translateY(-10px);
            transition: all 0.3s ease;
        `

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span>💾</span>
                <span>图片已开始下载，请检查浏览器下载</span>
            </div>
        `

        document.body.appendChild(notification)

        // 动画显示
        setTimeout(() => {
            notification.style.opacity = '1'
            notification.style.transform = 'translateY(0)'
        }, 100)

        // 3秒后自动消失
        setTimeout(() => {
            notification.style.opacity = '0'
            notification.style.transform = 'translateY(-10px)'
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification)
                }
            }, 300)
        }, 3000)
    }

    // 显示成功通知
    private showSuccessNotification(): void {
        const notification = document.createElement('div')
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 10001;
            opacity: 0;
            transform: translateY(-10px);
            transition: all 0.3s ease;
        `

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span>✅</span>
                <span>图片已导出并复制到剪贴板！</span>
            </div>
        `

        document.body.appendChild(notification)

        // 动画显示
        setTimeout(() => {
            notification.style.opacity = '1'
            notification.style.transform = 'translateY(0)'
        }, 100)

        // 3秒后自动消失
        setTimeout(() => {
            notification.style.opacity = '0'
            notification.style.transform = 'translateY(-10px)'
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification)
                }
            }, 300)
        }, 3000)
    }

    // 显示备用通知
    private showFallbackNotification(): void {
        const notification = document.createElement('div')
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #FF9800;
            color: white;
            padding: 16px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            z-index: 10001;
            opacity: 0;
            transform: translateY(-10px);
            transition: all 0.3s ease;
        `

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span>⚠️</span>
                <span>图片已下载，但复制到剪贴板失败</span>
            </div>
        `

        document.body.appendChild(notification)

        // 动画显示
        setTimeout(() => {
            notification.style.opacity = '1'
            notification.style.transform = 'translateY(0)'
        }, 100)

        // 4秒后自动消失
        setTimeout(() => {
            notification.style.opacity = '0'
            notification.style.transform = 'translateY(-10px)'
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification)
                }
            }, 300)
        }, 4000)
    }

    // 显示导出选项（下载或复制到剪贴板）- 保留作为备用方法
    private showExportOptions(blob: Blob, blockCount: number): void {
        console.log(`%c🎯 导出选项`, 'background: #9C27B0; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        // 创建选项模态框
        const modal = document.createElement('div')
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            z-index: 10001;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 400px;
            width: 90%;
        `

        modal.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 24px; margin-bottom: 10px;">✅</div>
                <h3 style="margin: 0; color: #333;">导出成功！</h3>
                <p style="margin: 10px 0 0 0; color: #666;">成功导出 ${blockCount} 个命令区块</p>
            </div>

            <div style="display: flex; gap: 10px; flex-direction: column;">
                <button id="copy-clipboard" style="
                    padding: 12px 20px;
                    border: none;
                    border-radius: 6px;
                    background: #4CAF50;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: background-color 0.2s;
                ">📋 复制图片到剪贴板</button>

                <button id="view-download" style="
                    padding: 12px 20px;
                    border: none;
                    border-radius: 6px;
                    background: #2196F3;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: background-color 0.2s;
                ">📁 查看下载文件夹</button>

                <button id="close-modal" style="
                    padding: 12px 20px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    background: white;
                    color: #666;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: background-color 0.2s;
                ">关闭</button>
            </div>
        `

        // 创建遮罩层
        const overlay = document.createElement('div')
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
        `
        overlay.appendChild(modal)
        document.body.appendChild(overlay)

        // 绑定事件
        const copyBtn = modal.querySelector('#copy-clipboard') as HTMLButtonElement
        const viewBtn = modal.querySelector('#view-download') as HTMLButtonElement
        const closeBtn = modal.querySelector('#close-modal') as HTMLButtonElement

        copyBtn.onclick = async () => {
            try {
                console.log('📋 正在复制图片到剪贴板...')
                const clipboardItem = new ClipboardItem({ 'image/png': blob })
                await navigator.clipboard.write([clipboardItem])
                console.log('✅ 图片已复制到剪贴板！')

                copyBtn.textContent = '✅ 已复制到剪贴板！'
                copyBtn.style.background = '#4CAF50'
                setTimeout(() => {
                    copyBtn.textContent = '📋 复制图片到剪贴板'
                    copyBtn.style.background = '#4CAF50'
                }, 2000)
            } catch (error) {
                console.error('❌ 剪贴板复制失败:', error)
                copyBtn.textContent = '❌ 复制失败'
                copyBtn.style.background = '#f44336'

                // 提供备用方案
                alert('剪贴板复制失败，可能是权限问题。图片已下载到本地文件夹。')
                setTimeout(() => {
                    copyBtn.textContent = '📋 复制图片到剪贴板'
                    copyBtn.style.background = '#4CAF50'
                }, 2000)
            }
        }

        viewBtn.onclick = () => {
            console.log('📁 打开下载文件夹...')
            // 尝试打开浏览器下载管理器
            // 注意：这个功能高度依赖于浏览器实现，可能不工作
            try {
                // 在Chrome中，可以通过chrome://downloads/打开下载页面
                window.open('chrome://downloads/', '_blank')
            } catch (e) {
                console.log('⚠️ 无法自动打开下载文件夹，请手动查看浏览器下载')
                alert('请手动打开浏览器下载文件夹查看图片文件')
            }
        }

        closeBtn.onclick = () => {
            document.body.removeChild(overlay)
        }

        // 点击遮罩层关闭
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay)
            }
        }

        console.log('🎯 导出选项窗口已显示')
    }
}
