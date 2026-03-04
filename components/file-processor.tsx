"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { FileText, CheckCircle2, Download, X, Loader2, Lock } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/api"

type ProcessState = "idle" | "uploaded" | "processing" | "completed" | "error"

interface OcrCardProps {
  isLocked: boolean
  onLock: () => void
  onUnlock: () => void
}

// ===== OCR cơ bản: chỉ trích xuất text, không giữ bố cục =====
function BasicOcrCard({ isLocked, onLock, onUnlock }: OcrCardProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState(0)
  const [elapsedTime, setElapsedTime] = useState(0)
  const timerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) {
      setFile(f)
      setFileName(f.name)
      setResultBlob(null)
      setErrorMessage(null)
    }
  }

  const reset = () => {
    // Nếu đang xử lý thì hủy request hiện tại
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }

    setFile(null)
    setFileName(null)
    setResultBlob(null)
    setErrorMessage(null)
    setProgress(0)
    setElapsedTime(0)
    if (fileInputRef.current) fileInputRef.current.value = ""

    // Thông báo cho parent bỏ khóa nếu đang khóa bởi OCR cơ bản
    onUnlock()
  }

  const handleProcessBasic = async () => {
    if (!file) return

    setIsProcessing(true)
    setResultBlob(null)
    setErrorMessage(null)
    setProgress(0)
    setElapsedTime(0)

    // Bắt đầu đếm thời gian và cập nhật progress giả lập (0 → 90%)
    startTimeRef.current = performance.now()
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
    }
    timerRef.current = window.setInterval(() => {
      if (startTimeRef.current != null) {
        const elapsedMs = performance.now() - startTimeRef.current
        setElapsedTime(elapsedMs / 1000)
      }
      setProgress((prev) => (prev < 90 ? prev + 5 : prev))
    }, 500)

    // Khóa chế độ còn lại
    onLock()

    try {
      const formData = new FormData()
      formData.append("file", file)

      const controller = new AbortController()
      abortRef.current = controller

      const res = await fetch(apiUrl("/convert_basic"), {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })

      if (!res.ok) {
        let message = "Đã xảy ra lỗi khi xử lý file. Vui lòng thử lại."
        try {
          const data = await res.json()
          if (data?.error) {
            message = data.error
          }
        } catch {
          // ignore JSON parse error
        }
        throw new Error(message)
      }

      const blob = await res.blob()
      setResultBlob(blob)
    } catch (err) {
      // Nếu là lỗi do abort (hủy), không hiện lỗi
      if (err instanceof DOMException && err.name === "AbortError") {
        // Bị hủy bởi người dùng
      } else if (err instanceof Error) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage("Đã xảy ra lỗi không xác định.")
      }
    } finally {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      abortRef.current = null
      if (startTimeRef.current != null) {
        const elapsedMs = performance.now() - startTimeRef.current
        setElapsedTime(elapsedMs / 1000)
      }
      setProgress(100)
      setIsProcessing(false)
      // Mở khóa cho phép chọn chế độ khác
      onUnlock()
    }
  }

  const handleDownload = () => {
    if (!resultBlob) return

    const url = URL.createObjectURL(resultBlob)
    const a = document.createElement("a")

    a.href = url
    const baseName = fileName?.replace(/\.pdf$/i, "") || "result"
    a.download = `${baseName}_basic.docx`

    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const formatElapsedTime = (seconds: number): string => {
    if (seconds <= 0) return "0.0s"
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const mins = Math.floor(seconds / 60)
    const secs = (seconds % 60).toFixed(1)
    return `${mins}m ${secs}s`
  }

  return (
    <div className={`bg-white rounded-2xl border border-dashed border-gray-200 p-6 md:p-8 transition-all shadow-sm relative overflow-hidden h-full ${isLocked ? "opacity-60" : ""}`}>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-sky-500 to-blue-500 opacity-20" />

      <div className={`flex flex-col items-center justify-center text-center space-y-5 ${isLocked ? "pointer-events-none" : ""}`}>
        <h2 className="text-xl font-bold text-gray-800 mb-2">OCR cơ bản</h2>
        <p className="text-sm text-gray-500 max-w-md">
          Hỗ trợ cả PDF văn bản và PDF scan. Hệ thống chỉ trích xuất nội dung chữ, không giữ bố cục, bảng hay hình ảnh.
        </p>

        {!file && (
          <>
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mb-2 border border-gray-100">
              <FileText className="w-7 h-7 text-gray-400" />
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
              className="bg-[#1a1a1a] hover:bg-black text-white px-4 py-3 rounded-md text-sm font-semibold"
              disabled={isProcessing}
            >
              Chọn PDF cho OCR cơ bản
            </Button>
            <p className="text-xs text-gray-400">Lên đến 100 MB</p>
          </>
        )}

        {file && (
          <>
            <div className="flex flex-col items-center space-y-2">
              <span className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                {fileName}
                <button onClick={reset} className="text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </span>
              <p className="text-xs text-gray-500">File đã sẵn sàng để xử lý nhanh.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
              <Button
                onClick={handleProcessBasic}
                className="bg-[#0060ac] hover:bg-[#004d8a] text-white px-4 py-3 rounded-md text-sm font-bold"
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang xử lý...
                  </span>
                ) : (
                  "Xử lý nhanh (OCR cơ bản)"
                )}
              </Button>

              {resultBlob && (
                <Button
                  onClick={handleDownload}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-md text-sm font-bold flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Tải DOCX
                </Button>
              )}
            </div>

            {(isProcessing || elapsedTime > 0) && (
              <div className="w-full max-w-md mt-4 space-y-2">
                <Progress value={progress} className="h-3 rounded-full bg-gray-100 border border-gray-200" />
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span>{isProcessing ? `Đang xử lý... ${Math.min(progress, 100)}%` : "Hoàn tất"}</span>
                  <span>Thời gian xử lý: {formatElapsedTime(elapsedTime)}</span>
                </div>
              </div>
            )}
          </>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-w-md mx-auto">
            <p className="text-red-800 text-xs whitespace-pre-wrap break-words">{errorMessage}</p>
          </div>
        )}

        <p className="text-[11px] text-gray-400">
          Lưu ý: Trích xuất văn bản nhanh chóng. Nếu muốn giữ bố cục văn bản gần giống bản gốc, hãy sử dụng OCR nâng cao.
        </p>
      </div>

      {isLocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-white/60">
          <Lock className="w-8 h-8 text-gray-900 mb-1" />
          <p className="text-xs font-semibold text-gray-900">Đang xử lý bằng chế độ khác</p>
        </div>
      )}
    </div>
  )
}

export function FileProcessor() {
  const [activeMode, setActiveMode] = useState<"none" | "basic" | "advanced">("none")

  return (
    <div className="grid gap-4 lg:gap-6 lg:grid-cols-2 h-full">
      <BasicOcrCard
        isLocked={activeMode === "advanced"}
        onLock={() => setActiveMode("basic")}
        onUnlock={() => setActiveMode((m) => (m === "basic" ? "none" : m))}
      />
      <AdvancedOcrCard
        isLocked={activeMode === "basic"}
        onLock={() => setActiveMode("advanced")}
        onUnlock={() => setActiveMode((m) => (m === "advanced" ? "none" : m))}
      />
    </div>
  )
}

// ===== OCR nâng cao: luồng hiện tại (giữ bố cục, hỗ trợ scan) =====
function AdvancedOcrCard({ isLocked, onLock, onUnlock }: OcrCardProps) {
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

    onLock()
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
      onUnlock()
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

  const cancelProcessing = async () => {
    // Gọi reset trước để UI quay về trạng thái ban đầu
    const currentJobId = jobId
    reset()
    onUnlock()

    if (!currentJobId) return

    try {
      await fetch(apiUrl(`/cancel/${currentJobId}`), {
        method: "POST",
      })
    } catch {
      // Bỏ qua lỗi khi hủy, vì đây chỉ là best-effort cancel
    }
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
    <div className={`bg-white rounded-2xl border border-dashed border-gray-200 p-6 md:p-8 transition-all shadow-sm relative overflow-hidden h-full ${isLocked ? "opacity-60" : ""}`}>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 via-blue-500 to-red-500 opacity-20" />

      <div className={`flex flex-col items-center justify-center text-center space-y-5 ${isLocked ? "pointer-events-none" : ""}`}>
        <h2 className="text-xl font-bold text-gray-800 mb-2">OCR nâng cao (giữ bố cục)</h2>
        <p className="text-sm text-gray-500 max-w-md">
          Phù hợp với PDF scan hoặc tài liệu phức tạp. Hỗ trợ giữ bố cục văn bản gần đúng theo bố cục gốc.
        </p>

        {state === "idle" && (
          <>
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mb-2 border border-gray-100">
              <FileText className="w-7 h-7 text-gray-400" />
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
              className="bg-[#1a1a1a] hover:bg-black text-white px-4 py-3 rounded-md text-sm font-semibold"
            >
              Chọn PDF cho OCR nâng cao
            </Button>
            <p className="text-xs text-gray-400">Lên đến 100 MB</p>
          </>
        )}

        {state === "uploaded" && (
          <>
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-2 border border-blue-100">
              <FileText className="w-7 h-7 text-blue-500" />
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
              className="bg-[#0060ac] hover:bg-[#004d8a] text-white px-8 py-4 rounded-md text-base font-bold w-full max-w-xs"
            >
              Xử lý
            </Button>
          </>
        )}

        {state === "processing" && (
          <div className="w-full max-w-md space-y-6">
            {fileName && (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-700">
                <span className="font-medium truncate max-w-[260px]" title={fileName}>
                  {fileName}
                </span>
                <button
                  onClick={cancelProcessing}
                  className="text-gray-400 hover:text-red-500"
                  title="Hủy xử lý và tải lại file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex items-center justify-center gap-3 text-blue-600 font-bold text-lg">
              <Loader2 className="w-5 h-5 animate-spin" />
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
            <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center mb-2 border border-green-100 animate-bounce">
              <CheckCircle2 className="w-7 h-7 text-green-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-gray-800">Xử lý thành công!</h3>
              <p className="text-gray-500">{fileName} đã sẵn sàng để tải về.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
              <Button
                onClick={handleDownload}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-4 rounded-md text-base font-bold flex items-center gap-2"
              >
                <Download className="w-5 h-5" />
                Tải về
              </Button>
              <Button
                variant="outline"
                onClick={reset}
                className="px-6 py-4 rounded-md text-base font-bold border-2 bg-transparent"
              >
                Tải lên tệp khác
              </Button>
            </div>
            {elapsedTime > 0 && (
              <p className="text-gray-600 text-sm font-medium mt-2">
                Thời gian xử lý: {formatElapsedTime(elapsedTime)}
              </p>
            )}
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
              <div className="flex gap-3 justify-center">
                <Button 
                  onClick={reset}
                  className="px-6 py-4 rounded-md text-base font-bold bg-blue-600 hover:bg-blue-700 text-white"
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

        <p className="text-[11px] text-gray-400 mt-2">
          Lưu ý: Thời gian có thể xử lý lâu (từ vài phút tới hàng chục phút, cân nhắc sử dụng chế độ hợp lý).
        </p>
      </div>

      {isLocked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-white/60">
          <Lock className="w-8 h-8 text-gray-900 mb-1" />
          <p className="text-xs font-semibold text-gray-900">Đang xử lý bằng chế độ khác</p>
        </div>
      )}
    </div>
  )
}
