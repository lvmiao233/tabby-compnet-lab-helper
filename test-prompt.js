// 测试Cisco提示符识别逻辑 - 检查行是否包含提示符（开头）
function isPromptLineSimple(line) {
    const trimmed = line.trim()

    // 如果行为空，肯定不是提示符
    if (!trimmed) {
        return false
    }

    // Cisco设备提示符特征检测
    // 检查行是否以Cisco提示符开头
    
    // 模式1: hostname# 或 hostname> (后面可能跟命令)
    const basicPromptMatch = trimmed.match(/^([a-zA-Z0-9_-]+)([>#])/);
    if (basicPromptMatch) {
        return true;
    }
    
    // 模式2: hostname(config)# 或 hostname(config-xxx)# (后面可能跟命令)
    const configPromptMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\([^)]*config[^)]*\)([>#])/);
    if (configPromptMatch) {
        return true;
    }

    // 通用提示符检测（作为备选）
    if (trimmed.includes('>') && (
        trimmed.includes(':\\') ||  // Windows路径: C:\, D:\CompNetDocRefactor>
        trimmed.includes('$ ') ||   // Unix提示符: user@host: $
        trimmed.includes('# ') ||   // 管理员提示符: root@host: #
        trimmed.match(/^[^>]*>/)    // 以提示符开头
    )) {
        return true
    }

    // Unix/Linux风格提示符检测
    if (trimmed.match(/^[^#$]*[#$]/)) {
        const beforePrompt = trimmed.split(/[#$]/)[0].trim();
        if (beforePrompt.length > 0) {
            // SSH/Unix模式: user@host:/path
            if (beforePrompt.includes('@') || beforePrompt.includes(':')) {
                return true
            }
            // 简单的路径模式: /path/to/dir
            if (beforePrompt.includes('/') || beforePrompt.includes('\\')) {
                return true
            }
        }
    }

    return false
}

// 测试用例 - 真实终端输出格式（提示符和命令在同一行）
const testLines = [
    "R2#",                                      // 只有提示符
    "R2#en",                                    // 提示符+命令
    "R2#conf t",                                // 提示符+命令
    "Enter configuration commands, one per line.  End with CNTL/Z.",  // 系统输出
    "R2(config)#int f0/0",                     // 提示符+命令
    "R2(config-if)#no shut",                   // 提示符+命令
    "R2(config-if)#exi",                       // 提示符+命令
    "R2(config)#int v",                        // 提示符+命令（错误）
    "*Mar  1 10:32:22.453: %LINK-3-UPDOWN: Interface FastEthernet0/0, changed state to up",  // 系统日志
    "*Mar  1 10:32:23.453: %LINEPROTO-5-UPDOWN: Line protocol on Interface FastEthernet0/0, changed state to up",  // 系统日志
    "R2(config)#int vlan 1",                   // 提示符+命令（错误）
    "                ^",                        // 错误指示
    "% Invalid input detected at '^' marker.", // 错误信息
    "R2(config)#vlan 1",                       // 提示符+命令（错误）
    "                ^",                        // 错误指示
    "% Invalid input detected at '^' marker.", // 错误信息
    "R2(config)#ospf 54",                      // 提示符+命令（错误）
    "            ^",                            // 错误指示
    "% Invalid input detected at '^' marker.", // 错误信息
    "R2(config)#exi"                           // 提示符+命令
];

console.log("=== 提示符识别测试 ===\n");

testLines.forEach((line, index) => {
    const isPrompt = isPromptLineSimple(line);
    console.log(`行 ${index.toString().padStart(2, '0')}: ${isPrompt ? '✓' : '✗'} "${line}"`);
});

console.log("\n=== 识别出的提示符行 ===");
testLines.forEach((line, index) => {
    const isPrompt = isPromptLineSimple(line);
    if (isPrompt) {
        console.log(`行 ${index.toString().padStart(2, '0')}: "${line}"`);
    }
});

console.log("\n=== 模拟区块分割逻辑 ===");

function identifyCommandBlocks(lines) {
    const blocks = [];
    let pendingBlock = null;

    console.log('开始分析命令交互区块...');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isPrompt = isPromptLineSimple(line);

        if (isPrompt) {
            // 遇到提示符：检查前一个区块是否有内容
            if (pendingBlock && pendingBlock.lines.length > 1) {
                // 有实际命令内容，创建区块
                blocks.push({
                    id: `block-${blocks.length}`,
                    lineStart: pendingBlock.start,
                    lineEnd: pendingBlock.start + pendingBlock.lines.length - 1,
                    content: pendingBlock.lines.join('\n'),
                    lines: pendingBlock.lines
                });
                console.log(`创建区块 ${blocks.length}: 行 ${pendingBlock.start}-${pendingBlock.start + pendingBlock.lines.length - 1}`);
            }

            // 开始新的潜在区块
            pendingBlock = {
                start: i,
                lines: [line]
            };
        } else if (pendingBlock) {
            // 继续累积当前潜在区块的内容
            pendingBlock.lines.push(line);
        } else {
            // 第一行不是提示符，创建一个临时的容器来累积内容
            pendingBlock = {
                start: i,
                lines: [line]
            };
        }
    }

    // 处理最后一个潜在区块
    if (pendingBlock && pendingBlock.lines.length > 0) {
        // 检查是否有实际内容（不仅仅是提示符）
        const hasActualContent = pendingBlock.lines.some((line, index) =>
            index > 0 && line.trim().length > 0 && !isPromptLineSimple(line)
        );

        if (hasActualContent) {
            blocks.push({
                id: `block-${blocks.length}`,
                lineStart: pendingBlock.start,
                lineEnd: pendingBlock.start + pendingBlock.lines.length - 1,
                content: pendingBlock.lines.join('\n'),
                lines: pendingBlock.lines
            });
            console.log(`创建最后区块 ${blocks.length}: 行 ${pendingBlock.start}-${pendingBlock.start + pendingBlock.lines.length - 1}`);
        }
    }

    return blocks;
}

const blocks = identifyCommandBlocks(testLines);

console.log(`\n=== 区块分割结果 (共${blocks.length}个区块) ===`);
blocks.forEach((block, index) => {
    console.log(`\n区块 ${index + 1}:`);
    console.log(`  行范围: ${block.lineStart}-${block.lineEnd}`);
    console.log(`  内容:`);
    block.lines.forEach((line, lineIndex) => {
        console.log(`    ${(block.lineStart + lineIndex).toString().padStart(2, '0')}: ${line}`);
    });
});
