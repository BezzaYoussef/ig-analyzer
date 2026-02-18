"use client"

import * as React from "react"
import { useCallback, useState } from "react"
import Papa from "papaparse"
import * as XLSX from "xlsx"
import { UploadCloud } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

interface CSVUploaderProps {
    onDataLoaded: (data: any[]) => void
}

export function CSVUploader({ onDataLoaded }: CSVUploaderProps) {
    const [isDragActive, setIsDragActive] = useState(false)

    const processRows = useCallback((rows: string[]) => {
        // rows is an array of string values (one per row, from column A or first column)
        const data = rows
            .map(v => (v || '').toString().trim())
            .filter(v => v.length > 0)
            .map(v => ({ link: v }));

        console.log("Processed rows:", data.length);
        console.log("Sample:", data.slice(0, 5));

        if (data.length > 0) {
            onDataLoaded(data);
        } else {
            alert("File appears to be empty or has no valid data.");
        }
    }, [onDataLoaded]);

    const handleFile = useCallback((file: File) => {
        console.log("File selected:", file.name, "Size:", file.size, "Type:", file.type);

        const ext = file.name.split('.').pop()?.toLowerCase();
        const isExcel = ext === 'xlsx' || ext === 'xls' ||
            file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.type === 'application/vnd.ms-excel';

        if (isExcel) {
            // Handle Excel files with SheetJS
            console.log("Detected Excel file, using XLSX parser");
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const workbook = XLSX.read(data, { type: 'array' });

                    // Use the first sheet
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    console.log("Sheet name:", sheetName);

                    // Convert to array of arrays (no headers assumed)
                    const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    console.log("Total rows in Excel:", rawData.length);

                    // Extract the first column values
                    const values = rawData.map(row => (row[0] || '').toString());
                    console.log("First 5 values:", values.slice(0, 5));

                    processRows(values);
                } catch (err) {
                    console.error("Error parsing Excel file:", err);
                    alert("Error parsing Excel file. Please make sure it's a valid .xlsx or .xls file.");
                }
            };
            reader.readAsArrayBuffer(file);
        } else {
            // Handle CSV/text files
            console.log("Detected CSV/text file");
            const reader = new FileReader();
            reader.onload = (e) => {
                let text = e.target?.result as string;
                if (!text) {
                    alert("Could not read file.");
                    return;
                }

                // Strip BOM if present
                if (text.charCodeAt(0) === 0xFEFF) {
                    text = text.slice(1);
                }

                const firstLine = text.split('\n')[0].trim();
                console.log("First line of CSV:", JSON.stringify(firstLine));

                const looksLikeUrl = firstLine.includes('instagram.com') ||
                    firstLine.startsWith('http') ||
                    firstLine.startsWith('www.');

                if (looksLikeUrl) {
                    // No headers — each line is a link
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    processRows(lines);
                } else {
                    // Has headers — use PapaParse
                    Papa.parse(text, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (results) => {
                            console.log("Parsed with headers. Rows:", results.data.length);
                            if (results.data.length > 0) {
                                onDataLoaded(results.data);
                            } else {
                                alert("CSV file appears to be empty.");
                            }
                        },
                        error: (error: any) => {
                            console.error(error);
                            alert("Error parsing CSV");
                        }
                    });
                }
            };
            reader.readAsText(file, 'UTF-8');
        }
    }, [onDataLoaded, processRows])

    const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setIsDragActive(false)
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0])
        }
    }, [handleFile])

    const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setIsDragActive(true)
    }, [])

    const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setIsDragActive(false)
    }, [])

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0])
        }
    }

    return (
        <Card className={cn(
            "border-2 border-dashed transition-colors hover:bg-muted/50 w-full max-w-md mx-auto cursor-pointer",
            isDragActive ? "border-primary bg-muted" : "border-muted-foreground/25"
        )}>
            <CardContent
                className="flex flex-col items-center justify-center py-10 text-center space-y-4"
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => document.getElementById("csv-upload")?.click()}
            >
                <div className="p-4 rounded-full bg-background border shadow-sm">
                    <UploadCloud className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                    <p className="text-lg font-medium">
                        Drag & drop your file here
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                        Supports CSV and Excel (.xlsx) files
                    </p>
                </div>
                <input
                    id="csv-upload"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={handleInputChange}
                />
            </CardContent>
        </Card>
    )
}
