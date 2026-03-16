export async function extractProfileInfo(page) {
    return await page.evaluate(() => {
        const igLink = document.querySelector('a[href*="instagram.com"]');
        const bioEl = document.querySelector('.description, .bio, [class*="bio"]');
        const bioText = bioEl ? bioEl.innerText : document.body.innerText;

        // Multi-layer Name Extraction
        let name = "Unknown";
        const h1 = document.querySelector('h1');
        const h2 = document.querySelector('h2');
        const title = document.title;
        const profileName = document.querySelector('[data-testid="profile-name"], .profile-name, [class*="profileName"], [class*="displayName"], .display-name, [class*="styled__Name"]');
        
        // Handle anchor strategy
        const handleEl = Array.from(document.querySelectorAll('div, span, p')).find(el => el.innerText.trim().startsWith('@') && el.innerText.length < 30);
        const nameFromHandle = handleEl?.previousElementSibling?.innerText?.trim();

        if (nameFromHandle) {
            name = nameFromHandle;
        } else if (profileName && profileName.innerText.trim()) {
            name = profileName.innerText.replace('Owned by ', '').trim();
        } else if (h1 && h1.innerText.trim() && !h1.innerText.includes('Skoolers')) {
            name = h1.innerText.replace('Owned by ', '').trim();
        } else if (h2 && h2.innerText.trim()) {
            name = h2.innerText.trim();
        } else if (title && title.includes('| Skool')) {
            name = title.split('|')[0].trim();
        }

        // Followers
        const allDivs = Array.from(document.querySelectorAll('div, span'));
        const followerLabel = allDivs.find(el => el.innerText.trim() === 'Followers');
        let skoolFollowers = 0;
        if (followerLabel && followerLabel.previousElementSibling) {
            const val = followerLabel.previousElementSibling.innerText.trim().toLowerCase();
            skoolFollowers = parseFloat(val.replace(/,/g, '').replace('k', ''));
            if (val.includes('k')) skoolFollowers *= 1000;
        }

        // Group Cards
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

        return { name, ig: igLink ? igLink.href : null, bio: bioText, followers: skoolFollowers, cards };
    });
}

export async function extractMemberCount(page) {
    return await page.evaluate(() => {
        // Method 1: Text-based counter
        const bodyText = document.body.innerText;
        const match = bodyText.match(/Showing\s+(\d+[\d,]*)\s+of/i);
        let textCount = 0;
        if (match) {
            textCount = parseInt(match[1].replace(/,/g, ''));
        }

        // Method 2: Link density count (Unique profile links)
        const uniqueProfiles = new Set();
        document.querySelectorAll('a[href*="/@"]').forEach(a => {
            const h = a.href;
            if (!h.includes('/members') && !h.includes('/about') && !h.includes('/settings')) {
                uniqueProfiles.add(h);
            }
        });
        const linkCount = uniqueProfiles.size;

        // Return the max of both to be robust
        return Math.max(textCount, linkCount);
    });
}

export function isQualified(profile, requirements) {
    if (!profile.ig) return false;

    // Qualification 1: Direct Followers
    if (profile.followers >= requirements.FOLLOWERS_FALLBACK) return true;

    // Qualification 2: Owned Communities
    for (const card of profile.cards) {
        let members = parseFloat(card.memberStr.replace(/,/g, ''));
        if (card.memberStr.toLowerCase().includes('k')) members *= 1000;

        const isFree = card.priceStr.toLowerCase().includes('free');
        let price = 0;
        if (!isFree) {
            const pMatch = card.priceStr.match(/\$(\d+)/);
            if (pMatch) price = parseInt(pMatch[1]);
        }

        if (isFree || price === 0) {
            if (members >= requirements.FREE.MIN_MEMBERS) return true;
        } else {
            if ((price * members) >= requirements.PAID.MIN_MRR && members >= requirements.PAID.MIN_MEMBERS) return true;
        }
    }

    return false;
}
