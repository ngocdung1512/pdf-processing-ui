import { Header } from "@/components/header"
import { FileProcessor } from "@/components/file-processor"

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f8f9fa] flex flex-col">
      <Header />
      <div className="container mx-auto px-4 flex-1 flex flex-col justify-center py-8">
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold text-[#1a1a1a] mb-3 leading-relaxed">
            Chuyển đổi văn bản nội bộ PDF sang DOCX
          </h1>
          <p className="text-base md:text-lg text-gray-600 max-w-2xl mx-auto">
            Chuyển đổi, chỉnh sửa và ký tệp PDF dễ dàng từ mọi thiết bị.
          </p>
        </div>

        <div className="max-w-5xl mx-auto">
          <FileProcessor />
        </div>
      </div>

      <footer className="mt-auto py-8 border-t bg-white text-center text-sm text-gray-500">
        © 2026 Học viện Kỹ thuật và Công nghệ An ninh. Bảo lưu mọi quyền.
      </footer>
    </main>
  )
}
