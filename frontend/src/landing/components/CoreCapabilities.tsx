import { motion } from 'framer-motion'
import { MessageSquare, Search, Terminal } from 'lucide-react'

const capabilities = [
  {
    icon: MessageSquare,
    title: 'Chat with Documents',
    description: 'Upload complex files, process them into hierarchical chunks, and ask questions directly. Seamless integration allows immediate search across indexed documents.',
    badge: 'Interactive Client',
    method: 'POST',
    path: '/api/v1/chat/stream',
    codeType: 'SSE STREAMING',
    codeLines: [
      { key: 'message', val: '"Summarize chunking trade-offs"', type: 'str' },
      { key: 'collection_id', val: '"ml_papers_2026"', type: 'str' },
      { key: 'stream', val: 'true', type: 'bool' },
    ],
  },
  {
    icon: Search,
    title: 'Research Mode',
    description: 'Synthesize knowledge. Decompose query targets, dynamically execute web lookups when documents lack answers, and compile cited reports.',
    badge: 'Stateful Agentic Loops',
    method: 'POST',
    path: '/api/v1/agent/research',
    codeType: 'AGENT GRAPH API',
    codeLines: [
      { key: 'topic', val: '"Quantum computing benchmarks"', type: 'str' },
      { key: 'depth', val: '"exhaustive"', type: 'str' },
      { key: 'include_web', val: 'true', type: 'bool' },
    ],
  },
  {
    icon: Terminal,
    title: 'RAG API First',
    description: 'Programmatic REST endpoints return clean structured JSON with sources, confidence score, and intermediate node execution trace logs.',
    badge: 'Developer REST Interface',
    method: 'POST',
    path: '/api/v1/retrieve',
    codeType: 'STRUCTURED REST',
    codeLines: [
      { key: 'query', val: '"Q3 Revenue impact analysis"', type: 'str' },
      { key: 'score_threshold', val: '0.85', type: 'num' },
      { key: 'citations', val: '"grounded"', type: 'str' },
    ],
  },
]

export default function CoreCapabilities() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.12 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] as const },
    },
  }

  return (
    <section id="capabilities" className="border-t border-border bg-background py-28">
      <div className="mx-auto max-w-6xl px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6 }}
          className="mb-16"
        >
          <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Platform Specs
          </p>
          <h2
            className="text-3xl font-medium leading-tight tracking-[-0.03em] text-foreground md:text-4xl"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Core Capabilities
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Three core pathways built to experiment with dynamic retrieval, async task execution, and structured APIs.
          </p>
        </motion.div>

        {/* 3-Column Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="grid grid-cols-1 gap-6 lg:grid-cols-3"
        >
          {capabilities.map((cap) => {
            const Icon = cap.icon
            return (
              <motion.div
                key={cap.title}
                variants={itemVariants}
                className="group flex flex-col justify-between rounded-2xl border border-border bg-card/60 dark:bg-white/[0.02] p-8 transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:bg-card dark:hover:bg-white/[0.04] hover:shadow-xl hover:shadow-primary/5 dark:hover:shadow-black/50"
              >
                <div>
                  <div className="mb-8 flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-all duration-300 group-hover:scale-110 group-hover:bg-primary/20">
                      <Icon className="h-5 w-5" strokeWidth={1.5} />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
                      {cap.badge}
                    </span>
                  </div>
                  <h3 className="mb-3 text-[15px] font-medium text-foreground transition-colors duration-200 group-hover:text-primary">{cap.title}</h3>
                  <p className="mb-6 text-[13px] leading-relaxed text-muted-foreground transition-colors duration-200 group-hover:text-foreground/80">{cap.description}</p>
                </div>

                <div className="flex flex-col rounded-xl border border-zinc-800/80 bg-zinc-950 dark:bg-[#07070A] p-3.5 font-mono text-[10.5px] leading-relaxed text-zinc-300 shadow-md transition-all duration-300 group-hover:border-primary/40 overflow-hidden">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800/70 text-[9px] uppercase tracking-wider">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500/80" />
                      <span className="w-2 h-2 rounded-full bg-amber-500/80" />
                      <span className="w-2 h-2 rounded-full bg-emerald-500/80" />
                    </div>
                    <span className="text-zinc-500 font-semibold">{cap.codeType}</span>
                  </div>
                  <div className="overflow-x-auto scrollbar-none space-y-0.5">
                    <p>
                      <span className="text-emerald-400 font-bold">{cap.method}</span>{' '}
                      <span className="text-zinc-200">{cap.path}</span>
                    </p>
                    <p className="text-zinc-500 mt-1">{'{'}</p>
                    {cap.codeLines.map((line, idx, arr) => (
                      <p key={line.key} className="pl-3.5 truncate">
                        <span className="text-violet-300">&quot;{line.key}&quot;</span>:
                        <span className={line.type === 'bool' ? 'text-amber-300' : line.type === 'num' ? 'text-cyan-300' : 'text-emerald-300'}>
                          {' '}{line.val}
                        </span>
                        {idx < arr.length - 1 ? ',' : ''}
                      </p>
                    ))}
                    <p className="text-zinc-500">{'}'}</p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
