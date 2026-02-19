# Leads Profiler

An AI-powered Instagram profile analyzer that categorizes leads based on gender and business status using bio keywords, a local name database, and Gemini Vision AI.

## 🚀 Setup on a New PC

Follow these steps to get the project running:

### 1. Prerequisites
- **Node.js**: Install the latest LTS version from [nodejs.org](https://nodejs.org/).
- **Git**: Ensure Git is installed.

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/BezzaYoussef/ig-analyzer.git
cd ig-analyzer
npm install
```

### 3. Environment Setup
Create a `.env.local` file in the root directory and add your Gemini API Key:
```env
GEMINI_API_KEY=your_working_api_key_here
```

### 4. Browser Setup
Install the necessary browsers for the scraper:
```bash
npx playwright install chromium
```

### 5. Start the Application
Run the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🧠 Detection Logic
The app uses a 3-layer system to save on AI costs:
1. **Bio Keywords**: Instant check for pronouns and business terms.
2. **Local Name DB**: Matches ~1600 common names instantly (80% of profiles).
3. **Gemini AI Vision**: Final fallback if the above fails.

## 📊 Limits
- **Gemini Free Tier**: 15 requests per minute, 1500 requests per day.
- **Built-in Rate Limiter**: The app waits 5 seconds between profiles to keep you in the free tier.
