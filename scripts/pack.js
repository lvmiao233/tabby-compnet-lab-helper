const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// 读取 package.json 获取版本信息
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;
const name = packageJson.name;

const outputFileName = `${name}-v${version}.zip`;
const output = fs.createWriteStream(outputFileName);
const archive = archiver('zip', {
  zlib: { level: 9 } // 最高压缩级别
});

output.on('close', function() {
  console.log(`✅ 打包完成: ${outputFileName}`);
  console.log(`📦 文件大小: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
});

archive.on('error', function(err) {
  throw err;
});

// 将输出流绑定到 archiver
archive.pipe(output);

// 创建外层文件夹结构
const folderName = 'tabby-compnet-lab-helper';

// 添加 dist 目录到外层文件夹
archive.directory('dist/', `${folderName}/dist/`);

// 添加 package.json 到外层文件夹
archive.file('package.json', { name: `${folderName}/package.json` });

// 完成归档
archive.finalize();
