import type { NewTaskInput } from '@shared/types'

/**
 * Ship-with templates for the builder. Each is a set of tasks with `dependsOn`
 * wired by id; the builder seeds its canvas from one and the user edits prompts
 * / base branch before creating. Kept as plain data (the same shape a
 * saved/loaded JSON template uses) so import/export round-trips cleanly.
 */
export interface WorkflowTemplate {
  key: string
  name: string
  description: string
  tasks: NewTaskInput[]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'feature-tests-docs',
    name: 'Feature + tests + docs',
    description: 'A 3-task chain: implement, then test, then document — each sees the prior merge.',
    tasks: [
      {
        id: 'feature',
        title: 'Implement feature',
        prompt: 'Implement the feature described in the issue. Keep the change focused.',
        dependsOn: []
      },
      {
        id: 'tests',
        title: 'Add tests',
        prompt: 'Add unit tests covering the feature merged before you. Aim for the key paths.',
        dependsOn: ['feature']
      },
      {
        id: 'docs',
        title: 'Write docs',
        prompt: 'Document the feature and its tests. Update the README feature list.',
        dependsOn: ['tests']
      }
    ]
  },
  {
    key: 'parallel-refactor',
    name: 'Parallel refactor (diamond)',
    description:
      'A diamond: split prep, two refactors run in parallel, then a merge/verify task sees both.',
    tasks: [
      {
        id: 'prep',
        title: 'Prep / scaffolding',
        prompt: 'Lay the groundwork both refactors depend on (shared types, helpers).',
        dependsOn: []
      },
      {
        id: 'refactor-a',
        title: 'Refactor module A',
        prompt: 'Refactor module A onto the prepared scaffolding.',
        dependsOn: ['prep']
      },
      {
        id: 'refactor-b',
        title: 'Refactor module B',
        prompt: 'Refactor module B onto the prepared scaffolding.',
        dependsOn: ['prep']
      },
      {
        id: 'verify',
        title: 'Integrate + verify',
        prompt: 'With both refactors merged, reconcile the seams and run the full test suite.',
        dependsOn: ['refactor-a', 'refactor-b']
      }
    ]
  }
]
