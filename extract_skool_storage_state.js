import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, 'skool_session');
const OUTPUT_FILE = path.join(__dirname, 'skool_storage_state.json');

async function extract() {
    console.log("Extracting compact Storage State from persistent profile...");

    if (!fs.existsSync(SESSION_DIR)) {
        console.error("ERROR: skool_session directory not found!");
        process.exit(1);
    }

    const context = await chromium.launchPersistentContext(SESSION_DIR, {
        headless: true
    });

    try {
        // Save storage state (cookies + local storage)
        await context.storageState({ path: OUTPUT_FILE });
        await context.close();

        const stats = fs.statSync(OUTPUT_FILE);
        console.log(`Success! Compact session saved to: ${OUTPUT_FILE} (${Math.round(stats.size / 1024)} KB)`);

        const storageData = fs.readFileSync(OUTPUT_FILE, 'utf8');
        const base64 = Buffer.from(storageData).toString('base64');

        const base64File = path.join(__dirname, 'skool_session_base64.txt');
        fs.writeFileSync(base64File, base64);
        
        console.log("\n--- COMPACT SESSION READY ---");
        console.log(`1. File saved to: ${base64File}`);
        console.log("2. This version is 1000x smaller and WILL work on GitHub.");
        console.log("3. Copy the string from the file and update your GitHub Secret: SKOOL_SESSION_BASE64");
    } catch (e) {
        console.error("FAILED to extract storage state:", e.message);
        await context.close();
    }
}

extract();
