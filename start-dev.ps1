# NettyTabby插件开发启动脚本

Write-Host "🚀 NettyTabby插件开发启动脚本" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

# 检查插件是否已构建
$IndexJsPath = Join-Path $PSScriptRoot "dist\index.js"
if (!(Test-Path $IndexJsPath)) {
    Write-Host "❌ 插件未构建，正在构建..." -ForegroundColor Red
    & npm run build:prod
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 构建失败！" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ 插件构建完成" -ForegroundColor Green
}

# 设置环境变量
$PluginPath = $PSScriptRoot
$env:TABBY_PLUGINS = $PluginPath
Write-Host "🔧 TABBY_PLUGINS环境变量: $env:TABBY_PLUGINS" -ForegroundColor Cyan

# 启动Tabby
Write-Host "🎯 启动Tabby进行插件测试..." -ForegroundColor Yellow
Write-Host "📋 预期结果:" -ForegroundColor White
Write-Host "  1. 工具栏出现 📷 按钮" -ForegroundColor White
Write-Host "  2. 点击按钮弹出提示框" -ForegroundColor White
Write-Host "  3. 控制台显示插件加载信息" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "🔍 如果看不到插件，请检查:" -ForegroundColor Yellow
Write-Host "  1. Tabby是否已关闭其他实例" -ForegroundColor White
Write-Host "  2. 环境变量是否正确设置" -ForegroundColor White
Write-Host "  3. 开发者工具控制台是否有错误" -ForegroundColor White
Write-Host "" -ForegroundColor White

# 启动Tabby
try {
    & tabby --debug
} catch {
    Write-Host "❌ 启动Tabby失败: $_" -ForegroundColor Red
    Write-Host "💡 请确保Tabby已安装且在PATH中" -ForegroundColor Yellow
}
