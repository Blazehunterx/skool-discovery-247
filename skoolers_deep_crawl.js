import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_PATH = path.join(__dirname, 'skool_session');
const QUALIFIED_LEADS_FILE = path.join(__dirname, 'skool_qualified_from_skoolers.json');

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

    const context = await chromium.launchPersistentContext(SESSION_PATH, {
        headless: false,
        viewport: { width: 1280, height: 720 }
    });
    
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    try {
        log("Navigating to Skoolers members list...");
        await page.goto('https://www.skool.com/skoolers/members', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        log("Scrolling to gather members (50 pages)...");
        for (let i = 0; i < 50; i++) {
            await page.evaluate(() => window.scrollBy(0, 3000));
            await page.waitForTimeout(1000);
            if (i % 10 === 0) log(`Scroll progress: ${i}/50`);
        }

        const memberLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .map(a => a.href)
                .filter(href => href.includes('/@') && !href.includes('/members'));
        });
        
        const uniqueMembers = [...new Set(memberLinks)];
        log(`Found ${uniqueMembers.length} members to investigate.`);

        for (const memberUrl of uniqueMembers) {
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
                        bio: bioText,
                        followers: skoolFollowers,
                        cards
                    };
                });

                if (!profileInfo.ig) {
                    const igMatch = profileInfo.bio.match(/(?:@|instagram\.com\/)([a-zA-Z0-9._]+)/);
                    if (igMatch && !['explore', 'reels', 'p'].includes(igMatch[1].toLowerCase())) {
                        profileInfo.ig = `https://www.instagram.com/${igMatch[1]}/`;
                        log(`>>> FOUND IG VIA BIO SCAN: ${profileInfo.ig}`);
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
            } catch (err) {
                log(`Error checking member ${memberUrl}: ${err.message}`);
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
