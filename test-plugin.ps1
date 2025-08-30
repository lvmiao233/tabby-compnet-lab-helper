# NettyTabby插件测试脚本

Write-Host "🚀 NettyTabby插件测试脚本" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

# 获取插件目录的绝对路径
$PluginPath = Get-Location
Write-Host "📁 插件路径: $PluginPath" -ForegroundColor Cyan

# 设置环境变量
Write-Host "🔧 设置环境变量..." -ForegroundColor Yellow
$env:TABBY_PLUGINS = $PluginPath

# 检查环境变量是否设置成功
Write-Host "✅ TABBY_PLUGINS环境变量: $env:TABBY_PLUGINS" -ForegroundColor Green

# 检查构建文件是否存在
$DistPath = Join-Path $PluginPath "dist"
$IndexJsPath = Join-Path $DistPath "index.js"

if (Test-Path $IndexJsPath) {
    Write-Host "✅ 插件构建文件存在: $IndexJsPath" -ForegroundColor Green
    $FileSize = (Get-Item $IndexJsPath).Length / 1MB
    Write-Host ("📊 文件大小: {0:N2} MB" -f $FileSize) -ForegroundColor Blue
} else {
    Write-Host "❌ 插件构建文件不存在，请先运行 npm run build:prod" -ForegroundColor Red
    exit 1
}

# 检查package.json
$PackageJsonPath = Join-Path $PluginPath "package.json"
if (Test-Path $PackageJsonPath) {
    Write-Host "✅ package.json存在" -ForegroundColor Green
    try {
        $PackageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
        Write-Host "📦 插件名称: $($PackageJson.name)" -ForegroundColor Cyan
        Write-Host "🏷️  关键词: $($PackageJson.keywords -join ', ')" -ForegroundColor Cyan
        Write-Host "📝 描述: $($PackageJson.description)" -ForegroundColor Cyan
    } catch {
        Write-Host "❌ package.json格式错误: $_" -ForegroundColor Red
    }
} else {
    Write-Host "❌ package.json不存在" -ForegroundColor Red
}

Write-Host "`n🎯 测试说明:" -ForegroundColor Yellow
Write-Host "1. 环境变量TABBY_PLUGINS已设置为: $env:TABBY_PLUGINS" -ForegroundColor White
Write-Host "2. 请在新终端窗口中运行: tabby --debug" -ForegroundColor White
Write-Host "3. 在Tabby中应该能看到工具栏按钮 (📷)" -ForegroundColor White
Write-Host "4. 点击按钮应该弹出提示框" -ForegroundColor White
Write-Host "5. 打开开发者工具(F12)查看控制台输出" -ForegroundColor White

Write-Host "`n🔍 调试提示:" -ForegroundColor Yellow
Write-Host "- 如果看不到插件，检查Tabby是否在其他终端中运行" -ForegroundColor White
Write-Host "- 如果仍有错误，检查Tabby的控制台输出" -ForegroundColor White
Write-Host "- 确保插件目录路径不包含特殊字符" -ForegroundColor White

Write-Host "`n✨ 准备完成！请在新终端中启动Tabby测试插件。" -ForegroundColor Green
