import { Injectable, NgZone, Injector, Component } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'
import { AppService, ThemesService } from 'tabby-core'

// xterm.js类型定义
interface IBuffer {
    getLine(y: number): IBufferLine | undefined
    length: number
}

// Electron API类型定义
interface ElectronAPI {
    shell?: {
        showItemInFolder(fullPath: string): void
    }
}

// File System Access API类型定义
interface FileSystemAPI {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite', startIn?: string }): Promise<FileSystemDirectoryHandle>
}

interface FileSystemDirectoryHandle {
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
}

interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream {
    write(data: Blob | BufferSource | string): Promise<void>
    close(): Promise<void>
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

    private currentBrowseIndex = -1 // 当前浏览的区块索引
    private availableBlocks: CaptureBlock[] = [] // 所有可用的区块
    private selectionMode: 'block' | 'line' = 'block' // 选择模式：按区块或按行
    private themesService: ThemesService | null = null // 主题服务
    private electronAPI: ElectronAPI | null = null // Electron API
    private fileSystemAPI: FileSystemAPI | null = null // File System API
    private isSelectingDirectory = false // 防止并发目录选择

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

        // 尝试获取Electron API和File System API
        console.log('🔧 开始初始化API...')

        // 初始化Electron API
        try {
            if (typeof (window as any).require === 'function') {
                const electron = (window as any).require('electron')
                console.log('📦 electron对象属性:', Object.keys(electron || {}))

                if (electron && electron.shell) {
                    this.electronAPI = { shell: electron.shell }
                    console.log('⚡ Electron shell API已初始化')
                }
            }
        } catch (error) {
            console.warn('⚠️ Electron API初始化失败:', error instanceof Error ? error.message : String(error))
        }

        // 初始化File System API
        try {
            if ('showDirectoryPicker' in window) {
                this.fileSystemAPI = window as any
                console.log('⚡ File System Access API已初始化')
            } else {
                console.warn('⚠️ 浏览器不支持File System Access API')
            }
        } catch (error) {
            console.warn('⚠️ File System API初始化失败:', error instanceof Error ? error.message : String(error))
        }

        console.log('🔧 API初始化完成 - Electron:', !!this.electronAPI, 'FileSystem:', !!this.fileSystemAPI)

        console.log('📸 CaptureService 初始化')

        // 状态条功能已移除，界面更加简洁
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

    // 状态条功能已完全移除

    // 快捷键功能已完全移除，界面更加简洁

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
        console.log(`🔄 浏览到区块 ${this.currentBrowseIndex + 1}/${this.availableBlocks.length}`)
        console.log(`📋 当前区块内容: ${this.availableBlocks[this.currentBrowseIndex].content.substring(0, 50)}...`)
    }

    browsePreviousBlock(): void {
        if (this.availableBlocks.length === 0) return

        this.currentBrowseIndex = this.currentBrowseIndex <= 0 ?
            this.availableBlocks.length - 1 : this.currentBrowseIndex - 1
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
        this.updateAllBlockHighlights() // 更新所有高亮
    }

    // 取消选择所有区块
    clearAllSelections(): void {
        this.clearSelection()
        console.log('❌ 取消所有选择')
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
            max-width: 95vw;
            max-height: 95vh;
            width: 95vw;
            height: 95vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            color: ${themeColors.foreground};
        `

        // 移除模态框头部，所有功能合并到底部工具栏

        // 模态框主体
        const modalBody = document.createElement('div')
        modalBody.style.cssText = `
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            min-height: 0;
        `

        // 移除统计信息显示

        // 区块列表
        const blocksList = document.createElement('div')
        blocksList.style.cssText = `
            height: 100%;
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



        // 模态框底部工具栏
        const modalFooter = document.createElement('div')
        modalFooter.style.cssText = `
            flex-shrink: 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 12px 16px;
            border-top: 1px solid ${themeColors.border};
            background: ${themeColors.backgroundSecondary};
            border-radius: 0 0 8px 8px;
            color: ${themeColors.foreground};
            height: 60px;
        `

        // 左侧：标题文字
        const leftSection = document.createElement('div')
        leftSection.style.cssText = `
            font-size: 14px;
            font-weight: 600;
            color: ${themeColors.foreground};
        `
        leftSection.textContent = '选择实验命令导出'

        // 右侧：控制按钮
        const rightSection = document.createElement('div')
        rightSection.style.cssText = 'display: flex; gap: 8px; align-items: center;'

        // 行选择/区块选择滑块
        const modeSwitch = document.createElement('label')
        modeSwitch.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: ${themeColors.muted};
            cursor: pointer;
            user-select: none;
            margin-right: 8px;
        `

        const modeCheckbox = document.createElement('input')
        modeCheckbox.type = 'checkbox'
        modeCheckbox.checked = this.selectionMode === 'line'
        modeCheckbox.style.cssText = `
            width: 14px;
            height: 14px;
            cursor: pointer;
        `

        const modeLabel = document.createElement('span')
        modeLabel.textContent = '按行选择'
        modeLabel.style.cssText = 'font-weight: 500;'

        modeCheckbox.onchange = () => {
            const previousMode = this.selectionMode
            this.selectionMode = modeCheckbox.checked ? 'line' : 'block'
            console.log(`🔄 切换到${this.selectionMode === 'block' ? '按区块选择' : '按行选择'}模式`)

            // 重新渲染区块列表以应用新的选择模式
            this.refreshBlockDisplay(blocksList, blocks, modalFooter, themeColors)
        }

        modeSwitch.appendChild(modeCheckbox)
        modeSwitch.appendChild(modeLabel)

        // 清空按钮（SVG图标）
        const clearBtn = this.createIconButton(`
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
            </svg>
        `, '清空', () => {
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

        // 复制到剪贴板按钮（SVG图标）
        const copyBtn = this.createIconButton(`
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17,9H7V7H17M17,13H7V11H17M14,17H7V15H14M12,3A1,1 0 0,1 13,4V6H11V4A1,1 0 0,1 12,3M7,3A1,1 0 0,1 8,4V6H6V4A1,1 0 0,1 7,3M19,3H15V7H19M5,3H1V7H5M3,9H21V21H3V9Z"/>
            </svg>
        `, '复制到剪贴板', () => {
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

        // 下载并复制按钮（SVG图标）
        const downloadBtn = this.createIconButton(`
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/>
            </svg>
        `, '下载并复制', () => {
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

        // 关闭按钮（SVG图标）
        const closeBtn = this.createIconButton(`
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
            </svg>
        `, '关闭', () => {
            this.closeModal(modalContainer)
            // 关闭模态框时自动退出捕获模式
            this.toggleCaptureMode()
        }, themeColors)

        rightSection.appendChild(modeSwitch)
        rightSection.appendChild(clearBtn)
        rightSection.appendChild(copyBtn)
        rightSection.appendChild(downloadBtn)
        rightSection.appendChild(closeBtn)

        modalFooter.appendChild(leftSection)
        modalFooter.appendChild(rightSection)

        // 组装模态框
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

        // 不再更新按钮文本，保持SVG图标
        // 按钮现在使用SVG图标，不需要动态更新文字

        console.log(`🔄 更新模态框显示: ${displayText}`)
    }

    // 关闭模态框
    private closeModal(modal: HTMLElement): void {
        if (modal && modal.parentNode) {
            modal.parentNode.removeChild(modal)
            console.log('🪟 区块选择窗口已关闭')
        }
    }

    // 创建图标按钮（只有图标，没有文字）
    private createIconButton(icon: string, title: string, onClick: () => void, themeColors?: any): HTMLElement {
        const button = document.createElement('button')
        button.innerHTML = icon
        button.title = title
        button.onclick = onClick

        // 使用主题颜色
        const colors = themeColors || {
            primary: '#4CAF50',
            secondary: '#f5f5f5',
            success: '#28a745',
            danger: '#dc3545',
            border: '#ddd',
            foreground: '#333',
            background: '#ffffff',
            muted: '#6c757d'
        }

        const baseStyle = `
            width: 28px;
            height: 28px;
            border: 1px solid ${colors.border};
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            background: transparent;
            color: ${colors.foreground};
            padding: 0;
        `

        button.style.cssText = baseStyle

        button.onmouseover = () => {
            button.style.backgroundColor = 'rgba(76, 175, 80, 0.1)'
            button.style.borderColor = colors.primary
            button.style.color = colors.primary
        }
        button.onmouseout = () => {
            button.style.backgroundColor = 'transparent'
            button.style.borderColor = colors.border
            button.style.color = colors.foreground
        }

        return button
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

            // 等待样式加载和内容渲染完成后渲染图片
            setTimeout(() => {
                // 确保容器内容完全渲染
                const contentElement = renderContainer.querySelector('.terminal-commands') as HTMLElement
                if (contentElement) {
                    // 强制重新计算布局
                    contentElement.offsetHeight
                }

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

            // 等待样式加载和内容渲染完成后渲染图片
            setTimeout(() => {
                // 确保容器内容完全渲染
                const contentElement = renderContainer.querySelector('.terminal-commands') as HTMLElement
                if (contentElement) {
                    // 强制重新计算布局
                    contentElement.offsetHeight
                }

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
        // 简化版：只保留命令内容，去除标题、时间戳等
        let html = `<div class="terminal-commands">`

        blocks.forEach((block, index) => {
            let content = ''

            if (this.selectionMode === 'line' && block.selectedLines) {
                // 按行选择模式：只导出选中的行
                const lines = block.content.split('\n')
                content = lines
                    .filter((line, lineIndex) => block.selectedLines![lineIndex])
                    .join('\n')
            } else {
                // 按区块选择模式：直接使用原始区块内容
                content = block.content
            }

            if (content.trim()) {
                // 简化HTML结构，直接输出命令内容
                html += `<div class="command-line">${this.escapeHtml(content)}</div>`
            }
        })

        html += `</div>`
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
            .terminal-commands {
                background: #1e1e1e;
                color: #cccccc;
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                font-size: 14px;
                line-height: 1.4;
                width: 100%;
                box-sizing: border-box;
                padding: 4px 8px;
            }

            .command-line {
                color: #cccccc;
                white-space: pre-wrap;
                word-break: break-word;
                margin: 0;
                padding: 2px 0;
            }

            .command-line:last-child {
                margin-bottom: 0;
            }

            /* 移除所有不必要的空白和边框 */
            .terminal-commands * {
                margin: 0;
                padding: 0;
                border: none;
                box-sizing: border-box;
            }

            /* 确保页面级别的紧凑布局 */
            body, html {
                margin: 0;
                padding: 0;
                background: #1e1e1e;
            }
        `
    }

    // 将HTML渲染为图片
    private async renderHTMLToImage(container: HTMLElement, blockCount: number): Promise<Blob | null> {
        console.log(`%c🎨 开始将HTML渲染为图片...`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        try {
                    // 获取容器尺寸 - 先用HTML容器宽度，高度稍后调整
        const rect = container.getBoundingClientRect()
        const width = rect.width // 根据内容自适应宽度

        // 先创建一个临时canvas来测量实际内容高度
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = width
        tempCanvas.height = 1000 // 临时高度，用于测量

        const tempCtx = tempCanvas.getContext('2d')
        if (!tempCtx) {
            throw new Error('无法获取临时canvas 2d上下文')
        }

        // 在临时canvas上渲染内容以计算实际高度和宽度
        const { height: actualHeight, maxWidth: contentMaxWidth } = await this.measureTerminalContent(container, width, blockCount)

        // 使用内容的实际最大宽度，留出一些边距
        const finalWidth = Math.max(contentMaxWidth + 40, 200) // 至少200px宽，左右各20px边距

        console.log(`%c📐 图片尺寸: ${finalWidth}x${actualHeight} (内容最大宽度: ${contentMaxWidth})`, 'background: #9C27B0; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        // 创建实际的canvas，使用计算出的实际宽度和高度
        const canvas = document.createElement('canvas')
        canvas.width = finalWidth
        canvas.height = actualHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) {
            throw new Error('无法获取canvas 2d上下文')
        }

        // 设置背景
        ctx.fillStyle = '#1e1e1e'
        ctx.fillRect(0, 0, finalWidth, actualHeight)

        // 使用实际canvas重新渲染内容（不再返回高度）
        await this.renderTerminalContentToCanvas(ctx, container, finalWidth, actualHeight, blockCount)

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

    // 测量终端内容的实际尺寸
    private async measureTerminalContent(
        container: HTMLElement,
        width: number,
        blockCount: number
    ): Promise<{ height: number; maxWidth: number }> {
        // 创建临时canvas用于测量
        const measureCanvas = document.createElement('canvas')
        const measureCtx = measureCanvas.getContext('2d')
        if (!measureCtx) {
            throw new Error('无法获取测量canvas 2d上下文')
        }

        // 设置字体（与渲染时相同）
        measureCtx.font = '14px Consolas, Monaco, "Courier New", monospace'

        let y = 8  // 从8px开始
        let maxWidth = 0

        // 测量所有命令行的尺寸
        const commandLines = container.querySelectorAll('.command-line')
        commandLines.forEach((commandLine, index) => {
            if (commandLine.textContent) {
                const contentLines = commandLine.textContent.split('\n')
                contentLines.forEach(line => {
                    // 测量这一行的宽度
                    const metrics = measureCtx.measureText(line)
                    maxWidth = Math.max(maxWidth, metrics.width)

                    // 累加高度（行高18px）
                    y += 18
                })

                // 区块间距
                y += 10
            }
        })

        return { height: y, maxWidth }
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

        let y = 8  // 减少顶部空白，从8px开始

        // 获取命令内容并渲染 - 使用新的简化HTML结构
        const commandLines = container.querySelectorAll('.command-line')
        commandLines.forEach((commandLine, index) => {
            if (commandLine.textContent) {
                // 渲染命令行内容
                ctx.fillStyle = '#cccccc'
                ctx.font = '14px Consolas, Monaco, "Courier New", monospace'

                const contentLines = commandLine.textContent.split('\n')
                contentLines.forEach(line => {
                    // 完全按照终端显示的方式渲染，不进行任何换行处理
                    ctx.fillText(line, 20, y)
                    y += 18
                })

                y += 10 // 区块间距
            }
        })

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
    private async performDownload(blob: Blob, blockCount: number): Promise<void> {
        try {
            const timestamp = new Date().getTime()
            const filename = `netty-commands-${timestamp}-${blockCount}-blocks.png`

            // 检查是否有Electron API可用
            if (this.electronAPI) {
                await this.performSmartDownload(blob, filename, blockCount)
            } else {
                console.log('⚠️ Electron API不可用，使用传统下载方式')
                this.performTraditionalDownload(blob, filename)
            }

        } catch (error) {
            console.error('❌ 图片下载失败:', error)
            console.log(`%c⚠️ 下载失败，尝试备用方案...`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

            // 备用方案：创建一个新的窗口显示图片，让用户右键保存
            this.fallbackDownload(blob, blockCount)
        }
    }

    // 智能下载：优先使用File System Access API，降级到传统下载
    private async performSmartDownload(blob: Blob, filename: string, blockCount: number): Promise<void> {
        try {
            console.log(`%c🎯 开始智能下载流程`, 'background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
            console.log(`%c📄 文件名: ${filename}`, 'background: #9C27B0; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
            console.log(`%c📊 区块数量: ${blockCount}`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

            // 优先使用File System Access API
            console.log('🔍 检查this.fileSystemAPI:', !!this.fileSystemAPI)
            console.log('🔍 this.fileSystemAPI类型:', typeof this.fileSystemAPI)
            console.log('🔍 window.showDirectoryPicker存在:', typeof (window as any).showDirectoryPicker)

            if (this.fileSystemAPI) {
                console.log('📂 尝试使用File System Access API...')

                // 检查是否正在进行目录选择
                if (this.isSelectingDirectory) {
                    console.log('⚠️ 目录选择正在进行中，请稍后再试')
                    this.performTraditionalDownload(blob, filename)
                    return
                }

                // 选择下载目录
                console.log('📂 调用selectDownloadDirectory...')
                console.log('📂 this.selectDownloadDirectory方法存在:', typeof this.selectDownloadDirectory)
                const dirHandle = await this.selectDownloadDirectory()
                console.log('📂 selectDownloadDirectory返回:', dirHandle ? '成功' : '失败')

                if (dirHandle) {
                    console.log('📝 开始调用writeFileWithFSAPI...')
                    // 写入文件
                    const savedFilename = await this.writeFileWithFSAPI(dirHandle, filename, blob)
                    console.log('📝 writeFileWithFSAPI返回:', savedFilename)

                    console.log(`%c🟢 文件保存成功！`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
                    console.log(`%c📂 已保存到选择的目录: ${savedFilename}`, 'background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

                    // 尝试打开文件所在目录（如果shell API可用）
                    if (this.electronAPI && this.electronAPI.shell) {
                        // 注意：这里我们不知道确切的路径，只能尝试打开downloads文件夹
                        setTimeout(() => {
                            this.showInFolder('downloads')
                        }, 500)
                    }

                    // 延迟退出捕获模式，给用户时间看到成功消息
                    setTimeout(() => {
                        console.log('🔄 文件保存完成，准备退出捕获模式')
                        this.toggleCaptureMode()
                    }, 1000)

                    return
                } else {
                    console.log('📁 用户取消了目录选择，降级到传统下载')
                }
            } else {
                console.log('⚠️ File System Access API不可用，降级到传统下载')
            }

            // 降级到传统下载
            this.performTraditionalDownload(blob, filename)

        } catch (error) {
            console.error('🔴 智能下载失败:', error)
            console.log('⚠️ 尝试使用传统下载作为后备方案')
            this.performTraditionalDownload(blob, filename)
        }
    }

    // 传统下载：作为后备方案
    private performTraditionalDownload(blob: Blob, filename: string): void {
        console.log(`%c📥 使用传统下载模式`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')

        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.style.display = 'none'

        document.body.appendChild(a)

        setTimeout(() => {
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            console.log(`%c✅ 传统下载已触发`, 'background: #4CAF50; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
            console.log(`%c📁 请在弹出的保存对话框中选择保存位置`, 'background: #FF9800; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
        }, 100)
    }

    // 使用File System Access API写入文件
    private async writeFileWithFSAPI(dirHandle: FileSystemDirectoryHandle, filename: string, blob: Blob): Promise<string> {
        console.log('📝 开始写入文件:', filename)
        console.log('📊 Blob大小:', blob.size, 'bytes')

        try {
            console.log('📄 创建文件句柄...')
            // 创建或获取文件句柄
            const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
            console.log('✅ 文件句柄创建成功')

            console.log('✏️ 创建可写流...')
            // 创建可写流
            const writable = await fileHandle.createWritable()
            console.log('✅ 可写流创建成功')

            console.log('💾 开始写入数据...')
            // 写入数据
            await writable.write(blob)
            console.log('✅ 数据写入成功')

            console.log('🔒 关闭可写流...')
            await writable.close()
            console.log('✅ 可写流关闭成功')

            console.log('🎉 文件写入完成')
            // 返回文件名（用于后续操作）
            return filename
        } catch (error) {
            console.error('❌ File System API写入失败:', error)
            console.log('🔍 错误详情:', {
                message: error instanceof Error ? error.message : String(error),
                name: error instanceof Error ? error.name : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
            })
            throw new Error(`File System API写入失败: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    // 选择下载目录
    private async selectDownloadDirectory(): Promise<FileSystemDirectoryHandle | null> {
        console.log('🏁 进入selectDownloadDirectory方法')
        console.log('🔍 方法内this.fileSystemAPI:', !!this.fileSystemAPI)
        console.log('🔍 方法内this.fileSystemAPI类型:', typeof this.fileSystemAPI)

        if (!this.fileSystemAPI) {
            console.warn('⚠️ File System Access API不可用')
            return null
        }

        console.log('✅ 通过API检查，开始目录选择...')

        // 防止并发调用
        if (this.isSelectingDirectory) {
            console.log('⚠️ 目录选择器已在运行中，请稍后再试')
            return null
        }

        this.isSelectingDirectory = true

        try {
            // 获取上次保存的目录路径
            const savedDirPath = localStorage.getItem('netty-download-dir')
            console.log('📂 获取savedDirPath:', savedDirPath)

            console.log('📂 准备调用showDirectoryPicker...')
            console.log('📂 this.fileSystemAPI.showDirectoryPicker类型:', typeof this.fileSystemAPI.showDirectoryPicker)

            // 选择目录
            const dirHandle = await this.fileSystemAPI.showDirectoryPicker({
                mode: 'readwrite',
                startIn: savedDirPath || undefined
            })

            console.log('📂 showDirectoryPicker调用完成')

            // 保存目录路径到本地存储
            localStorage.setItem('netty-download-dir', 'downloads') // 简化存储，只保存标识

            console.log('💡 提示：File System Access API每次都需要用户确认，这是浏览器的安全机制')
            console.log('✅ 目录已成功选择，下次使用时仍然需要确认选择')

            return dirHandle
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('📁 用户取消了目录选择')
            } else if (error instanceof Error && error.name === 'NotAllowedError') {
                console.log('⚠️ 文件选择器已在运行中，请关闭其他文件对话框后再试')
                // 延迟一段时间再重置标志，给用户一些缓冲时间
                setTimeout(() => {
                    this.isSelectingDirectory = false
                }, 1000)
                return null
            } else {
                console.error('❌ 选择目录失败:', error)
            }
            return null
        } finally {
            // 重置标志
            this.isSelectingDirectory = false
        }
    }

    // 传统的文件写入方法（备用）
    private writeFileSafely(filePath: string, data: Buffer): void {
        try {
            // 在Electron环境中，我们需要使用不同的方式访问fs
            const fs = (window as any).require('fs')
            fs.writeFileSync(filePath, data)
        } catch (error) {
            throw new Error(`文件写入失败: ${error}`)
        }
    }

    // 在文件管理器中显示文件
    private showInFolder(filePath: string): void {
        if (!this.electronAPI || !this.electronAPI.shell) {
            console.warn('⚠️ Electron shell API不可用')
            return
        }

        try {
            this.electronAPI.shell.showItemInFolder(filePath)
            console.log(`%c📂 已打开文件所在文件夹`, 'background: #2196F3; color: white; padding: 2px 8px; border-radius: 3px; font-weight: bold')
        } catch (error) {
            console.warn('⚠️ 无法打开文件所在文件夹:', error)
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
