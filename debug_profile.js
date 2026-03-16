import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_STATE_FILE = path.join(__dirname, 'skool_storage_state.json');

async function debugProfile(url) {
    console.log(`Debugging profile: ${url}`);
    const browser = await chromium.launch({ headless: true });
    let context;
    if (fs.existsSync(STORAGE_STATE_FILE)) {
        context = await browser.newContext({ storageState: STORAGE_STATE_FILE });
    } else {
        context = await browser.newContext();
    }
    const page = await context.newPage();
    try {
        console.log("Navigating...");
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(10000); // Wait for scripts to settle

        const screenshotPath = path.join(__dirname, 'debug_screenshot.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to ${screenshotPath}`);

        const profileInfo = await page.evaluate(() => {
            const results = {};
            const h1 = document.querySelector('h1');
            const h2 = document.querySelector('h2');
            const displayName = document.querySelector('.display-name');
            const title = document.title;
            
            // Try to find the name in many places
            results.h1 = h1 ? h1.innerText : null;
            results.h2 = h2 ? h2.innerText : null;
            results.displayName = displayName ? displayName.innerText : null;
            results.title = title;
            
            // Try common Skool profile name classes
            const altName = document.querySelector('[class*="ProfileName"], [class*="displayName"], [class*="fullName"]');
            results.altName = altName ? altName.innerText : null;

            return results;
        });

        console.log("Extraction Results:", JSON.stringify(profileInfo, null, 2));

        // Test file write
        const testFile = path.join(__dirname, 'debug_test.json');
        fs.writeFileSync(testFile, JSON.stringify({ success: true, timestamp: new Date().toISOString() }));
        console.log("File write test successful.");

    } catch (e) {
        console.error("FATAL ERROR:", e.message);
    } finally {
        await browser.close();
        console.log("Cleanup complete.");
    }
}

const target = process.argv[2] || 'https://www.skool.com/@akasshashokgupta?g=skoolers';
debugProfile(target).catch(console.error);
