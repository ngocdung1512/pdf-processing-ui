import { Header } from "@/components/header"
import { FileProcessor } from "@/components/file-processor"

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f8f9fa]">
      <Header />
      <div className="container mx-auto px-4 pt-20 pb-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-[#1a1a1a] mb-4 leading-relaxed">
            Chuyển đổi văn bản nội bộ PDF sang DOCX
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Chuyển đổi, chỉnh sửa và ký tệp PDF dễ dàng từ mọi thiết bị.
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          <FileProcessor />
        </div>
      </div>

      <footer className="mt-auto py-8 border-t bg-white text-center text-sm text-gray-500">
        © 2026 Học viện Kỹ thuật và Công nghệ An ninh. Bảo lưu mọi quyền.
      </footer>
    </main>
  )
}
