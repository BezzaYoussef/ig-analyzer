"use client"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

// Since I didn't add Badge via CLI, I'll implement a simple one inline or use text colors.
// I'll stick to text colors for simplicity unless I add Badge.
// Prompt said "shadcn/ui components". Badge is common. I might as well add it or just style spans.
// I'll use simple spans with Tailwind classes for badges.

export interface AnalysisResult {
    username: string
    profileUrl: string
    category: string
    confidence: string
    reason: string
    status: 'pending' | 'processing' | 'completed' | 'error'
}

interface ResultsTableProps {
    data: AnalysisResult[]
}

export function ResultsTable({ data }: ResultsTableProps) {
    return (
        <div className="rounded-md border w-full">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Profile Link</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Status</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {data.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center">
                                No data available. Upload a CSV to start.
                            </TableCell>
                        </TableRow>
                    ) : (
                        data.map((row, index) => (
                            <TableRow key={index}>
                                <TableCell className="max-w-[400px]">
                                    <a href={row.profileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-sm truncate block" title={row.profileUrl}>
                                        {row.profileUrl}
                                    </a>
                                </TableCell>
                                <TableCell>
                                    {row.category !== 'N/A' && row.category ? (
                                        <span className="capitalize font-medium">{row.category}</span>
                                    ) : (
                                        <span className="text-muted-foreground">N/A</span>
                                    )}
                                </TableCell>
                                <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground" title={row.reason}>
                                    {row.reason || "-"}
                                </TableCell>
                                <TableCell>
                                    <span className={cn(
                                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                        row.status === 'completed' ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" :
                                            row.status === 'processing' ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300" :
                                                row.status === 'error' ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" :
                                                    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                                    )}>
                                        {row.status}
                                    </span>
                                </TableCell>
                            </TableRow>
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    )
}
