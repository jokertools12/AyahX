import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import puppeteer from 'puppeteer-core';
import { resolveChromiumExecutablePath } from '../renderer/frameRenderer';

async function main() {
  const scratchDir = path.join(os.tmpdir(), `test_bg_bench_${Date.now()}`);
  fs.mkdirSync(scratchDir, { recursive: true });

  console.log('Scratch dir:', scratchDir);

  // 1. Create a 3-second test background video with moving shapes/colors
  const testVideoPath = path.join(scratchDir, 'test_input.mp4');
  console.log('Generating test video with motion...');
  const t0 = Date.now();
  spawnSync(ffmpegPath!, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=1080x1920:rate=30',
    '-t', '3',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    testVideoPath,
  ]);
  console.log(`Test video generated in ${Date.now() - t0}ms, size: ${(fs.statSync(testVideoPath).size / 1024).toFixed(1)} KB`);

  // Option 1: FFmpeg extract frames to JPEG
  const framesDir = path.join(scratchDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  console.log('Extracting 90 frames via FFmpeg...');
  const t1 = Date.now();
  const ext = spawnSync(ffmpegPath!, [
    '-y',
    '-i', testVideoPath,
    '-vf', 'scale=1080:1920',
    '-q:v', '2',
    path.join(framesDir, 'frame_%05d.jpg'),
  ]);
  const extTime = Date.now() - t1;
  const frameCount = fs.readdirSync(framesDir).length;
  console.log(`FFmpeg extracted ${frameCount} frames in ${extTime}ms! (${(extTime / frameCount).toFixed(1)}ms per frame)`);

  // Test Puppeteer loading these frames onto canvas
  const chromePath = resolveChromiumExecutablePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-web-security'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  // Test page with canvas
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body style="margin:0;overflow:hidden">
        <canvas id="c" width="1080" height="1920"></canvas>
        <script>
          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d', { alpha: false });
          const img = new Image();

          window.loadAndDrawFrame = function(url) {
            return new Promise((resolve) => {
              img.onload = () => {
                ctx.drawImage(img, 0, 0, 1080, 1920);
                resolve(true);
              };
              img.onerror = () => resolve(false);
              img.src = url;
            });
          };
        </script>
      </body>
    </html>
  `);

  const t2 = Date.now();
  for (let i = 1; i <= 30; i++) {
    const frameFile = `file://${path.join(framesDir, `frame_${String(i).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}`;
    await page.evaluate(async (url) => {
      await (window as any).loadAndDrawFrame(url);
    }, frameFile);
    await page.screenshot({ type: 'jpeg', quality: 90 });
  }
  const drawTime = Date.now() - t2;
  console.log(`Puppeteer drew & screenshotted 30 frames in ${drawTime}ms (${(drawTime / 30).toFixed(1)}ms per frame)`);

  // Test Option 2: HTML5 Video Seeking on local file
  console.log('Testing Option 2: HTML5 Video Seeking in Puppeteer...');
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body style="margin:0;overflow:hidden">
        <canvas id="c" width="1080" height="1920"></canvas>
        <video id="v" src="file://${testVideoPath.replace(/\\/g, '/')}" preload="auto" muted playsinline></video>
        <script>
          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d', { alpha: false });
          const video = document.getElementById('v');

          window.seekAndDraw = function(targetSec) {
            return new Promise((resolve) => {
              if (Math.abs(video.currentTime - targetSec) < 0.001 && video.readyState >= 2) {
                ctx.drawImage(video, 0, 0, 1080, 1920);
                return resolve(true);
              }
              let done = false;
              const onSeeked = () => {
                if (done) return;
                done = true;
                video.removeEventListener('seeked', onSeeked);
                ctx.drawImage(video, 0, 0, 1080, 1920);
                resolve(true);
              };
              video.addEventListener('seeked', onSeeked);
              video.currentTime = targetSec;
              setTimeout(() => {
                if (!done) {
                  done = true;
                  video.removeEventListener('seeked', onSeeked);
                  try { ctx.drawImage(video, 0, 0, 1080, 1920); } catch(e){}
                  resolve(false);
                }
              }, 500);
            });
          };
        </script>
      </body>
    </html>
  `);

  const t3 = Date.now();
  let seekSuccess = 0;
  for (let i = 0; i < 30; i++) {
    const sec = i / 30;
    const ok = await page.evaluate(async (s) => {
      return await (window as any).seekAndDraw(s);
    }, sec);
    if (ok) seekSuccess++;
    await page.screenshot({ type: 'jpeg', quality: 90 });
  }
  const seekTime = Date.now() - t3;
  console.log(`Puppeteer HTML5 video seeked ${seekSuccess}/30 frames in ${seekTime}ms (${(seekTime / 30).toFixed(1)}ms per frame)`);

  await browser.close();

  // Cleanup
  fs.rmSync(scratchDir, { recursive: true, force: true });
  console.log('Done!');
}

main().catch(console.error);
