"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Upload, Send, FileText, X, Loader2, User, Bot } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { apiUrl } from "@/lib/api"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
}

interface UploadedFile {
  id: string
  name: string
  type: "pdf" | "docx"
  size: number
}

export function Chatbot() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    const formData = new FormData()

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fileType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx"
      
      if (fileType !== "pdf" && fileType !== "docx") {
        toast({
          title: "Lỗi",
          description: "Chỉ chấp nhận file PDF hoặc DOCX",
          variant: "destructive",
        })
        continue
      }

      if (file.size > 100 * 1024 * 1024) {
        toast({
          title: "Lỗi",
          description: `File ${file.name} vượt quá 100MB`,
          variant: "destructive",
        })
        continue
      }

      formData.append("files", file)
    }

    try {
      const response = await fetch(apiUrl("/chatbot/upload"), {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Upload failed")
      }

      const data = await response.json()
      
      if (!data.files || data.files.length === 0) {
        throw new Error("No files were processed")
      }

      const newFiles: UploadedFile[] = data.files.map((f: any) => ({
        id: f.id,
        name: f.name,
        type: f.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx",
        size: 0,
      }))
      
      setUploadedFiles((prev) => [...prev, ...newFiles])

      const fileNames = data.files.map((f: any) => f.name).join(", ")
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: `Đã tải lên và xử lý ${data.files.length} file: ${fileNames}. Bạn có thể đặt câu hỏi về nội dung các file này.`,
          timestamp: new Date(),
        },
      ])
    } catch (error) {
      toast({
        title: "Lỗi",
        description: error instanceof Error ? error.message : "Không thể tải file lên. Vui lòng thử lại.",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  const handleSendMessage = async () => {
    const question = input.trim()
    if (!question) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: question,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch(apiUrl("/chatbot/ask"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question,
          file_ids: uploadedFiles.length > 0 ? uploadedFiles.map((f) => f.id) : [],
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to get response")
      }

      const data = await response.json()
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answer || "Xin lỗi, tôi không thể trả lời câu hỏi này.",
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Xin lỗi, đã xảy ra lỗi khi xử lý câu hỏi của bạn. Vui lòng thử lại sau.",
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] bg-white">
      {/* Messages Area - ChatGPT style */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-2xl px-4">
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#0060ac]/10 mb-4">
                  <Bot className="w-8 h-8 text-[#0060ac]" />
                </div>
              </div>
              <h1 className="text-4xl font-semibold text-gray-900 mb-4">
                Hỗ trợ tra cứu văn bản hành chính
              </h1>
              <p className="text-lg text-gray-600 mb-8">
                Tôi có thể giúp bạn trả lời câu hỏi hoặc phân tích tài liệu. Hãy đặt câu hỏi hoặc tải lên file PDF/DOCX để bắt đầu.
              </p>
              {uploadedFiles.length > 0 && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-2">File đã tải lên:</p>
                  <div className="flex flex-wrap gap-2">
                    {uploadedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-2 px-3 py-1.5 bg-white border rounded-md text-sm"
                      >
                        <FileText className="w-4 h-4 text-[#0060ac]" />
                        <span className="max-w-[200px] truncate">{file.name}</span>
                        <button
                          onClick={() => handleRemoveFile(file.id)}
                          className="text-gray-400 hover:text-red-500 ml-1"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-8">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`group flex gap-4 py-4 ${
                  message.role === "user" ? "bg-white" : "bg-gray-50"
                }`}
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {message.role === "user" ? (
                    <div className="w-8 h-8 rounded-full bg-[#0060ac] flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                      <Bot className="w-5 h-5 text-gray-600" />
                    </div>
                  )}
                </div>

                {/* Message Content */}
                <div className="flex-1 min-w-0">
                  <div className="prose prose-sm max-w-none">
                    <div className="whitespace-pre-wrap break-words text-gray-900 leading-relaxed">
                      {message.content}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="group flex gap-4 py-4 bg-gray-50">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-gray-600" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    <span className="text-gray-500 text-sm">Đang suy nghĩ...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area - ChatGPT style */}
      <div className="border-t border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-4">
          {/* Uploaded files display */}
          {uploadedFiles.length > 0 && messages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-md text-sm"
                >
                  <FileText className="w-4 h-4 text-[#0060ac]" />
                  <span className="max-w-[200px] truncate">{file.name}</span>
                  <button
                    onClick={() => handleRemoveFile(file.id)}
                    className="text-gray-400 hover:text-red-500 ml-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input container */}
          <div className="relative flex items-center gap-2">
            {/* File upload button */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="flex-shrink-0 w-10 h-10 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors flex items-center justify-center"
            >
              {isUploading ? (
                <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
              ) : (
                <Upload className="w-5 h-5 text-gray-400" />
              )}
            </label>

            {/* Text input */}
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Nhập câu hỏi của bạn..."
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-[#0060ac] focus:border-transparent min-h-[52px] max-h-[200px] text-gray-900 placeholder-gray-400 leading-normal"
                disabled={isLoading}
                rows={1}
              />
            </div>

            {/* Send button */}
            <button
              onClick={handleSendMessage}
              disabled={isLoading || !input.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#0060ac] text-white flex items-center justify-center hover:bg-[#004d8a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
