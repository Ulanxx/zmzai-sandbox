import Link from "next/link";
import { Seal } from "@/components/seal";
import { Wordmark } from "@/components/wordmark";

export default function HomePage() {
  return (
    <main className="page-shell flex min-h-dvh flex-col py-10">
      <header className="flex items-center justify-between border-b-2 border-rule pb-5">
        <Wordmark />
        <span className="font-mono text-xs uppercase tracking-widest text-muted">z.zmzai.cloud</span>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-8 py-20">
        <div className="flex items-center gap-6">
          <Seal size={88} className="shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="eyebrow">zmzai cloud · Z</p>
            <h1 className="headline text-5xl sm:text-6xl">沙箱场</h1>
          </div>
        </div>
        <p className="max-w-xl text-xl leading-9 text-ink/80">一个隔离的代码执行与 Agent 实验环境，跑 OPC 小产品的原型和自动化任务。</p>
        <p className="font-mono text-sm text-muted">搭建中 — 牧之的一件 AI 工程。</p>
      </section>

      <footer className="flex items-center justify-between border-t-2 border-rule pt-5 font-mono text-xs text-muted">
        <span>牧之 署名 · zmzai cloud</span>
        <Link href="https://zmzai.cloud" className="transition-colors hover:text-accent">← 回产品矩阵</Link>
      </footer>
    </main>
  );
}
