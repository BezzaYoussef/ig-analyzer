"use client"

import { useState, useEffect, useRef } from "react"
import { CSVUploader } from "@/components/csv-uploader"
import { ResultsTable, AnalysisResult } from "@/components/results-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Papa from "papaparse"
import { Download, PlayCircle, PauseCircle } from "lucide-react"

export default function Home() {
    const [data, setData] = useState<AnalysisResult[]>([])
    const [isProcessing, setIsProcessing] = useState(false)
    const [progress, setProgress] = useState({ current: 0, total: 0 })

    const [isPaused, setIsPaused] = useState(false)
    const [shouldStop, setShouldStop] = useState(false)
    // Refs so the async loop always reads the live value (avoids stale closure)
    const isPausedRef = useRef(false)
    const shouldStopRef = useRef(false)

    // Gemini Daily Usage
    const [geminiUsage, setGeminiUsage] = useState(0)
    const DAILY_LIMIT = 1500

    useEffect(() => {
        const storedDate = localStorage.getItem('gemini_usage_date')
        const storedCount = localStorage.getItem('gemini_usage_count')
        const today = new Date().toDateString()

        if (storedDate !== today) {
            localStorage.setItem('gemini_usage_date', today)
            localStorage.setItem('gemini_usage_count', '0')
            setGeminiUsage(0)
        } else if (storedCount) {
            setGeminiUsage(parseInt(storedCount, 10))
        }
    }, [])

    const updateGeminiUsage = () => {
        const newCount = geminiUsage + 1
        setGeminiUsage(newCount)
        localStorage.setItem('gemini_usage_count', newCount.toString())
    }

    const handleDataLoaded = (loadedData: any[]) => {
        if (loadedData.length === 0) return;

        const allKeys = Object.keys(loadedData[0]);
        console.log("CSV Headers found:", allKeys);

        // PRIORITY 1: Scan for column with instagram.com values
        let dataKey: string | undefined = undefined;
        const sampleRows = loadedData.slice(0, Math.min(10, loadedData.length));
        for (const k of allKeys) {
            const hasInstagram = sampleRows.some(row => {
                const val = String(row[k] || '');
                return val.includes('instagram.com');
            });
            if (hasInstagram) {
                dataKey = k;
                console.log("Found Instagram links in column:", k);
                break;
            }
        }

        // PRIORITY 2: Check for @username values
        if (!dataKey) {
            for (const k of allKeys) {
                const hasAt = sampleRows.some(row => {
                    const val = String(row[k] || '').trim();
                    return val.startsWith('@') && val.length > 1;
                });
                if (hasAt) {
                    dataKey = k;
                    console.log("Found @usernames in column:", k);
                    break;
                }
            }
        }

        // PRIORITY 3: Check header names
        if (!dataKey) {
            dataKey = allKeys.find(k =>
                k.toLowerCase().includes('username') ||
                k.toLowerCase().includes('instagram') ||
                k.toLowerCase().includes('profile')
            );
            if (dataKey) console.log("Matched column by header name:", dataKey);
        }

        // PRIORITY 4: Fall back to first column
        if (!dataKey) {
            dataKey = allKeys[0];
            console.log("Falling back to first column:", dataKey);
        }

        console.log("Using column:", dataKey);

        const initialData: AnalysisResult[] = [];
        for (const row of loadedData) {
            const rawValue = String((row as any)[dataKey!] || '').trim();
            if (!rawValue) continue;

            let username = rawValue;
            let profileUrl = rawValue;

            if (rawValue.includes('instagram.com')) {
                try {
                    const cleanUrl = rawValue.split('?')[0].split('#')[0];
                    const urlWithoutSlash = cleanUrl.endsWith('/') ? cleanUrl.slice(0, -1) : cleanUrl;
                    const parts = urlWithoutSlash.split('/');
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && lastPart !== 'instagram.com' && lastPart !== 'www.instagram.com') {
                        username = lastPart;
                    }
                    if (rawValue.startsWith('www.')) {
                        profileUrl = `https://${rawValue}`;
                    } else if (!rawValue.startsWith('http')) {
                        profileUrl = `https://${rawValue}`;
                    } else {
                        profileUrl = rawValue;
                    }
                } catch (e) {
                    console.error("Error parsing URL:", rawValue);
                    continue;
                }
            } else if (rawValue.startsWith('@')) {
                username = rawValue.slice(1);
                profileUrl = `https://www.instagram.com/${username}/`;
            } else {
                profileUrl = `https://www.instagram.com/${rawValue}/`;
            }

            if (username.length > 0) {
                initialData.push({
                    username,
                    profileUrl,
                    category: '',
                    confidence: '',
                    reason: '',
                    status: 'pending' as const
                });
            }
        }

        console.log("Total leads loaded:", initialData.length);
        if (initialData.length === 0) {
            alert("No Instagram links or usernames found in the CSV. Make sure at least one column contains Instagram profile URLs or usernames.");
        }
        setData(initialData);
    }

    const togglePause = () => {
        const next = !isPausedRef.current
        isPausedRef.current = next
        setIsPaused(next)
    }

    const stopAnalysis = () => {
        shouldStopRef.current = true
        setShouldStop(true)
        setIsProcessing(false)
    }

    const startAnalysis = async () => {
        if (data.length === 0) return
        setIsProcessing(true)
        setShouldStop(false)
        setIsPaused(false)
        // Reset refs so a fresh run starts clean
        shouldStopRef.current = false
        isPausedRef.current = false
        setProgress({ current: 0, total: data.length })

        for (let i = 0; i < data.length; i++) {
            // Use refs — they always reflect the latest value inside async loops
            if (shouldStopRef.current) break;

            while (isPausedRef.current) {
                if (shouldStopRef.current) break;
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const item = data[i]
            if (item.status === 'completed') {
                setProgress(prev => ({ ...prev, current: i + 1 }))
                continue
            }

            setData(prev => {
                const newData = [...prev]
                newData[i] = { ...newData[i], status: 'processing' }
                return newData
            })

            try {
                const response = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: item.username }),
                })

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.details || errData.error || 'API request failed')
                }

                const result = await response.json()

                if (result.reason && (result.reason.includes('AI') || result.reason.includes('Gemini'))) {
                    updateGeminiUsage();
                }

                setData(prev => {
                    const newData = [...prev]
                    newData[i] = {
                        ...newData[i],
                        status: 'completed',
                        category: result.category,
                        confidence: result.confidence,
                        reason: result.reason
                    }
                    return newData
                })

            } catch (error) {
                console.error("Error analyzing", item.username, error)
                setData(prev => {
                    const newData = [...prev]
                    newData[i] = { ...newData[i], status: 'error', reason: String(error) }
                    return newData
                })
            }

            setProgress(prev => ({ ...prev, current: i + 1 }))
            await new Promise(resolve => setTimeout(resolve, 5000))
        }
        setIsProcessing(false)
    }

    const exportCSV = () => {
        const csv = Papa.unparse(data.map(({ status, ...rest }) => rest))
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'leads_profiled.csv')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    return (
        <main className="flex min-h-screen flex-col items-center p-8 bg-zinc-50 dark:bg-zinc-950">
            <div className="z-10 w-full max-w-5xl items-center justify-between text-sm lg:flex mb-8">
                <h1 className="text-4xl font-bold tracking-tight">Leads Profiler</h1>
            </div>

            <div className="grid gap-6 w-full max-w-5xl">
                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Upload Leads</CardTitle>
                            <CardDescription>Drag and drop a CSV file with a "username" or "link" column.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <CSVUploader onDataLoaded={handleDataLoaded} />
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Actions</CardTitle>
                            <CardDescription>Control the analysis process.</CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4 justify-center">

                            {/* Gemini Usage Bar */}
                            <div className="flex flex-col gap-2 p-3 bg-zinc-100 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
                                <div className="flex justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                    <span>AI Usage Credit (Daily)</span>
                                    <span>{geminiUsage} / {DAILY_LIMIT}</span>
                                </div>
                                <div className="h-2 w-full bg-zinc-300 dark:bg-zinc-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all duration-500 ease-in-out ${geminiUsage > DAILY_LIMIT * 0.9 ? 'bg-red-500' : 'bg-green-500'}`}
                                        style={{ width: `${Math.min((geminiUsage / DAILY_LIMIT) * 100, 100)}%` }}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between text-sm mb-1">
                                    <span>Total Leads: {data.length}</span>
                                    <span>Processed: {progress.current} / {progress.total}</span>
                                </div>
                                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all duration-500 ease-in-out"
                                        style={{ width: `${data.length > 0 ? (progress.current / data.length) * 100 : 0}%` }}
                                    />
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <Button
                                    onClick={isProcessing ? togglePause : startAnalysis}
                                    disabled={data.length === 0}
                                    className="w-full"
                                >
                                    {isProcessing && !isPaused ? (
                                        <><PauseCircle className="mr-2 h-4 w-4" /> Pause Analysis</>
                                    ) : isProcessing && isPaused ? (
                                        <><PlayCircle className="mr-2 h-4 w-4" /> Resume Analysis</>
                                    ) : (
                                        <><PlayCircle className="mr-2 h-4 w-4" /> Start Analysis</>
                                    )}
                                </Button>
                                {isProcessing && (
                                    <Button
                                        variant="destructive"
                                        onClick={stopAnalysis}
                                        className="w-full"
                                    >
                                        Stop
                                    </Button>
                                )}
                                <Button
                                    variant="outline"
                                    onClick={exportCSV}
                                    disabled={data.length === 0}
                                    className="w-full"
                                >
                                    <Download className="mr-2 h-4 w-4" /> Export CSV
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <ResultsTable data={data} />
            </div>
        </main>
    )
}
