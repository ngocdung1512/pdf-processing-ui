import { Header } from "@/components/header"
import { FileProcessor } from "@/components/file-processor"
import { HomeFeaturePills, HomeHero } from "@/components/home-hero"

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col pt-24">
      <div
        className="pointer-events-none fixed inset-0 -z-20 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/background.jpg')" }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-white/80 backdrop-blur-[2px]"
        aria-hidden
      />

      <Header />
      <div className="container relative z-0 mx-auto flex flex-1 flex-col justify-center px-4 pb-8">
        <HomeHero />

        <div className="mx-auto mt-8 max-w-5xl md:mt-10">
          <FileProcessor />
        </div>

        <HomeFeaturePills />
      </div>

      <footer className="relative z-0 mt-auto border-t border-slate-200/80 bg-white/90 py-8 text-center text-sm text-slate-600 backdrop-blur-sm">
        © 2026 Học viện Kỹ thuật và Công nghệ An ninh. Bảo lưu mọi quyền.
      </footer>
    </main>
  )
}
