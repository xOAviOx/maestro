import { useState } from 'react'
import { AGENT_TYPES, type AgentType, type FanOutVariant } from '@shared/types'
import { useStore } from '../store'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Input, Select, Textarea, FieldLabel } from './ui/Field'
import { Icon } from './ui/Icon'

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
    <Modal onClose={onClose} title="Fan out a task" size="lg">
      <p className="-mt-2 mb-4 text-xs text-content-muted">
        Launch the same task as 2–5 variants in isolated worktrees, then keep the winner.
      </p>

      <div className="flex flex-col gap-4 overflow-y-auto">
        <div>
          <FieldLabel>Task name</FieldLabel>
          <Input
            autoFocus
            placeholder="e.g. add login page"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <FieldLabel>Base branch</FieldLabel>
          <Select value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)}>
            {branches.length === 0 && <option value={baseBranch}>{baseBranch}</option>}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <FieldLabel>Task / prompt</FieldLabel>
          <Textarea
            className="max-h-40 min-h-[64px]"
            placeholder="Describe the task sent to every variant…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <FieldLabel>Variants ({variants.length})</FieldLabel>
            <Button size="sm" variant="secondary" onClick={addVariant} disabled={variants.length >= 5}>
              <Icon name="plus" size={14} />
              Add variant
            </Button>
          </div>
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  className="w-auto"
                  value={v.agentType}
                  onChange={(e) => updateVariant(i, { agentType: e.target.value as AgentType })}
                >
                  {AGENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {AGENT_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <Input
                  className="min-w-0 flex-1"
                  placeholder="model (optional)"
                  value={v.model}
                  onChange={(e) => updateVariant(i, { model: e.target.value })}
                />
                <IconButton
                  onClick={() => removeVariant(i)}
                  disabled={variants.length <= 2}
                  title="Remove variant"
                  aria-label="Remove variant"
                >
                  <Icon name="close" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          <Icon name="fanout" />
          {loading ? 'Launching…' : `Launch ${variants.length} variants`}
        </Button>
      </div>
    </Modal>
  )
}
