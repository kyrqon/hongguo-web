# 第三方许可与署名

本项目自有代码及自制演示媒体采用 Apache-2.0；第三方软件与媒体仍按各自许可使用。项目完整许可和版权声明见 [PROJECT-LICENSE.txt](PROJECT-LICENSE.txt) 与 [PROJECT-NOTICE.txt](PROJECT-NOTICE.txt)。

本清单对应当前锁定的生产依赖版本，保留软件作者的许可、版权和附带声明；它不替代各项原始许可证。

完整文本位于 public/licenses/。Vite 会将该目录复制到 Web 构建和 Capacitor 移动包中，可通过应用内 /licenses/index.html 离线查看。清单覆盖整个生产依赖图，其中包含后端和原生平台依赖；不代表每项都进入前端 JavaScript 包。

- React、React DOM、DPlayer、Capacitor 及多数依赖采用 MIT 许可。Lucide 采用 ISC，并保留源自 Feather 的 MIT 署名与许可。
- hls.js 采用 Apache-2.0。其原始 LICENSE 包含 Dailymotion 与 Brightcove 的声明；完整 Apache 条款另附于 Apache-2.0.txt。
- openhongguo 的安装包声明 Apache-2.0，并附有 Go BSD 声明。上游 README 另有“仅供学习和参考之用，禁止用于商业用途”的说明；该说明原文及链接保存在 UPSTREAM_USE_NOTICE.md，请结合上游全部条款评估使用方式。
- openhongguo 及其 Node 依赖仅供独立后端使用，移动壳不包含该后端或 SDK 的 WebAssembly 运行时。生成演示媒体所用的 FFmpeg 是外部开发工具，本仓库及移动包不附带其二进制。
- 软件许可不授予红果短剧、平台图片、账户凭据或内容密钥的分发权，也不表示本项目获得红果、抖音或字节跳动的官方授权。
- 演示视频由本项目脚本合成，未使用第三方影像或音乐；本地 Unsplash 图片的来源见 images/SOURCES.md。

## 当前生产依赖

| 依赖 | 版本 | 声明许可 | 随附文本 |
| --- | --- | --- | --- |
| @capacitor/android | 8.6.0 | MIT | [LICENSE](capacitor-android-8.6.0/LICENSE) |
| @capacitor/core | 8.6.0 | MIT | [LICENSE](capacitor-core-8.6.0/LICENSE) |
| @capacitor/ios | 8.6.0 | MIT | [LICENSE](capacitor-ios-8.6.0/LICENSE) |
| agent-base | 6.0.2 | MIT | [LICENSE.from-README.txt](agent-base-6.0.2/LICENSE.from-README.txt) |
| asynckit | 0.4.0 | MIT | [LICENSE](asynckit-0.4.0/LICENSE) |
| axios | 1.21.0 | MIT | [LICENSE](axios-1.21.0/LICENSE) |
| balloon-css | 1.2.0 | MIT | [LICENSE](balloon-css-1.2.0/LICENSE) |
| call-bind-apply-helpers | 1.0.2 | MIT | [LICENSE](call-bind-apply-helpers-1.0.2/LICENSE) |
| combined-stream | 1.0.8 | MIT | [License](combined-stream-1.0.8/License) |
| debug | 4.4.3 | MIT | [LICENSE](debug-4.4.3/LICENSE) |
| delayed-stream | 1.0.0 | MIT | [License](delayed-stream-1.0.0/License) |
| dplayer | 1.27.1 | MIT | [LICENSE](dplayer-1.27.1/LICENSE) |
| dunder-proto | 1.0.1 | MIT | [LICENSE](dunder-proto-1.0.1/LICENSE) |
| es-define-property | 1.0.1 | MIT | [LICENSE](es-define-property-1.0.1/LICENSE) |
| es-errors | 1.3.0 | MIT | [LICENSE](es-errors-1.3.0/LICENSE) |
| es-object-atoms | 1.1.2 | MIT | [LICENSE](es-object-atoms-1.1.2/LICENSE) |
| es-set-tostringtag | 2.1.0 | MIT | [LICENSE](es-set-tostringtag-2.1.0/LICENSE) |
| follow-redirects | 1.16.2 | MIT | [LICENSE](follow-redirects-1.16.2/LICENSE) |
| form-data | 4.0.6 | MIT | [License](form-data-4.0.6/License) |
| function-bind | 1.1.2 | MIT | [LICENSE](function-bind-1.1.2/LICENSE) |
| get-intrinsic | 1.3.0 | MIT | [LICENSE](get-intrinsic-1.3.0/LICENSE) |
| get-proto | 1.0.1 | MIT | [LICENSE](get-proto-1.0.1/LICENSE) |
| gopd | 1.2.0 | MIT | [LICENSE](gopd-1.2.0/LICENSE) |
| has-symbols | 1.1.0 | MIT | [LICENSE](has-symbols-1.1.0/LICENSE) |
| has-tostringtag | 1.0.2 | MIT | [LICENSE](has-tostringtag-1.0.2/LICENSE) |
| hasown | 2.0.4 | MIT | [LICENSE](hasown-2.0.4/LICENSE) |
| hls.js | 1.7.4 | Apache-2.0 | [LICENSE](hls.js-1.7.4/LICENSE) |
| https-proxy-agent | 5.0.1 | MIT | [LICENSE.from-README.txt](https-proxy-agent-5.0.1/LICENSE.from-README.txt) |
| lucide-react | 0.468.0 | ISC | [LICENSE](lucide-react-0.468.0/LICENSE) |
| math-intrinsics | 1.1.0 | MIT | [LICENSE](math-intrinsics-1.1.0/LICENSE) |
| mime-db | 1.52.0 | MIT | [LICENSE](mime-db-1.52.0/LICENSE) |
| mime-types | 2.1.35 | MIT | [LICENSE](mime-types-2.1.35/LICENSE) |
| ms | 2.1.3 | MIT | [license.md](ms-2.1.3/license.md) |
| openhongguo | 0.1.0 | Apache-2.0 | [GO_LICENSE](openhongguo-0.1.0/GO_LICENSE) · [LICENSE](openhongguo-0.1.0/LICENSE) |
| promise-polyfill | 8.3.0 | MIT | [LICENSE](promise-polyfill-8.3.0/LICENSE) |
| proxy-from-env | 2.1.0 | MIT | [LICENSE](proxy-from-env-2.1.0/LICENSE) |
| react | 19.3.1 | MIT | [LICENSE](react-19.3.1/LICENSE) |
| react-dom | 19.3.1 | MIT | [LICENSE](react-dom-19.3.1/LICENSE) |
| scheduler | 0.28.0 | MIT | [LICENSE](scheduler-0.28.0/LICENSE) |
| tslib | 2.9.1 | 0BSD | [CopyrightNotice.txt](tslib-2.9.1/CopyrightNotice.txt) · [LICENSE.txt](tslib-2.9.1/LICENSE.txt) |

## 补充文本

- [Apache License 2.0 完整条款](Apache-2.0.txt)
- [Feather MIT 许可](Feather-MIT.txt)
- [openhongguo 上游用途说明](openhongguo-0.1.0/UPSTREAM_USE_NOTICE.md)

旧版 agent-base 与 https-proxy-agent 的发布包未提供独立 LICENSE 文件，因此保留了其原始 README 中完整的 MIT 许可段落（LICENSE.from-README.txt）；tslib 的 LICENSE.txt 与 CopyrightNotice.txt 均予保留。原始许可文本未作实质修改。

媒体来源：[../images/SOURCES.md](../images/SOURCES.md)。
