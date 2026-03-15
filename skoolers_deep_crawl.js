import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, 'skool_session');
const STORAGE_STATE_FILE = path.join(__dirname, 'skool_storage_state.json');
const QUALIFIED_LEADS_FILE = path.join(__dirname, 'skool_qualified_from_skoolers.json');
const INVESTIGATED_MEMBERS_FILE = path.join(__dirname, 'investigated_members.json');

const REQUIREMENTS = {
    PAID: { MIN_MRR: 3000, MIN_MEMBERS: 75 },
    FREE: { MIN_MEMBERS: 2000 },
    FOLLOWERS_FALLBACK: 2000
};

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

async function deepCrawlSkoolers() {
    log("Starting STRICT deep crawl of 'Skoolers' community members...");
    
    let qualifiedLeads = [];
    if (fs.existsSync(QUALIFIED_LEADS_FILE)) {
        qualifiedLeads = JSON.parse(fs.readFileSync(QUALIFIED_LEADS_FILE, 'utf8'));
    }

    let investigatedMembers = new Set();
    if (fs.existsSync(INVESTIGATED_MEMBERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(INVESTIGATED_MEMBERS_FILE, 'utf8'));
        investigatedMembers = new Set(data);
        log(`Loaded ${investigatedMembers.size} previously investigated members to skip.`);
    }

    // Check for GitHub Actions environment to force headless mode
    const isHeadless = process.env.GITHUB_ACTIONS === 'true' || process.env.HEADLESS === 'true';
    if (isHeadless) log("Environment: GitHub Actions detected. Running in HEADLESS mode.");
    else log("Environment: Local detected. Running in HEADFUL mode.");

    let context;
    if (fs.existsSync(STORAGE_STATE_FILE)) {
        log("Using COMPACT Storage State for authentication...");
        const browser = await chromium.launch({ headless: isHeadless });
        context = await browser.newContext({
            storageState: STORAGE_STATE_FILE,
            viewport: { width: 1280, height: 720 }
        });
    } else {
        log("Using PERSISTENT profile for authentication...");
        context = await chromium.launchPersistentContext(SESSION_DIR, {
            headless: isHeadless,
            viewport: { width: 1280, height: 720 }
        });
    }
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    try {
        log("Navigating to Skoolers community...");
        await page.goto('https://www.skool.com/skoolers', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        // Click the Members tab to ensure we are on the grid, not the feed
        log("Switching to Members tab...");
        try {
            await page.click('text=Members', { timeout: 10000 });
            await page.waitForTimeout(5000);
        } catch (e) {
            log("Warning: Could not find 'Members' tab text, attempting direct URL...");
            await page.goto('https://www.skool.com/skoolers/members', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
        }

        log("Scrolling to gather members (70 pages for depth)...");
        for (let i = 0; i < 70; i++) {
            await page.evaluate(() => window.scrollBy(0, 4000));
            await page.waitForTimeout(1500);
            if (i % 10 === 0) log(`Scroll progress: ${i}/70`);
        }

        const memberLinks = await page.evaluate(() => {
            // Target the specific member cards in the grid
            return Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => {
                    const isProfile = href.includes('skool.com/@');
                    const isRealProfile = isProfile && !href.includes('/members') && !href.includes('/about') && !href.includes('/settings');
                    return isRealProfile;
                });
        });
        
        const uniqueMembers = [...new Set(memberLinks)];
        log(`Found ${uniqueMembers.length} total links on page.`);

        const toInvestigate = uniqueMembers.filter(url => !investigatedMembers.has(url));
        log(`Filtering... ${toInvestigate.length} members are NEW and will be investigated.`);

        for (const memberUrl of toInvestigate) {
            log(`\nInvestigating member: ${memberUrl}`);
            try {
                const memberPage = await context.newPage();
                await memberPage.goto(memberUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // Human-like wait after loading profile
                await memberPage.waitForTimeout(5000);

                // Scroll deeper to ensure all sections load (cards, icons)
                log(`Thoroughly scrolling profile for ${memberUrl}...`);
                await memberPage.evaluate(() => {
                    const profileContainer = document.querySelector('.profile-container') || window;
                    profileContainer.scrollBy(0, 1500); 
                });
                // Wait for any lazy-loaded IG icons to appear
                await memberPage.waitForTimeout(3000);

                const profileInfo = await memberPage.evaluate(() => {
                    // Try to find IG Link (the icon)
                    const igLink = document.querySelector('a[href*="instagram.com"]');
                    const nameEl = document.querySelector('h1, h2, .display-name');
                    
                    // Extract Bio Text for fallback parsing
                    const bioEl = document.querySelector('.description, .bio, [class*="bio"]');
                    const bioText = bioEl ? bioEl.innerText : document.body.innerText;

                    // Extract Skool followers count
                    const allDivs = Array.from(document.querySelectorAll('div, span'));
                    const followerLabel = allDivs.find(el => el.innerText.trim() === 'Followers');
                    let skoolFollowers = 0;
                    if (followerLabel && followerLabel.previousElementSibling) {
                        const val = followerLabel.previousElementSibling.innerText.trim().toLowerCase();
                        skoolFollowers = parseFloat(val.replace(/,/g, '').replace('k', ''));
                        if (val.includes('k')) skoolFollowers *= 1000;
                    }

                    // Parse Group Cards (Owned Communities)
                    const cards = [];
                    const allLinks = Array.from(document.querySelectorAll('a'));
                    allLinks.forEach(a => {
                        const text = a.innerText;
                        const url = a.href;
                        const statsMatch = text.match(/([\d,.]+)\s*k?\s*members\s*[•|·]\s*(\$\d+|Free)/i);
                        if (statsMatch && url.includes('skool.com/')) {
                            const path = new URL(url).pathname.split('/').filter(p => p)[0];
                            if (path && !path.startsWith('@') && !['discovery', 'settings', 'about'].includes(path)) {
                                cards.push({
                                    url,
                                    name: text.split('\n')[0],
                                    memberStr: statsMatch[1],
                                    priceStr: statsMatch[2]
                                });
                            }
                        }
                    });

                    return {
                        name: nameEl ? nameEl.innerText.replace('Owned by ', '').trim() : "Unknown",
                        ig: igLink ? igLink.href : null,
                        hasIcon: !!igLink,
                        bio: bioText,
                        followers: skoolFollowers,
                        cards
                    };
                });

                if (profileInfo.ig) {
                    log(`>>> EXTRACTED IG FROM ICON: ${profileInfo.ig}`);
                } else {
                    const igMatch = profileInfo.bio.match(/(?:@|instagram\.com\/)([a-zA-Z0-9._]+)/);
                    if (igMatch && !['explore', 'reels', 'p'].includes(igMatch[1].toLowerCase())) {
                        profileInfo.ig = `https://www.instagram.com/${igMatch[1]}/`;
                        log(`>>> EXTRACTED IG FROM BIO: ${profileInfo.ig}`);
                    }
                }

                log(`Inspecting ${profileInfo.name} | Followers: ${profileInfo.followers} | Cards: ${profileInfo.cards.length}`);

                let memberQualified = false;

                if (profileInfo.followers >= REQUIREMENTS.FOLLOWERS_FALLBACK && profileInfo.ig) {
                    log(`>>> QUALIFIED VIA FOLLOWERS: ${profileInfo.name} (${profileInfo.followers} followers)`);
                    memberQualified = true;
                }

                if (!memberQualified) {
                    for (const card of profileInfo.cards) {
                        let members = parseFloat(card.memberStr.replace(/,/g, ''));
                        if (card.memberStr.toLowerCase().includes('k')) members *= 1000;

                        const isFree = card.priceStr.toLowerCase().includes('free');
                        let price = 0;
                        if (!isFree) {
                            const pMatch = card.priceStr.match(/\$(\d+)/);
                            if (pMatch) price = parseInt(pMatch[1]);
                        }

                        if (isFree || price === 0) {
                            if (members >= REQUIREMENTS.FREE.MIN_MEMBERS) memberQualified = true;
                        } else {
                            if ((price * members) >= REQUIREMENTS.PAID.MIN_MRR && members >= REQUIREMENTS.PAID.MIN_MEMBERS) memberQualified = true;
                        }

                        if (memberQualified) {
                            log(`>>> QUALIFIED VIA CARD: ${card.url} | Members: ${members} | Price: ${card.priceStr}`);
                            break;
                        }
                    }
                }

                if (memberQualified && profileInfo.ig) {
                    const lead = {
                        skoolProfile: memberUrl,
                        name: profileInfo.name,
                        ig: profileInfo.ig,
                        foundAt: new Date().toISOString()
                    };

                    if (!qualifiedLeads.some(l => l.skoolProfile === memberUrl)) {
                        qualifiedLeads.push(lead);
                        fs.writeFileSync(QUALIFIED_LEADS_FILE, JSON.stringify(qualifiedLeads, null, 4));
                        log(`Total Qualified Leads Found: ${qualifiedLeads.length}/100`);
                    }

                    if (qualifiedLeads.length >= 100) {
                        log(`\n!!! BATCH COMPLETE !!!`);
                        await memberPage.close();
                        break; 
                    }
                }

                await memberPage.close();
                
                // Track as investigated regardless of result
                investigatedMembers.add(memberUrl);
                fs.writeFileSync(INVESTIGATED_MEMBERS_FILE, JSON.stringify([...investigatedMembers], null, 4));

            } catch (err) {
                log(`Error checking member ${memberUrl}: ${err.message}`);
                // Also track failed ones so we don't loop forever on a broken profile
                investigatedMembers.add(memberUrl);
                fs.writeFileSync(INVESTIGATED_MEMBERS_FILE, JSON.stringify([...investigatedMembers], null, 4));
            }
            if (qualifiedLeads.length >= 100) break;
            // Human-like safety delay (4-8 seconds)
            await page.waitForTimeout(4000 + Math.random() * 4000);
        }

    } catch (e) {
        log(`Fatal error: ${e.message}`);
    } finally {
        await context.close();
    }
}

deepCrawlSkoolers().catch(console.error);
