import { NgModule, Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton } from 'tabby-core'
import { CaptureService } from './services/capture.service'
import { NettySettingsTabProvider } from './components/settings.component'

@Injectable()
export class NettyToolbarButtonProvider extends ToolbarButtonProvider {
    constructor(private captureService: CaptureService) {
        super()
    }

    provide(): ToolbarButton[] {
        return [{
            icon: '📷',
            title: 'Netty捕获',
            weight: 10,
            click: () => {
                console.log('🎯 工具栏按钮被点击')
                this.captureService.toggleCaptureMode()
            }
        }]
    }
}

@NgModule({
    providers: [
        { provide: ToolbarButtonProvider, useClass: NettyToolbarButtonProvider, multi: true },
        CaptureService
    ]
})
export default class NettyPluginModule {
    constructor() {
        console.log('🚀 NettyTabby插件已加载 - 终端底部状态栏模式')
    }
}
