import { useState } from 'react'
import { AGENT_TYPES, type AgentType, type FanOutVariant } from '@shared/types'
import { useStore } from '../store'

const AGENT_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor'
}

interface VariantRow {
  agentType: AgentType
  model: string
}

/** Modal to launch one task as N competing variants (fan-out). */
export function FanOutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const repoInfo = useStore((s) => s.repoInfo)
  const fanOut = useStore((s) => s.fanOut)
  const loading = useStore((s) => s.loading)

  const [name, setName] = useState('')
  const [baseBranch, setBaseBranch] = useState(repoInfo?.defaultBaseBranch ?? 'main')
  const [prompt, setPrompt] = useState('')
  const [variants, setVariants] = useState<VariantRow[]>([
    { agentType: 'claude-code', model: '' },
    { agentType: 'claude-code', model: '' }
  ])

  const branches = repoInfo?.branches ?? []
  const canSubmit =
    name.trim().length > 0 &&
    baseBranch.length > 0 &&
    prompt.trim().length > 0 &&
    variants.length >= 2 &&
    !loading

  const addVariant = (): void => {
    if (variants.length >= 5) return
    setVariants((v) => [...v, { agentType: 'claude-code', model: '' }])
  }
  const removeVariant = (i: number): void => {
    if (variants.length <= 2) return
    setVariants((v) => v.filter((_, idx) => idx !== i))
  }
  const updateVariant = (i: number, patch: Partial<VariantRow>): void => {
    setVariants((v) => v.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    const payload: FanOutVariant[] = variants.map((v) =>
      v.model.trim() ? { agentType: v.agentType, model: v.model.trim() } : { agentType: v.agentType }
    )
    await fanOut(name.trim(), baseBranch, prompt.trim(), payload)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Fan out a task</h2>
        <p className="mb-4 text-xs text-slate-400">
          Launch the same task as 2–5 variants in isolated worktrees, then keep the winner.
        </p>
        {/* PLACEHOLDER_FORM */}
        <label className="mb-1 block text-xs font-medium text-slate-400">Task name</label>
        <input
          autoFocus
          className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="e.g. add login page"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="mb-1 block text-xs font-medium text-slate-400">Base branch</label>
        <select
          className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
        >
          {branches.length === 0 && <option value={baseBranch}>{baseBranch}</option>}
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-slate-400">Task / prompt</label>
        <textarea
          className="mb-4 max-h-40 min-h-[64px] w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="Describe the task sent to every variant…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-400">
            Variants ({variants.length})
          </label>
          <button
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            onClick={addVariant}
            disabled={variants.length >= 5}
          >
            + Add variant
          </button>
        </div>
        <div className="mb-4 space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                value={v.agentType}
                onChange={(e) => updateVariant(i, { agentType: e.target.value as AgentType })}
              >
                {AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {AGENT_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-slate-500"
                placeholder="model (optional)"
                value={v.model}
                onChange={(e) => updateVariant(i, { model: e.target.value })}
              />
              <button
                className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-30"
                onClick={() => removeVariant(i)}
                disabled={variants.length <= 2}
                title="Remove variant"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-status-running px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {loading ? 'Launching…' : `Launch ${variants.length} variants`}
          </button>
        </div>
      </div>
    </div>
  )
}
