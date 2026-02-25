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

// Use Gemini Vision to analyze profile picture
async function detectGenderByImage(imageUrl: string, username: string): Promise<{ gender: string; confidence: string; reason: string } | null> {
    if (!GEMINI_API_KEY) {
        console.log(`  ⚠ No GEMINI_API_KEY`);
        return null;
    }

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await waitForGeminiRateLimit();

            const modelName = models[Math.min(attempt, models.length - 1)];
            console.log(`  🤖 Gemini attempt ${attempt + 1}/3 (${modelName})`);

            // Fetch image
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 10000);
            const imgRes = await fetch(imageUrl, { signal: controller.signal });
            clearTimeout(tid);

            if (!imgRes.ok) {
                console.log(`  ⚠ Image fetch failed: ${imgRes.status}`);
                return null;
            }

            const buf = await imgRes.arrayBuffer();
            const b64 = Buffer.from(buf).toString('base64');
            const mime = imgRes.headers.get('content-type') || 'image/jpeg';
            console.log(`  📷 Image: ${Math.round(buf.byteLength / 1024)}KB`);

            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent([
                { inlineData: { data: b64, mimeType: mime } },
                { text: `Look at this Instagram profile picture. Based on visual appearance, determine the likely gender of the person in the photo.\n\nRules:\n- If you can see a person, respond with EXACTLY one of: "male", "female"\n- If the image is a logo, graphic, group photo, animal, object, or you cannot determine gender, respond with "unknown"\n- Respond with ONLY the single word: "male", "female", or "unknown"\n- Do not add any explanation or other text` }
            ]);

            const response = result.response.text().trim().toLowerCase();
            console.log(`  ✅ Gemini: "${response}"`);

            if (response === 'male' || response === 'female') {
                return { gender: response, confidence: 'Medium', reason: `AI profile image analysis → ${response}` };
            }
            return { gender: 'unknown', confidence: 'Low', reason: 'AI could not determine gender from profile image' };

        } catch (error: any) {
            const msg = error?.message || String(error);
            console.log(`  ❌ Gemini error: ${msg.slice(0, 100)}`);

            if (msg.includes('429') || msg.includes('quota') || msg.includes('Resource')) {
                const wait = (attempt + 1) * 8000;
                console.log(`  ⏳ Rate limited, waiting ${wait / 1000}s...`);
                await sleep(wait);
                continue;
            }
            return null;
        }
    }
    return null;
}

// Extract display name from Instagram page title (format: "Name (@username) • Instagram")
function extractDisplayName(title: string): string {
    const match = title.match(/^(.+?)\s*\(@/);
    return match?.[1]?.trim() || '';
}

// Fallback: try to guess first name from the username itself
// e.g. "erika.schweitzer" → "erika", "john_doe_1990" → "john"
function extractFirstNameFromUsername(username: string): string {
    const parts = username.toLowerCase().split(/[._\-0-9]+/).filter(p => p.length >= 2);
    return parts[0] || '';
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

        // Block images, fonts, and stylesheets — we only need og: meta tags
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'stylesheet', 'media'].includes(type)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        try {
            await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });

            const bio = await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => '');
            const image = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => '');
            const title = await page.title();

            console.log(`  Title: ${title?.slice(0, 80)}`);
            console.log(`  Bio: ${bio?.slice(0, 80) || '(none)'}`);
            console.log(`  Image: ${image ? 'YES' : 'NO'}`);

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

            // ── STEP 3: Local name database — try display name first, then username ──
            if (category === 'N/A') {
                // Try display name from page title
                const namesToTry = [displayName, extractFirstNameFromUsername(username)].filter(Boolean);
                for (const nameCandidate of namesToTry) {
                    console.log(`  🔍 Checking local name DB for "${nameCandidate}"...`);
                    const nameResult = detectGenderFromName(nameCandidate!);
                    if (nameResult) {
                        category = nameResult.gender === 'male' ? 'Male' : 'Female';
                        confidence = nameResult.probability > 0.9 ? 'High' : 'Medium';
                        reason = `Name "${nameCandidate}" → ${nameResult.gender} (local DB, ${Math.round(nameResult.probability * 100)}%)`;
                        console.log(`  → ${category} (name: "${nameCandidate}")`);
                        break;
                    } else {
                        console.log(`  ✗ Name "${nameCandidate}" not in database`);
                    }
                }
            }

            // ── STEP 4: Gemini AI image analysis (only if still N/A) ──
            if (category === 'N/A' && image && image.length > 10) {
                console.log(`  📸 Trying AI vision analysis...`);
                const visionResult = await detectGenderByImage(image, username);
                if (visionResult && (visionResult.gender === 'male' || visionResult.gender === 'female')) {
                    category = visionResult.gender === 'male' ? 'Male' : 'Female';
                    confidence = visionResult.confidence;
                    reason = visionResult.reason;
                    console.log(`  → ${category} (AI vision)`);
                } else {
                    reason = visionResult?.reason || 'AI analysis failed';
                    console.log(`  ✗ AI vision: ${reason}`);
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
