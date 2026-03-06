import Image from "next/image"
import Link from "next/link"

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 h-20 bg-white border-b z-50 px-6 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-4">
          <div className="relative w-14 h-14">
            <Image
              src="/images/logo-h-e1-bb-8dc-vi-e1-bb-87n-k-e1-bb-b9-thu-e1-ba-adt-v-c3-a0-c-c3-b4ng-ngh-e1-bb-87-an-ninh-n-c4-83m-2025.png"
              alt="Logo Học viện Kỹ thuật và Công nghệ An ninh"
              fill
              className="object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-[#0060ac] uppercase leading-tight">
              Học viện Kỹ thuật và Công nghệ An ninh
            </span>
            <span className="text-[10px] text-gray-500 uppercase tracking-tighter">
              Academy of Security Engineering and Technology
            </span>
          </div>
        </Link>
      </div>

      <nav className="hidden md:flex items-center gap-6">
        <Link
          href="/"
          className="text-sm font-semibold text-[#0060ac] px-4 py-2 rounded-full border border-[#0060ac]/20 bg-[#f5f9ff] hover:bg-[#0060ac] hover:text-white shadow-sm transition-colors"
        >
          Trang chủ
        </Link>
      </nav>
    </header>
  )
}
