# 演示封面图片来源

这些图片仅作为界面示例封面，均为 Unsplash 公开照片，不是红果短剧的官方剧照或海报。短剧标题和封面之间没有真实作品关联。

| 本地文件 | 内容 | 原始图片地址 |
| --- | --- | --- |
| hero.jpg | 蓝紫电影光人像，竖幅 | https://images.unsplash.com/photo-1534528741775-53994a69daeb |
| love.jpg | 日落下双手比心，竖幅 | https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2 |
| city.jpg | 雨后城市街道，竖幅 | https://images.unsplash.com/photo-1519501025264-65ba15a82390 |
| costume.jpg | 山间古建与佛像，竖幅 | https://images.unsplash.com/photo-1513415564515-763d91423bdd |
| suspense.jpg | 蓝紫霓虹夜街，横幅 | https://images.unsplash.com/photo-1519608487953-e999c86e7455 |
| family.jpg | 海边日落家庭剪影，横幅 | https://images.unsplash.com/photo-1511895426328-dc8714191300 |

下载日期：2026-11-01。下载参数为宽度 700–800 像素、JPEG 质量 78–80，每张图片小于 210 KB。图片已经保存在本地，正常界面预览不依赖第三方图片域名。

Unsplash 使用条款：https://unsplash.com/license

## 本地示例视频

- 文件：public/videos/demo.mp4，488,600 字节（约 477 KiB）。
- 来源：本项目通过 scripts/generate-demo.mjs 调用本机 FFmpeg 程序生成，没有下载或引用第三方视频、照片、音乐、字体或标志。
- 内容：深色网格背景与运动的橙色、蓝色方块；音轨是合成的 330 Hz 测试音，首尾各淡入、淡出 1 秒。仅用于播放器功能演示，不是真实红果短剧。
- 重现：安装本机 FFmpeg 后运行 node scripts/generate-demo.mjs。不同编码器版本生成的文件字节可能不同。
- 已用 ffprobe 验证：时长 30.000 秒；720 × 1280、24 fps、H.264 Main / yuv420p 视频；48 kHz 立体声 AAC 音轨。ffmpeg volumedetect 测得平均音量 -21.3 dB、峰值 -17.8 dB。
- 本项目自行生成的媒体和生成脚本遵循项目根许可证。FFmpeg 仅作为外部生成工具，本仓库与移动包不附带其二进制。
- 文件保存在本地，示例播放不依赖外部视频域名。
