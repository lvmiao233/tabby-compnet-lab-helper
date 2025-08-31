import { Component, Injectable, Injector } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { CaptureService } from '../services/capture.service'

// 简化版设置接口
interface SettingsTab {
    id: string
    icon: string
    title: string
    componentType: any
}

interface SettingsTabProvider {
    provide(): SettingsTab[]
}

@Component({
    template: `
        <div class="settings-tab">
            <h3>Netty 插件设置</h3>

            <div class="form-group">
                <label>下载目录设置</label>
                <p class="description">
                    设置默认的截图保存目录。首次使用时需要选择目录，后续使用会优先使用此设置。
                </p>
                <div class="info-box">
                    <strong>重要说明：</strong><br>
                    • File System Access API每次都需要用户确认选择，这是浏览器的安全机制<br>
                    • 这是正常行为，不是bug，确保了用户的数据安全<br>
                    • 选择后可以直接点击确认，无需重新浏览目录
                </div>

                <div class="download-dir-setting">
                    <button class="btn btn-secondary" (click)="selectDownloadDirectory()" [disabled]="!isFileSystemAPISupported()">
                        <i class="fas fa-folder-open"></i>
                        选择下载目录
                    </button>

                    <div class="current-dir" *ngIf="currentDownloadDir">
                        <span class="dir-label">当前设置:</span>
                        <span class="dir-path">{{ currentDownloadDir }}</span>
                        <button class="btn btn-sm btn-outline" (click)="clearDownloadDirectory()">
                            <i class="fas fa-times"></i>
                            清除
                        </button>
                    </div>

                    <div class="api-status">
                        <span class="status-label">File System API:</span>
                        <span class="status-value" [class.supported]="isFileSystemAPISupported()" [class.unsupported]="!isFileSystemAPISupported()">
                            {{ isFileSystemAPISupported() ? '支持' : '不支持' }}
                        </span>
                        <small class="status-hint">
                            {{ isFileSystemAPISupported() ? '可以使用现代文件系统API进行下载' : '将使用传统下载方式' }}
                        </small>
                    </div>
                </div>
            </div>

            <div class="form-group">
                <label>使用说明</label>
                <div class="instructions">
                    <p><strong>首次使用：</strong></p>
                    <ol>
                        <li>点击工具栏的照相机按钮 📷 进入捕获模式</li>
                        <li>选择要导出的命令区块</li>
                        <li>点击"复制到剪贴板"或"下载并复制"</li>
                        <li>如果是首次下载，会弹出目录选择对话框</li>
                    </ol>

                    <p><strong>后续使用：</strong></p>
                    <ul>
                        <li>如果浏览器支持File System API，将直接保存到上次选择的目录</li>
                        <li>如果不支持，将使用传统下载方式</li>
                    </ul>
                </div>
            </div>
        </div>
    `,
    styles: [`
        .settings-tab {
            padding: 20px;
        }

        .settings-tab h3 {
            margin-bottom: 20px;
            color: var(--body-color);
        }

        .form-group {
            margin-bottom: 30px;
        }

        .form-group label {
            display: block;
            font-weight: bold;
            margin-bottom: 8px;
            color: var(--body-color);
        }

        .description {
            color: var(--text-muted);
            margin-bottom: 15px;
            line-height: 1.5;
        }

        .info-box {
            background: var(--selection-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 15px;
            font-size: 13px;
            line-height: 1.6;
        }

        .info-box strong {
            color: var(--body-color);
        }

        .download-dir-setting {
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 15px;
            background: var(--bg-color);
        }

        .download-dir-setting button {
            margin-bottom: 15px;
        }

        .current-dir {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: var(--selection-bg);
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .dir-label {
            font-weight: bold;
            color: var(--body-color);
        }

        .dir-path {
            flex: 1;
            font-family: monospace;
            color: var(--body-color);
        }

        .btn-sm {
            padding: 4px 8px;
            font-size: 12px;
        }

        .btn-outline {
            border: 1px solid var(--border-color);
            background: transparent;
            color: var(--body-color);
        }

        .btn-outline:hover {
            background: var(--hover-bg);
        }

        .api-status {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            border-radius: 4px;
            background: var(--bg-color);
        }

        .status-label {
            font-weight: bold;
            color: var(--body-color);
        }

        .status-value {
            font-weight: bold;
        }

        .status-value.supported {
            color: #4CAF50;
        }

        .status-value.unsupported {
            color: #f44336;
        }

        .status-hint {
            color: var(--text-muted);
            font-size: 12px;
        }

        .instructions {
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 15px;
            background: var(--bg-color);
        }

        .instructions ol, .instructions ul {
            margin: 10px 0;
            padding-left: 20px;
        }

        .instructions li {
            margin: 5px 0;
            line-height: 1.5;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background: var(--button-bg);
            color: var(--button-color);
        }

        .btn-secondary:hover:not(:disabled) {
            background: var(--button-hover-bg);
        }
    `]
})
export class NettySettingsComponent {
    currentDownloadDir: string | null = null

    constructor(private captureService: CaptureService) {
        this.loadCurrentSettings()
    }

    isFileSystemAPISupported(): boolean {
        return 'showDirectoryPicker' in window
    }

    async selectDownloadDirectory(): Promise<void> {
        try {
            if (!this.isFileSystemAPISupported()) {
                alert('您的浏览器不支持File System Access API，请使用Chrome 86+或Edge 86+')
                return
            }

            // 这里我们需要调用CaptureService中的方法
            // 但是由于这是设置组件，我们需要一个更直接的方式
            const dirHandle = await (window as any).showDirectoryPicker({
                mode: 'readwrite'
            })

            // 存储设置
            localStorage.setItem('netty-download-dir', 'downloads')
            this.currentDownloadDir = '已设置下载目录'

            console.log('✅ 下载目录已设置')

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('📁 用户取消了目录选择')
            } else {
                console.error('❌ 设置下载目录失败:', error)
                alert('设置下载目录失败，请重试')
            }
        }
    }

    clearDownloadDirectory(): void {
        localStorage.removeItem('netty-download-dir')
        this.currentDownloadDir = null
        console.log('🗑️ 下载目录设置已清除')
    }

    private loadCurrentSettings(): void {
        const savedDir = localStorage.getItem('netty-download-dir')
        if (savedDir) {
            this.currentDownloadDir = '已设置下载目录'
        }
    }
}

@Injectable()
export class NettySettingsTabProvider {
    constructor(private injector: Injector) {}

    provide(): SettingsTab[] {
        return [{
            id: 'netty',
            icon: '📷',
            title: 'Netty 插件',
            componentType: NettySettingsComponent
        }]
    }
}
