"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { FileText, CheckCircle2, Download, X, Loader2 } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api"

type ProcessState = "idle" | "uploaded" | "processing" | "completed" | "error"

export function FileProcessor() {
  const [state, setState] = useState<ProcessState>("idle")
  const [progress, setProgress] = useState(0)
  const [fileName, setFileName] = useState<string | null>(null)
  const [progressInfo, setProgressInfo] = useState<{ current: number; total: number } | null>(null)
  const [elapsedTime, setElapsedTime] = useState<number>(0)
  const [pdfType, setPdfType] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 🔥 THÊM: giữ file PDF thật
  const [file, setFile] = useState<File | null>(null)

  // 🔥 THÊM: giữ file DOCX trả về
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)

  // 🔥 THÊM: giữ job_id để poll progress
  const [jobId, setJobId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ===== chọn file =====
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setFileName(f.name)
      setState("uploaded")
    }
  }

  // ===== POLL PROGRESS =====
  useEffect(() => {
    if (!jobId || state !== "processing") return

    let isMounted = true
    let timeoutId: NodeJS.Timeout | null = null

    const pollProgress = async () => {
      if (!isMounted) return

      try {
        const res = await fetch(apiUrl(`/progress/${jobId}`))
        if (!res.ok) {
          if (isMounted) {
            timeoutId = setTimeout(pollProgress, 1000)
          }
          return
        }

        const data = await res.json()
        
        if (!isMounted) return

        console.log(`[Progress Poll] Job ${jobId}:`, data)
        
        // Update PDF type if available
        if (data.pdf_type && !pdfType) {
          setPdfType(data.pdf_type)
        }
        
        // Only update progress if not done yet
        if (data.status !== "done") {
          setProgress(data.percent || 0)
          if (data.current !== undefined && data.total !== undefined) {
            setProgressInfo({ current: data.current, total: data.total })
          }
          if (data.elapsed_time !== undefined) {
            setElapsedTime(data.elapsed_time)
          }
        }

        if (data.status === "done") {
          // Stop polling immediately
          if (!isMounted) return
          
          // Set final values
          setProgress(100)
          if (data.elapsed_time !== undefined) {
            setElapsedTime(data.elapsed_time)
          }
          
          // Download result file
          const resultRes = await fetch(apiUrl(`/result/${jobId}`))
          if (resultRes.ok) {
            const blob = await resultRes.blob()
            if (isMounted) {
              setResultBlob(blob)
              setState("completed")
            }
          } else {
            if (isMounted) {
              setState("error")
              setErrorMessage("Không thể tải file kết quả. Vui lòng thử lại.")
            }
          }
        } else if (data.status === "error") {
          if (isMounted) {
            setState("error")
            // Get error message from backend if available
            if (data.error) {
              setErrorMessage(data.error)
            } else {
              setErrorMessage("Đã xảy ra lỗi khi xử lý file. Vui lòng thử lại.")
            }
          }
        } else {
          // Continue polling if still running
          timeoutId = setTimeout(pollProgress, 500) // Poll every 500ms
        }
      } catch (err) {
        console.error("Progress poll error:", err)
        if (isMounted) {
          // Retry after 1 second
          timeoutId = setTimeout(pollProgress, 1000)
        }
      }
    }

    // Start polling after a short delay
    timeoutId = setTimeout(pollProgress, 500)
    
    return () => {
      isMounted = false
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [jobId, state])

  // ===== XỬ LÝ OCR THẬT =====
  const handleProcess = async () => {
    if (!file) return

    setState("processing")
    setProgress(0)
    setProgressInfo(null)
    setJobId(null)
    setElapsedTime(0)
    setPdfType(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const res = await fetch(apiUrl("/convert"), {
        method: "POST",
        body: formData,
      })

      if (!res.ok) throw new Error("OCR failed")

      const data = await res.json()
      if (data.job_id) {
        setJobId(data.job_id)
        if (data.pdf_type) {
          setPdfType(data.pdf_type)
        }
        // Progress will be updated by polling effect
      } else {
        throw new Error("No job_id received")
      }
    } catch (err) {
      console.error(err)
      setState("error")
      setJobId(null)
      setErrorMessage(err instanceof Error ? err.message : "Đã xảy ra lỗi khi upload file. Vui lòng thử lại.")
    }
  }

  // ===== TẢI DOCX THẬT =====
  const handleDownload = () => {
    if (!resultBlob || !fileName) return

    const url = URL.createObjectURL(resultBlob)
    const a = document.createElement("a")

    a.href = url
    a.download = fileName.replace(/\.pdf$/i, ".docx")

    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const reset = () => {
    setState("idle")
    setProgress(0)
    setFileName(null)
    setFile(null)
    setResultBlob(null)
    setJobId(null)
    setProgressInfo(null)
    setElapsedTime(0)
    setPdfType(null)
    setErrorMessage(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Format elapsed time for display
  const formatElapsedTime = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`
    }
    const mins = Math.floor(seconds / 60)
    const secs = (seconds % 60).toFixed(1)
    return `${mins}m ${secs}s`
  }

  return (
    <div className="bg-white rounded-3xl border-2 border-dashed border-gray-200 p-8 md:p-16 transition-all shadow-sm relative overflow-hidden">
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 via-blue-500 to-red-500 opacity-20" />

      <div className="flex flex-col items-center justify-center text-center space-y-6">

        {state === "idle" && (
          <>
            <div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 border border-gray-100">
              <FileText className="w-10 h-10 text-gray-400" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-red-500 mb-2">Thả tệp PDF của bạn</h3>
              <p className="text-gray-400 font-medium">HOẶC</p>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf"
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#1a1a1a] hover:bg-black text-white px-8 py-6 rounded-md text-lg font-bold"
            >
              Tải lên PDF để chuyển đổi
            </Button>
            <p className="text-xs text-gray-400">Lên đến 100 MB</p>
          </>
        )}

        {state === "uploaded" && (
          <>
            <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 border border-blue-100">
              <FileText className="w-10 h-10 text-blue-500" />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                {fileName}
                <button onClick={reset} className="text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </span>
              <p className="text-sm text-gray-500 mt-1">Đã sẵn sàng xử lý</p>
            </div>
            <Button
              onClick={handleProcess}
              className="bg-[#0060ac] hover:bg-[#004d8a] text-white px-12 py-6 rounded-md text-lg font-bold w-full max-w-xs"
            >
              Xử lý
            </Button>
          </>
        )}

        {state === "processing" && (
          <div className="w-full max-w-md space-y-6">
            <div className="flex items-center justify-center gap-3 text-blue-600 font-bold text-xl">
              <Loader2 className="w-6 h-6 animate-spin" />
              Đang xử lý... {progress}%
            </div>
            {pdfType && (
              <p className="text-gray-700 font-semibold text-lg">
                {pdfType === "scan" ? "PDF Scan" : "PDF Text"}
              </p>
            )}
            <Progress value={progress} className="h-4 rounded-full bg-gray-100 border border-gray-200" />
            {pdfType === "scan" && progressInfo && (
              <p className="text-gray-500 italic">
                Recognizing Text: {progressInfo.current}/{progressInfo.total} pages
              </p>
            )}
            {pdfType === "scan" && !progressInfo && (
              <p className="text-gray-500 italic">Đang khởi tạo quá trình xử lý...</p>
            )}
            {pdfType === "text" && (
              <p className="text-gray-500 italic">Đang chuyển đổi và giữ nguyên bố cục...</p>
            )}
            {elapsedTime > 0 && (
              <p className="text-gray-600 font-medium">
                Thời gian xử lý: {formatElapsedTime(elapsedTime)}
              </p>
            )}
          </div>
        )}

        {state === "completed" && (
          <>
            <div className="w-20 h-20 bg-green-50 rounded-2xl flex items-center justify-center mb-4 border border-green-100 animate-bounce">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-gray-800">Xử lý thành công!</h3>
              <p className="text-gray-500">{fileName} đã sẵn sàng để tải về.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
              <Button
                onClick={handleDownload}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-6 rounded-md text-lg font-bold flex items-center gap-2"
              >
                <Download className="w-5 h-5" />
                Tải về
              </Button>
              <Button
                variant="outline"
                onClick={reset}
                className="px-8 py-6 rounded-md text-lg font-bold border-2 bg-transparent"
              >
                Tải lên tệp khác
              </Button>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <div className="text-center space-y-4">
              <p className="text-red-600 font-bold text-xl">Xử lý thất bại</p>
              {errorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-2xl mx-auto">
                  <p className="text-red-800 text-sm whitespace-pre-wrap break-words">
                    {errorMessage}
                  </p>
                </div>
              )}
              <div className="flex gap-4 justify-center">
                <Button 
                  onClick={reset}
                  className="px-8 py-6 rounded-md text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white"
                >
                  Thử lại
                </Button>
              </div>
              <p className="text-gray-500 text-sm mt-4">
                💡 Mẹo: Kiểm tra terminal backend để xem log chi tiết về lỗi
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
