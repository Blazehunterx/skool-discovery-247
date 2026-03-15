import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'git_automation.log');
const CRAWLER_SCRIPT = 'skoolers_deep_crawl.js';
const LEADS_FILE = 'skool_qualified_from_skoolers.json';
const PUSH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function log(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}\n`;
    console.log(entry.trim());
    fs.appendFileSync(LOG_FILE, entry);
}

function gitPush() {
    log("Starting scheduled Git Push...");
    try {
        execSync('git add ' + LEADS_FILE + ' daily_report.md sent_leads.json', { cwd: __dirname });
        execSync('git commit -m "Auto-Save: Persistent Crawler Progress Update"', { cwd: __dirname });
        execSync('git push origin', { cwd: __dirname });
        log("SUCCESS: Progress pushed to Git origin.");
    } catch (e) {
        log(`WARNING: Git check-in failed (might be no changes): ${e.message}`);
    }
}

async function runCrawler() {
    return new Promise((resolve) => {
        log(`Launching ${CRAWLER_SCRIPT}...`);
        const crawler = spawn('node', [CRAWLER_SCRIPT], {
            cwd: __dirname,
            stdio: 'inherit'
        });

        crawler.on('close', (code) => {
            log(`${CRAWLER_SCRIPT} exited with code ${code}`);
            resolve(code);
        });

        crawler.on('error', (err) => {
            log(`FATAL: Crawler failed to start: ${err.message}`);
            resolve(1);
        });
    });
}

async function start() {
    log("!!! PERSISTENT GIT AUTOMATION STARTED !!!");
    
    // Interval for Git Pushing
    setInterval(gitPush, PUSH_INTERVAL_MS);

    // Continuous Loop for Crawling
    while (true) {
        log("Loop beginning. Checking for work...");
        await runCrawler();
        
        log("Crawler paused or crashed. Waiting 5 minutes for recovery...");
        gitPush(); // Safety push on crash
        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
}

start().catch(e => {
    log(`CRITICAL ERROR in automation manager: ${e.message}`);
    process.exit(1);
});
