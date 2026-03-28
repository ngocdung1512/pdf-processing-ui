import { FileStack, PenLine, ShieldCheck } from "lucide-react"

export function HomeHero() {
  return (
    <section className="mb-8 md:mb-10 max-w-4xl mx-auto text-center">
      <div className="flex flex-col items-center">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#0060ac]/25 bg-white/90 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#0060ac] shadow-sm backdrop-blur-sm md:text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0060ac] animate-pulse" aria-hidden />
          Cổng văn bản nội bộ
        </p>

        <h1 className="font-sans text-balance">
          <span className="block text-[1.65rem] font-bold leading-snug tracking-tight text-slate-800 sm:text-3xl md:text-4xl lg:text-[2.35rem]">
            Chuyển đổi văn bản nội bộ
          </span>
          <span className="mt-1 block bg-gradient-to-r from-[#0060ac] via-[#0a7fd4] to-[#0060ac] bg-clip-text text-[1.85rem] font-extrabold tracking-tight text-transparent sm:text-4xl md:text-5xl lg:text-[2.65rem]">
            PDF sang DOCX
          </span>
        </h1>

        <div
          className="mx-auto mt-6 h-1 w-20 rounded-full bg-gradient-to-r from-transparent via-[#0060ac]/70 to-transparent md:mt-7 md:w-24"
          aria-hidden
        />

        <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-600 md:mt-7 md:max-w-2xl md:text-lg md:leading-relaxed">
          Chuyển đổi, chỉnh sửa và ký tệp PDF{" "}
          <span className="font-medium text-slate-700">dễ dàng từ mọi thiết bị</span>.
        </p>
      </div>
    </section>
  )
}

const featurePills = [
  {
    icon: FileStack,
    label: "Trích xuất thông tin cần thiết",
    iconClass: "text-sky-600",
  },
  {
    icon: PenLine,
    label: "Chỉnh sửa & ký số thuận tiện",
    iconClass: "text-amber-600",
  },
  {
    icon: ShieldCheck,
    label: "Xử lý nội bộ, an toàn dữ liệu",
    iconClass: "text-emerald-600",
  },
] as const

export function HomeFeaturePills() {
  return (
    <ul className="mt-8 md:mt-10 flex flex-col items-stretch gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3 max-w-5xl mx-auto px-1">
      {featurePills.map(({ icon: Icon, label, iconClass }) => (
        <li
          key={label}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md hover:border-slate-300/80"
        >
          <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  )
}
