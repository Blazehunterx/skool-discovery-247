import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

chromium.use(stealth());

async function debugScroll() {
    const storagePath = path.join(__dirname, 'skool_storage_state.json');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: storagePath });
    const page = await context.newPage();

    console.log("Navigating to members...");
    await page.goto('https://www.skool.com/skoolers/-/members', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const countRaw = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const match = bodyText.match(/Showing\s+(\d+[\d,]*)\s+of/i);
        const links = Array.from(document.querySelectorAll('a[href*="/@"]')).length;
        return { text: match ? match[0] : 'not found', links };
    });
    console.log("Initial state:", countRaw);

    console.log("Scrolling 5 times...");
    for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 5000);
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
    }

    const countFinal = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const match = bodyText.match(/Showing\s+(\d+[\d,]*)\s+of/i);
        const links = Array.from(document.querySelectorAll('a[href*="/@"]')).length;
        return { text: match ? match[0] : 'not found', links };
    });
    console.log("Final state:", countFinal);

    await browser.close();
}

debugScroll();
