import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'git_automation.log');
const CRAWLER_SCRIPT = path.join(__dirname, 'skoolers_deep_crawl.js');
const OUTREACH_SCRIPT = path.join(__dirname, '..', 'ig_dm_automation.js');
const LEADS_FILE = path.join(__dirname, 'skool_qualified_from_skoolers.json');
const POLLING_INTERVAL_MS = 60 * 1000; // Check state every minute
const REST_PERIOD_MS = 60 * 60 * 1000; // 1 hour rest after success

function log(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}\n`;
    console.log(entry.trim());
    fs.appendFileSync(LOG_FILE, entry);
}

function gitPush() {
    log("Starting scheduled Git Push...");
    try {
        const filesToAdd = ['skool_qualified_from_skoolers.json', 'investigated_members.json', 'skool_internal.log'];
        const existingFiles = filesToAdd.filter(f => fs.existsSync(path.join(__dirname, f)));
        if (existingFiles.length > 0) {
            const options = { cwd: __dirname, timeout: 60000 };
            execSync(`git add ${existingFiles.join(' ')}`, options);
            execSync('git commit -m "Auto-Save: Factory Progress Update"', options);
            execSync('git push origin main', options);
            log("SUCCESS: Progress pushed to Git.");
        }
    } catch (e) {
        log(`WARNING: Git check-in failed: ${e.message}`);
    }
}

async function runScript(scriptPath) {
    return new Promise((resolve) => {
        log(`Launching ${path.basename(scriptPath)}...`);
        const child = spawn('node', [scriptPath], { stdio: 'inherit' });
        child.on('close', (code) => {
            log(`${path.basename(scriptPath)} finished with code ${code}`);
            resolve(code);
        });
    });
}

function getLeadCount() {
    try {
        if (fs.existsSync(LEADS_FILE)) {
            const data = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
            return Array.isArray(data) ? data.length : 0;
        }
    } catch (e) {
        log(`Error reading leads: ${e.message}`);
    }
    return 0;
}

async function factoryLoop() {
    log("!!! THRESHOLD-BASED LEAD FACTORY STARTED !!!");
    
    while (true) {
        log("Checking current lead count...");
        const count = getLeadCount();
        log(`Leads in database: ${count}/100`);

        if (count < 100) {
            log("PHASE 1: DISCOVERY (Discovery Engine actively sifting until 100 leads)");
            await runScript(CRAWLER_SCRIPT);
            gitPush();
        } else {
            log("PHASE 2: OUTREACH (Threshold reached! Launching IG DMs)");
            await runScript(OUTREACH_SCRIPT);
            gitPush();
            
            log(`PHASE 3: REST (Cycle complete. Resting for 1 hour as requested)`);
            await new Promise(r => setTimeout(r, REST_PERIOD_MS));
        }

        log("Cycle check complete. Waiting for next window...");
        await new Promise(r => setTimeout(r, POLLING_INTERVAL_MS));
    }
}

factoryLoop().catch(err => {
    log(`FATAL MANAGER ERROR: ${err.message}`);
    process.exit(1);
});
