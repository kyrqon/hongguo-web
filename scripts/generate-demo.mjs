import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const output = fileURLToPath(new URL('../public/videos/demo.mp4', import.meta.url));
const temporary = output.replace(/\.mp4$/, `.generating-${process.pid}.mp4`);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
await mkdir(dirname(output), { recursive: true });

// All pictures and sound are synthesized by FFmpeg. No footage, music, fonts,
// logos or other third-party media are embedded in this demonstration clip.
const graph = [
  '[0:v]drawgrid=w=120:h=160:t=1:c=white@0.06[grid]',
  "[grid][1:v]overlay=x='(W-w)*(sin(t/3)+1)/2':y='(H-h)*(cos(t/4)+1)/2':shortest=1[first]",
  "[first][2:v]overlay=x='(W-w)*(cos(t/5)+1)/2':y='(H-h)*(sin(t/3)+1)/2':shortest=1,format=yuv420p[video]",
  '[3:a]afade=t=in:st=0:d=1,afade=t=out:st=29:d=1,pan=stereo|c0=c0|c1=c0[audio]',
].join(';');
try {
  await run(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x14141c:s=720x1280:r=24:d=30',
    '-f', 'lavfi', '-i', 'color=c=0xff7862:s=150x150:r=24:d=30',
    '-f', 'lavfi', '-i', 'color=c=0x5c73ff:s=90x90:r=24:d=30',
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=30',
    '-filter_complex', graph, '-map', '[video]', '-map', '[audio]',
    '-t', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25',
    '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', '-metadata', 'title=Local player demonstration',
    '-metadata', 'comment=Generated locally from synthetic color blocks and a 330 Hz test tone; no external media.',
    '-y', temporary,
  ], { timeout: 120000, windowsHide: true, maxBuffer: 1024 * 1024 });
  await rename(temporary, output);
  console.log(`Generated ${output}`);
} finally { await rm(temporary, { force: true }); }
