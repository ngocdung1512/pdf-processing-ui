import { Header } from "@/components/header"
import { Chatbot } from "@/components/chatbot"

export default function ChatbotPage() {
  return (
    <main className="min-h-screen bg-white flex flex-col">
      <Header />
      <div className="flex-1 pt-20">
        <Chatbot />
      </div>
      <footer className="py-4 border-t bg-white text-center text-sm text-gray-500">
        © 2026 Học viện Kỹ thuật và Công nghệ An ninh. Bảo lưu mọi quyền.
      </footer>
    </main>
  )
}

