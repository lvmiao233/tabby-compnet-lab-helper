# Tabby Compnet Lab Helper

为降低计算机网络课程实验中实验报告填写的负担，TA为Cisco设备实体机/GNS3模拟环境实验开发了本Tabby插件，可实现便捷的截图与标记

## 📦 插件安装

### 1. 下载插件
从 [GitHub Releases](https://github.com/lvmiao233/tabby-compnet-lab-helper/releases) 下载最新版本的 zip 文件，并进行解压，解压后的目录格式应当类似：

```
tabby-compnet-lab-helper/
├── dist/
└── package.json
```

### 2. 安装插件
1. 打开Tabby终端
2. 进入设置 (Settings) → 插件 (Plugins)
3. 点击"插件目录"按钮
4. 将解压好的插件复制到插件目录下的node_modules目录
5. 重启Tabby

### 3. 验证安装
重启后，工具栏应该出现 📷 图标按钮

## 🚀 使用方法

### 基本操作流程
1. **执行命令**：在终端中正常执行你的实验命令
2. **开始捕获**：点击工具栏的 📷 按钮
3. **选择命令**：在弹出窗口中选择要导出的命令区块，如需进行标记（下划线/框选），可点击标记按钮进入绘制页面
4. **导出图片**：选择导出方式完成截图

### 选择模式
- **按区块选择**：自动识别完整命令区块
- **按行选择**：点击开关切换到行选择模式，可精确选择每一行

### 导出选项
- **📋 复制到剪贴板**：直接复制图片，可粘贴到Word、Typora等
- **💾 下载并复制**：同时下载到本地并复制到剪贴板

## ✨ 主要功能

### 🎯 智能命令识别
- 自动识别Cisco交换机/路由器设备的命令提示符与输出
- 智能区分命令提示符和执行结果

### 🖼️ 命令截图导出/标记
- 保持原始终端显示效果，可直接用于实验报告
- 支持标记后导出，可快速完成实验报告所要求的标记操作

## GNS3一键启动

请确保安装了Putty，并在合适的目录根据系统情况创建以下脚本文件，其中，plink的路径需根据实际情况填写

### Windows版本 (telnet.bat)
```batch
@echo off
"C:\Program Files\PuTTY\plink.exe" -telnet %1 -P %2
```

### macOS版本 (telnet.sh)
```bash
#!/bin/bash
/usr/local/bin/plink -telnet "$1" -P "$2"
```

### Linux版本 (telnet.sh)
```bash
#!/bin/bash
/usr/bin/plink -telnet "$1" -P "$2"
```

完成后，请在GNS3的首选项-General-Console Applications中，点击Edit并选择Custom终端，按以下格式填写，其中`"path\to\Tabby"`是你的Tabby可执行文件路径，`"path\to\script"`是上述脚本路径，完成后保存

```
"path\to\Tabby" run "path\to\script" %h %p"
```

## 🔧 常见问题

* 命令识别不准确，分块错误： 可切换到"按行选择"模式，手动选择需要的具体行，以临时规避错误的命令区块识别，得到精确的截图内容

## 📞 获取帮助

如果遇到问题或需要帮助：
1. 查看上方的常见问题解答
2. 访问项目主页：[GitHub仓库](https://github.com/lvmiao233/tabby-compnet-lab-helper)
3. 提交Issue反馈问题

## 开发相关

> [!NOTE]
>
> 请注意：如果你仅希望安装本插件，而不是对本项目进行二次开发，请忽略本部分，按照上述部分教程操作

### 开发环境配置

1. **安装依赖**
   ```bash
   npm install
   ```

2. **构建插件**
   ```bash
   npm run build:prod
   ```

### 插件测试方式

1. **设置环境变量**
   ```bash
   # Windows PowerShell
   $env:TABBY_PLUGINS = "你的插件目录绝对路径"

   # Linux/macOS
   export TABBY_PLUGINS="你的插件目录绝对路径"
   ```

2. **启动Tabby进行测试**
   ```bash
   tabby --debug
   ```

### 自动发布流程

项目配置了 GitHub Actions 自动发布流程：

1. **推送标签**：当推送 `v*` 格式的标签时，自动触发发布流程
2. **自动构建**：GitHub Actions 会自动安装依赖并构建项目

```bash
# 1. 更新版本号
npm version patch  # 或 minor, major

# 2. 提交更改
git add .
git commit -m "type(scope): message"

# 3. 推送标签触发自动发布
git tag vX.X.X
git push origin main --tags
```