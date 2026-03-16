import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, saveJson, loadJson, paths } from './skool_utils.js';
import { extractProfileInfo, isQualified, extractMemberCount } from './skool_scraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIREMENTS = {
    PAID: { MIN_MRR: 3000, MIN_MEMBERS: 75 },
    FREE: { MIN_MEMBERS: 2000 },
    FOLLOWERS_FALLBACK: 2000
};

async function deepCrawlSkoolers() {
    log("Starting MODULAR deep crawl of 'Skoolers' community members...");
    
    let qualifiedLeads = loadJson(paths.QUALIFIED_LEADS_FILE);
    let investigatedMembers = new Set(loadJson(paths.INVESTIGATED_MEMBERS_FILE));
    log(`Loaded ${investigatedMembers.size} investigated members and ${qualifiedLeads.size || qualifiedLeads.length} leads.`);

    const isHeadless = process.env.GITHUB_ACTIONS === 'true' || process.env.HEADLESS === 'true';
    const launchOptions = {
        headless: isHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };

    let context;
    if (fs.existsSync(paths.STORAGE_STATE_FILE)) {
        log("Using COMPACT Storage State for authentication...");
        const browser = await chromium.launch(launchOptions);
        context = await browser.newContext({ storageState: paths.STORAGE_STATE_FILE, viewport: { width: 1280, height: 720 } });
    } else {
        log("Using PERSISTENT profile for authentication...");
        context = await chromium.launchPersistentContext(paths.SESSION_DIR, { ...launchOptions, viewport: { width: 1280, height: 720 } });
    }
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    try {
        log("Navigating to Skoolers Members grid (Hyphenated URL)...");
        await page.goto('https://www.skool.com/skoolers/-/members', { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(7000); 

        // Check if we actually landed on the grid. If not, try the click fallback.
        const gridPresent = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/@"]'));
            return links.length >= 6;
        });

        if (!gridPresent) {
            log("WARNING: Direct URL failed to load grid. Attempting Click-Fallback...");
            await page.goto('https://www.skool.com/skoolers', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('a, button, div'));
                const membersTab = tabs.find(t => t.innerText.trim() === 'Members');
                if (membersTab) membersTab.click();
            });
            await page.waitForTimeout(7000);
        }
        
        // Final verification of grid
        try {
            await page.waitForFunction(() => {
                const links = Array.from(document.querySelectorAll('a[href*="/@"]'));
                return links.length >= 6;
            }, { timeout: 15000 });
            
            log("SUCCESS: Member grid detected and verified via link density.");
            const snapshotPath = path.join(__dirname, 'member_grid_verified.png');
            await page.screenshot({ path: snapshotPath });
        } catch (e) {
            log("CRITICAL: Failed to load Members grid after all attempts.");
            await page.screenshot({ path: path.join(__dirname, 'navigation_fatal_error.png') });
            throw new Error("Failed to land on Members grid");
        }

        log("Starting Reload & Harvest cycle (Bypassing 30-member limit)...");
        let totalCheckedThisSession = 0;
        const TARGET_SESSION_CHECK = 300; 

        while (totalCheckedThisSession < TARGET_SESSION_CHECK && qualifiedLeads.length < 100) {
            // Harvest current 30 members
            const memberLinks = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('a'))
                    .map(a => a.href)
                    .filter(href => href.includes('skool.com/@') && !href.match(/\/(members|about|settings)/));
            });
            
            // Deduplicate immediately
            const uniqueLinks = [...new Set(memberLinks)];
            const toInvestigate = uniqueLinks.filter(url => !investigatedMembers.has(url));
            log(`Found ${uniqueLinks.length} unique results on page. ${toInvestigate.length} are NEW.`);

            if (toInvestigate.length === 0) {
                log("No new members in this view. Refreshing for randomization...");
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(7000);
                continue;
            }

            for (const memberUrl of toInvestigate) {
                log(`\nInvestigating: ${memberUrl}`);
                const memberPage = await context.newPage();
                try {
                    await memberPage.goto(memberUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await memberPage.waitForTimeout(4000);

                    const profileInfo = await extractProfileInfo(memberPage);
                    log(`Inspecting ${profileInfo.name} | Followers: ${profileInfo.followers} | Cards: ${profileInfo.cards.length}`);

                    if (isQualified(profileInfo, REQUIREMENTS)) {
                        log(`>>> QUALIFIED: ${profileInfo.name}`);
                        const lead = { skoolProfile: memberUrl, name: profileInfo.name, ig: profileInfo.ig, foundAt: new Date().toISOString() };
                        if (!qualifiedLeads.some(l => l.skoolProfile === memberUrl)) {
                            qualifiedLeads.push(lead);
                            saveJson(paths.QUALIFIED_LEADS_FILE, qualifiedLeads);
                            log(`Total Leads: ${qualifiedLeads.length}`);
                        }
                    }
                } catch (err) {
                    log(`Skipping ${memberUrl}: ${err.message}`);
                } finally {
                    await memberPage.close();
                    investigatedMembers.add(memberUrl);
                    saveJson(paths.INVESTIGATED_MEMBERS_FILE, [...investigatedMembers]);
                    totalCheckedThisSession++;
                }
                
                if (qualifiedLeads.length >= 100) break;
                await page.waitForTimeout(1000 + Math.random() * 2000);
            }

            if (qualifiedLeads.length < 100) {
                log("Batch complete. Reloading page to randomize members...");
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(7000);
            }
        }

    } catch (e) {
        log(`Fatal error: ${e.message}`);
        process.exit(1); 
    } finally {
        await context.close();
    }
}

deepCrawlSkoolers().catch(console.error);
