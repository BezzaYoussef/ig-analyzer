export const maxDuration = 60;
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { detectGenderFromName } from '@/lib/gender-names';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Rate limiter for Gemini API calls
let lastGeminiCallTime = 0;
const GEMINI_MIN_INTERVAL = 5000; // 5 seconds between calls

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForGeminiRateLimit() {
    const now = Date.now();
    const elapsed = now - lastGeminiCallTime;
    if (elapsed < GEMINI_MIN_INTERVAL) {
        const wait = GEMINI_MIN_INTERVAL - elapsed;
        console.log(`  [RateLimit] waiting ${wait}ms...`);
        await sleep(wait);
    }
    lastGeminiCallTime = Date.now();
}

// Use Gemini as a TEXT classifier: username + display name + bio
async function classifyWithGeminiText(
    username: string,
    displayName: string,
    bio: string
): Promise<{ gender: string; confidence: string; reason: string } | null> {
    if (!GEMINI_API_KEY) {
        console.log(`  ⚠ No GEMINI_API_KEY`);
        return null;
    }

    const prompt = `You are a gender classification assistant for Instagram profiles.

Profile info:
- Username: ${username}
- Display Name: ${displayName || '(not available)'}
- Bio: ${bio || '(not available)'}

Based on the name and username, determine the most likely gender.
Consider international names (German, Spanish, French, Italian, Arabic, etc).

Respond with EXACTLY one word:
- "male" → clearly male name/person
- "female" → clearly female name/person
- "business" → company, brand, or organization
- "unknown" → truly cannot determine (use as last resort)

One word only. No explanation.`;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await waitForGeminiRateLimit();
            const modelName = attempt === 0 ? 'gemini-2.0-flash' : 'gemini-1.5-flash';
            console.log(`  🤖 Gemini text attempt ${attempt + 1} (${modelName})`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const response = result.response.text().trim().toLowerCase();
            console.log(`  ✅ Gemini text: "${response}"`);

            if (response === 'male') return { gender: 'male', confidence: 'Medium', reason: `AI text analysis: ${username} → male` };
            if (response === 'female') return { gender: 'female', confidence: 'Medium', reason: `AI text analysis: ${username} → female` };
            if (response === 'business') return { gender: 'business', confidence: 'Medium', reason: `AI text analysis: ${username} → business/brand` };
            return null;
        } catch (error: any) {
            const msg = error?.message || String(error);
            console.log(`  ❌ Gemini error: ${msg.slice(0, 100)}`);
            if (msg.includes('429') || msg.includes('quota')) {
                await sleep(8000);
                continue;
            }
            return null;
        }
    }
    return null;
}


// Use Gemini Vision to analyze a profile picture PNG buffer
// Buffer comes from a Playwright element screenshot - no CDN auth issues
async function classifyWithGeminiImage(
    imageBuffer: Buffer | null
): Promise<{ gender: string; reason: string } | null> {
    if (!GEMINI_API_KEY || !imageBuffer || imageBuffer.length < 500) return null;

    try {
        await waitForGeminiRateLimit();
        console.log(`  📸 Sending ${Math.round(imageBuffer.length / 1024)}KB screenshot to Gemini vision...`);

        const b64 = imageBuffer.toString('base64');
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent([
            { inlineData: { data: b64, mimeType: 'image/png' } },
            { text: `Look at this Instagram profile picture and determine the likely gender of the person shown.\nRules:\n- If a person is clearly visible: respond with "male" or "female"\n- If it's a logo, object, group, animal, or unclear: respond with "unknown"\nOne word only: "male", "female", or "unknown"` }
        ]);

        const response = result.response.text().trim().toLowerCase();
        console.log(`  ✅ Gemini image: "${response}"`);

        if (response === 'male') return { gender: 'male', reason: 'AI profile image → male' };
        if (response === 'female') return { gender: 'female', reason: 'AI profile image → female' };
        return null;
    } catch (error: any) {
        console.log(`  ❌ Gemini image error: ${String(error).slice(0, 100)}`);
        return null;
    }
}

// Extract display name from Instagram page title (format: "Name (@username) • Instagram")
function extractDisplayName(title: string): string {
    const match = title.match(/^(.+?)\s*\(@/);
    return match?.[1]?.trim() || '';
}

// Get candidate names from username using separator splits ONLY (no prefix scanning)
// e.g. erika.schweitzer → ["erika", "schweitzer"]  erikitasnydes → [] (no separators)
function getCandidateNamesFromUsername(username: string): string[] {
    const lower = username.toLowerCase();
    // Only split on explicit separators (dots, underscores, hyphens, digits)
    // Do NOT do prefix scanning — it causes false positives (e.g. "erik" in "erikitasnydes")
    const parts = lower.split(/[._\-0-9]+/).filter(p => p.length >= 2);
    // If the whole username is one solid block (no separators), return empty
    // and let Gemini handle it
    if (parts.length === 1 && parts[0] === lower) return [];
    return parts;
}

export async function POST(req: Request) {
    try {
        const { username } = await req.json();
        if (!username) {
            return NextResponse.json({ error: 'Username is required' }, { status: 400 });
        }

        console.log(`\n══════ ${username} ══════`);

        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox']
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        // Allow Instagram CDN images (for profile pictures) but block everything else
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            const url = route.request().url();
            // Let Instagram profile pictures through
            if (type === 'image' && url.includes('cdninstagram.com')) {
                route.continue();
            } else if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        try {
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const bio = await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => '');
            const title = await page.title();

            // Screenshot the profile picture element — this is more reliable than fetching
            // the og:image URL, which Instagram CDN blocks from server-side requests
            let profileImageBuffer: Buffer | null = null;
            try {
                const avatarEl = page.locator('img[alt*="profile picture"]').first();
                await avatarEl.waitFor({ state: 'visible', timeout: 5000 });
                profileImageBuffer = await avatarEl.screenshot();
                console.log(`  📸 Profile picture screenshot: ${Math.round(profileImageBuffer.length / 1024)}KB`);
            } catch {
                console.log(`  ⚠ No profile picture element found (likely login wall)`);
            }

            console.log(`  Title: ${title?.slice(0, 80)}`);
            console.log(`  Bio: ${bio?.slice(0, 80) || '(none)'}`);
            console.log(`  ProfilePic: ${profileImageBuffer ? 'YES' : 'NO'}`);

            if (title.includes('Page Not Found')) {
                await browser.close();
                return NextResponse.json({ username, category: 'N/A', confidence: 'High', reason: 'Profile not found' });
            }

            const displayName = extractDisplayName(title);
            console.log(`  Name: "${displayName}"`);

            let category = 'N/A';
            let confidence = 'Low';
            let reason = 'Insufficient data';
            const bioLower = bio?.toLowerCase() || '';

            // ── STEP 1: Business keywords ──
            const bizWords = ['agency', 'business', 'official', 'company', 'service', 'shop', 'store', 'founder', 'ceo', 'brand', 'marketing', 'enterprise', 'llc', 'inc', 'ltd'];
            const matchedBiz = bizWords.find(k => bioLower.includes(k));

            // ── STEP 2: Gender bio keywords ──
            const maleKw = ['he/him', 'dad', 'father', 'husband', 'boy', 'guy', 'man', 'king', 'brother', 'mr.', 'mr '];
            const femaleKw = ['she/her', 'mom', 'mother', 'wife', 'girl', 'woman', 'lady', 'queen', 'sister', 'mrs.', 'mrs ', 'ms.', 'ms ', 'miss'];
            const isMaleBio = maleKw.some(k => bioLower.includes(k));
            const isFemaleBio = femaleKw.some(k => bioLower.includes(k));

            if (matchedBiz) {
                category = 'Business Page'; confidence = 'Medium';
                reason = `Business keyword: "${matchedBiz}"`;
                console.log(`  → Business (${matchedBiz})`);
            } else if (isMaleBio && !isFemaleBio) {
                category = 'Male'; confidence = 'Medium';
                reason = 'Bio keywords indicate male';
                console.log(`  → Male (bio)`);
            } else if (isFemaleBio && !isMaleBio) {
                category = 'Female'; confidence = 'Medium';
                reason = 'Bio keywords indicate female';
                console.log(`  → Female (bio)`);
            }

            // ── STEP 3: Local name database — try display name first, then username candidates ──
            if (category === 'N/A') {
                const namesToTry = [
                    displayName,
                    ...getCandidateNamesFromUsername(username)
                ].filter(Boolean);

                for (const nameCandidate of namesToTry) {
                    const nameResult = detectGenderFromName(nameCandidate!);
                    if (nameResult) {
                        category = nameResult.gender === 'male' ? 'Male' : 'Female';
                        confidence = nameResult.probability > 0.9 ? 'High' : 'Medium';
                        reason = `Name "${nameCandidate}" → ${nameResult.gender} (local DB, ${Math.round(nameResult.probability * 100)}%)`;
                        console.log(`  → ${category} (name match: "${nameCandidate}")`);
                        break;
                    }
                }
            }

            // ── STEP 4: Gemini IMAGE (screenshot of profile picture, highest priority) ──
            if (category === 'N/A') {
                console.log(`  📸 Running Gemini image analysis (priority 1)...`);
                const imageResult = await classifyWithGeminiImage(profileImageBuffer);
                if (imageResult) {
                    category = imageResult.gender === 'male' ? 'Male' : 'Female';
                    confidence = 'Medium';
                    reason = imageResult.reason;
                    console.log(`  → ${category} (image)`);
                }
            }

            // ── STEP 5: Gemini TEXT fallback (when image fails or is unavailable) ──
            if (category === 'N/A') {
                console.log(`  🤖 Running Gemini text classification (fallback)...`);
                const textResult = await classifyWithGeminiText(username, displayName, bio || '');
                if (textResult) {
                    if (textResult.gender === 'male') {
                        category = 'Male'; confidence = 'Medium'; reason = textResult.reason;
                    } else if (textResult.gender === 'female') {
                        category = 'Female'; confidence = 'Medium'; reason = textResult.reason;
                    } else if (textResult.gender === 'business') {
                        category = 'Business Page'; confidence = 'Medium'; reason = textResult.reason;
                    }
                    console.log(`  → ${category} (text)`);
                }
            }

            if (category === 'N/A' && reason === 'Insufficient data') {
                reason = 'Could not determine gender from name, bio, or profile image';
            }

            console.log(`  ══ RESULT: ${category} (${confidence}) ══`);
            await browser.close();

            return NextResponse.json({ username, category, confidence, reason, bio: bio ? bio.slice(0, 100) + '...' : '' });

        } catch (error) {
            await browser.close();
            console.error(`  Error:`, error);
            return NextResponse.json({ error: 'Failed to scrape profile', details: String(error) }, { status: 500 });
        }
    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: String(error) }, { status: 500 });
    }
}
