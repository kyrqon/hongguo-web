import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const version = process.env.VERSION;
if (!version || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('Invalid version');
const files = readdirSync('release').filter(name => !['SHA256SUMS.txt', 'release-notes.md'].includes(name)).sort();
if (!files.some(name => name.endsWith('.apk')) || !files.some(name => name.endsWith('.ipa')) || !files.some(name => name.endsWith('-ios-simulator.app.zip'))) throw new Error('Missing mobile packages; refuse to publish an incomplete release');
const sums = files.map(name => `${createHash('sha256').update(readFileSync(`release/${name}`)).digest('hex')}  ${name}`).join('\n');
writeFileSync('release/SHA256SUMS.txt', `${sums}\n`);
writeFileSync('release/release-notes.md', `# 红果剧场 ${version} 预览版\n\n` +
  `这是个人学习/研究用途的首次移动端预览发布。流水线已执行服务端测试、Web 构建和原生编译，尚未做 Android/iOS 真机验证。\n\n` +
  `## 下载内容\n\n` +
  `- **Android debug APK**：调试签名，可安装；不是应用商店生产包。后续预览的签名可能变化，升级时可能需要先卸载旧版。\n` +
  `- **iOS unsigned IPA**：未签名 arm64 真机编译产物，供检查或后续签名；**不能直接安装到 iPhone，也不是 TestFlight/App Store 安装包**。\n` +
  `- **iOS simulator .app.zip**：适用于 arm64/x86_64 Mac 上的 iOS 模拟器，解压后用 Xcode 或 simctl 安装。\n` +
  `- **Web ZIP** 与 **后端源码 ZIP**：Node 后端需另外运行，并安装 FFmpeg。\n` +
  `- **SHA256SUMS.txt**：下载文件校验值。\n\n` +
  `## 首次启动\n\n` +
  `手机端首次启动填写你自己部署的 HTTPS 后端根地址，不带 /api。安装包仅包含前端，不包含 Node 服务、账号数据、设备档案或真实短剧文件。后端的 CORS、HTTPS 和 Cookie 配置见 README。\n\n` +
  `本站账号只保存所连接服务的收藏与观看记录，尚未接入红果官方账号。片源可用性仍由上游决定。\n\n` +
  `第三方许可与素材说明已随 Web 和移动端资源附带；代码许可不代表获得平台内容授权。\n\n` +
  `构建提交：\`${process.env.BUILD_COMMIT || 'unknown'}\`\n`);
