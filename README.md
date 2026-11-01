# 红果剧场 Web

自用短剧播放器，采用 React、TypeScript、Vite 和 Node.js，参考 [openhongguo](https://github.com/beilunyang/openhongguo) 接入短剧目录。桌面端参考抖音电脑网页版的沉浸布局：简洁侧栏，播放器占满剩余视口，信息和操作浮在画面上；手机端以竖屏播放和上下滑动为主。

支持搜索、推荐流、分集选择、收藏、观看记录和本站账号注册登录。网页与 Node API 分开，后续可以通过 Capacitor 将同一套前端装进 Android、iOS App。

搜索框也支持粘贴播放页链接来定位指定剧集，目前接受 `https://hongguoduanju.com/player/<剧集ID>` 和 `https://novelquickapp.com/player/<剧集ID>/<分集ID>`。例如 [《退役归来，这个保镖不好惹》](https://hongguoduanju.com/player/7697622096326708286)；只解析这些固定站点的剧集 ID，不把链接当作任意网络代理地址。

播放控件使用 [DPlayer](https://github.com/DIYgod/DPlayer)（MIT），提供中文播放控制、进度、音量和倍速设置。底部直接提供「上一集」「下一集」、清晰度和倍速按钮；手动下一集在剧集末尾禁用，分集分页时先加载后续集数。倍速支持 0.5、0.75、1、1.25、1.5、2、2.5、3 倍，选择保存在浏览器中，切集和切换清晰度时保留。底部右侧「网页全屏」可隐藏导航并占满网页，旁边的「系统全屏」隐藏浏览器界面。Esc 可退出；全屏时仍可选集和收藏。切换标签页或窗口不会主动暂停播放，只保存观看进度。

清晰度菜单按当前分集实际返回的片源生成，不固定列出不可用的档位。切换清晰度复用该分集缓存的播放模型；没有相同档位的后续分集使用该集默认档位。示例片源只有一个测试视频，不提供虚假的多档清晰度。切换会保留当前进度和暂停状态，需要重新缓冲；受保护的流式片源由后端从当前位置转换，播放器时间仍显示原剧进度，不能跳转到当前片段尚未缓冲或开播位置之前的内容。

播放器控制栏采用白色细进度条、统一图标和深灰弹出菜单；左侧集中播放、上一集/下一集与时间，右侧为清晰度、倍速、播放设置、网页全屏、音量和系统全屏。播放时闲置淡出，鼠标移入、键盘聚焦或展开菜单时显示。播放设置中的「单集循环」与倍速菜单分开，避免重复入口。

鼠标悬停或键盘聚焦右侧音量按钮会展开竖向滑块，可调节 0–100% 音量；点击扬声器静音，再点恢复原音量。音量保存在当前浏览器，下次打开自动恢复。

选集使用独立侧栏，展开时实际缩小视频容器，完整保留影片画面；两个「选集」入口均支持再次点击收起，选择分集后侧栏保持打开，可继续选择。手机端选集放在视频下方，视频与选集区域不重叠。

切换短剧、手动选集和播完自动续播都会更新地址栏：`?drama=<剧ID>&episode=<稳定分集ID>`；示例片源另外带有 `source=demo`。刷新页面或复制链接可定位到同一集，链接中指定的分集优先于本站观看历史；浏览器前进、后退也会恢复对应剧集。同一集的重试不会重复增加浏览器历史记录。刷新后的有声自动播放仍取决于浏览器策略，必要时点击播放。

## 本地运行

使用 Node.js 24、npm 和包含 `libx264`、AAC 编码器的完整 FFmpeg。FFmpeg 用于处理 SDK 正常提供的受保护片源，并把 HEVC 等浏览器兼容性有限的编码转成 H.264/AAC；它不包含在 npm 依赖或手机安装包中。在 Windows 上可先安装：

```powershell
winget install --id Gyan.FFmpeg --exact
```

也可以从 [Gyan 的 Windows 构建页面](https://www.gyan.dev/ffmpeg/builds/) 下载并将 `bin` 目录加入 PATH。macOS 可使用 `brew install ffmpeg`；Linux 使用发行版的 FFmpeg 软件包。安装后重新打开终端，确认：

```powershell
ffmpeg -version
```

在项目目录执行：

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

浏览器访问终端输出的网址，默认 [http://localhost:5173](http://localhost:5173)。开发服务器将 `/api` 转发到 Node 后端 `http://127.0.0.1:8787`。

```powershell
# 编译 Web 前端
npm run build

# Node API 同时托管编译后的 dist/
npm start
```

生产构建本地访问 [http://127.0.0.1:8787](http://127.0.0.1:8787)。仅执行前端预览命令不会启动真实 API；开发使用 `npm run dev`，运行编译结果使用 `npm start`。

## 数据与登录

**当前页面提供的是本站账号登录/注册，尚未接入红果官方账号登录。** 本项目目前通过 `openhongguo` 的匿名设备接口读取片源。本站账号由你运行的 Node 后端创建和验证，用于保存本服务的收藏与观看记录；它不能用于登录红果 App，也不会登录或同步红果官方账号的收藏、历史。默认用户名长度 2–32 个字符、密码长度 8–128 个字符；后端使用 scrypt 保存密码哈希，登录会话使用 HttpOnly Cookie。

抖音开放平台提供[官方网页扫码和跳转授权](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/web-app/web/permission)。若以后接入，需要审核通过的网站应用、ClientKey / ClientSecret、登记的 HTTPS 回调地址及后端 OAuth `state` 校验和 code 换 token；不要把应用密钥放进前端。当前没有接入这套授权，也没有伪造扫码入口。抖音 OAuth 可用于识别本站用户身份；本项目当前接入尚不支持红果用户会话、收藏、历史的授权同步，不能把两者等同。

私有数据默认位于 `server/data/`，包括账号、会话、收藏、观看记录和匿名设备档案。备份这个目录可以保留数据；不要将其提交到代码仓库或放进静态资源目录。也可以设置 `HONGGUO_DATA_DIR` 使用独立数据目录。不同浏览器登录同一个本站账号、连接同一个后端后，可以访问该账号保存的记录。

真实片源是默认入口。真实接口失败时显示错误和可用的重试入口，**不会自动切换为示例视频**；示例模式必须手动选择，只用于体验界面，不代表红果真实片源。

目录优先读取 SDK 的真人剧频道。仅在目录返回空数据时，改读真实真人剧榜单，并为榜单使用独立翻页标记；明确的账号授权、验证或限流错误不会触发这项备用请求。播放接口返回空模型时，按上游建议最多进行两次有限匿名设备恢复；收到 HTTP 429 时保留并等待 `Retry-After`，页面显示等待时间，避免立即重复请求。空响应不等于账号权限不足，也不代表所有分集都不可播放。

已经成功取得的签名播放模型按上游 `expires_at` 缓存，并提前 15 秒失效；未提供失效时间时最多缓存 5 分钟。这样切回已解析分集或重试播放器不会每隔 30 秒重新消耗一次模型请求。取消或超时的播放请求会终止对应网络操作，已取消的排队分集不会继续请求上游。

示例视频为本地《Sintel》预告片前约 30 秒，含音频，用于测试播放和音量；© Blender Foundation · [durian.blender.org](https://durian.blender.org/)，采用 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 许可。示例剧名、封面与视频内容不对应。

当 SDK 正常返回受保护分集的播放地址和内容密钥时，后端使用该密钥处理 CENC，密钥保留在后端。已确认的 AVC/H.264 受保护片源使用 `copy` 快速转封装为 fMP4；HEVC（包括 `bytevc1`）、AV1 或未知编码使用兼容转码，输出 H.264 Main、`avc1`、`yuv420p` 和 AAC 双声道 48kHz/128kbps。默认优先选择兼容的 720 档，显式选择其他清晰度时按源尺寸输出，竖屏最高 1080×1920，横屏最高 1920×1080，保持纵横比，不放大小尺寸片源；超出上限的 AVC 也会转码。菜单标签按实际输出尺寸生成。未加密的非 AVC 片源也使用相同兼容转码，未加密且无需缩小的 AVC 可直接播放。

转码使用 `libx264`、`veryfast`、CRF23、两条视频编码线程和低延迟碎片输出。前端接收临时同源流地址，不保存视频文件；FFmpeg 缺失或缺少编码器时给出相应配置错误。SDK 没有提供播放模型或可用密钥时，仍保留真实错误，不以转码替代平台授权。

同源流式媒体从头发送，暂不支持跳转到尚未缓冲的远端位置；已缓冲范围内的跳转取决于浏览器。临时播放地址有效期为 10 分钟，过期后重新点击播放，后端最多允许同时播放 3 路；连接断开或服务关闭时清理对应 FFmpeg 进程。

## 配置

参考 `.env.example`。前端 `VITE_` 变量在构建时写入页面，修改后需要重新构建。不要放入密码或密钥。

| 变量 | 作用 |
| --- | --- |
| `VITE_API_BASE_URL` | 默认空值，使用同源 API。App 构建填可达的 HTTPS 后端地址，不带末尾 `/api`。 |
| `HOST` | Node 监听地址，默认 `127.0.0.1`；同一局域网调试可设为 `0.0.0.0`。 |
| `PORT` | Node 端口，默认 `8787`。 |
| `HONGGUO_DATA_DIR` | 私有数据目录，默认 `server/data/`。 |
| `CORS_ORIGINS` | 允许携带登录 Cookie 的确切来源，使用逗号分隔；包含开发 Web、`https://localhost` 和 `capacitor://localhost`。 |
| `COOKIE_SECURE` | HTTPS 后端设为 `true`；纯 HTTP 本地开发设为 `false`。 |
| `COOKIE_SAME_SITE` | 默认 `lax`，也可设置 `strict`；App 使用跨站 HTTPS 后端时设为 `none`，同时必须设置 `COOKIE_SECURE=true`。 |
| `FFMPEG_PATH` | 默认 `ffmpeg`，从 PATH 查找；也可指定 `ffmpeg.exe` 或 `ffmpeg` 的绝对路径。 |

手机直接打开开发网页时，使用电脑的局域网 IP，并让前后端可从局域网访问。手机的 `localhost` 指向手机自身。Android 模拟器访问宿主机可使用 `10.0.2.2`；这些地址用于开发调试，打包前请使用可达的 HTTPS 后端。

## Android / iOS 打包

仓库已准备 `capacitor.config.ts`，静态资源目录为 `dist/`。Capacitor 只打包前端，**不会把 Node API 一起放进手机**；先运行或部署自己的 Node 后端，再在构建环境中设置 `VITE_API_BASE_URL`。

例如在 `.env.local` 中设置：

```dotenv
VITE_API_BASE_URL=https://your-private-api.example.com
```

HTTPS 反向代理应将请求转发到 Node API，后端允许 App 的确切 Origin，设置 `COOKIE_SECURE=true`、`COOKIE_SAME_SITE=none`。后端运行环境同样需要安装 FFmpeg。跨域 Cookie，尤其 iOS WKWebView 的持久登录，需要在目标真机上验证，必要时再接入原生会话存储或同源托管方案。

首次添加 Android 平台：

```powershell
npm run build
npx cap add android
npm run mobile:sync
npm run mobile:android
```

在 Android Studio 中选择模拟器或真机运行，生成 APK 时使用 Android Studio 的构建功能。Capacitor 8 的官方环境要求包括 Node.js 22+、Android Studio 2025.2.1+ 和 Android SDK；支持 Android 7 / API 24 及以上。详见 [Android 文档](https://capacitorjs.com/docs/android) 与 [环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)。

首次添加 iOS 平台需在安装了 Xcode 的 **macOS** 上执行：

```sh
npm run build
npx cap add ios
npm run mobile:sync
npm run mobile:ios
```

在 Xcode 里设置自己的签名团队和 Bundle ID，然后运行到模拟器或真机。Capacitor 8 官方要求 Xcode 26+，支持 iOS 15+；详见 [iOS 文档](https://capacitorjs.com/docs/ios)。Windows 可以开发网页和 Android 工程，不能在本机使用 Xcode 生成 iOS 安装包。

平台目录创建后，前端更新执行 `npm run mobile:sync`，再用对应 IDE 运行。当前交付包含 Web 源码和原生壳配置，未生成、签名或真机验证 APK / IPA。Web manifest 用于浏览器独立窗口展示，不提供视频离线下载。

## 项目结构

```text
src/                    React 前端与播放交互
server/                 Node API、SDK 适配、账号与持久化
server/data/            本地私有数据，禁止提交
public/                 网页图标与 manifest
capacitor.config.ts     Android / iOS 壳配置
dist/                   编译后的 Web 资源
```

本项目依赖的 [openhongguo Node SDK](https://github.com/beilunyang/openhongguo/tree/main/bindings/node) 使用 Go WebAssembly，不要求另外安装 Go 或原生动态库。请遵守上游项目的许可证与使用说明。

## 检查与验证范围

```powershell
npm test
npm run build
```

本轮 18 项服务端测试通过，覆盖账号和数据隔离、历史持久化、受保护播放地址不暴露密钥、SDK 字段转换、真实榜单备用目录及游标、签名模型缓存、429 等待、取消和超时、清晰度选源和模型复用，以及合成 HEVC 经完整 HTTP/FFmpeg 管线输出 H.264/AAC 的兼容性验证。清晰度测试实际检查了 1080×1920 与 360×640 输出；偏移测试使用前红后蓝的长 GOP 视频，确认从 2.2 秒开播时首帧来自蓝色段、剩余时长正确。

指定剧集《退役归来，这个保镖不好惹》（剧集 ID `7697622096326708286`）的第 51、100 集已取得真实 SDK 播放模型，并各完成 4 秒真实视频解码验证，输出确认是 H.264/AAC。桌面浏览器已实际播放第 51、100 集，并验证第 51→52→53 集自动续播。此项不是示例视频验证；它只证明这些分集在本次测试时可正常取流和播放，不承诺整部剧、长期连续播放或所有上游分集始终可用。Android/iOS 安装包尚未生成、签名或真机验证。

新增控件已通过桌面和 390px 窄屏浏览器检查。真实第 51 集从约 64.6 秒切换 1080p 与 480p 后，实际输出分别为 1080×1920、480×854，浏览器保留进度及暂停状态；已验证 3 倍速选择与切集保留、上一集/下一集快捷按钮、最后一集禁用下一集，以及两个选集入口再次点击收起。
