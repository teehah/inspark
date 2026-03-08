import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 3000)); // wait for WebGL render
await page.screenshot({ path: 'screenshot.png' });
await browser.close();
console.log('Screenshot saved to screenshot.png');
