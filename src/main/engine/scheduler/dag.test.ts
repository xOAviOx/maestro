import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '@shared/types'
import {
  computeReady,
  descendants,
  detectCycle,
  fifoReadyOrder,
  findMissingDependencies,
  type GraphTask
} from './dag'

/** Compact GraphTask builder. */
function t(
  id: string,
  dependsOn: string[] = [],
  status: TaskStatus = 'blocked',
  createdAt = 0
): GraphTask {
  return { id, dependsOn, status, createdAt }
}

describe('detectCycle (Kahn topological sort)', () => {
  it('returns [] for an acyclic chain', () => {
    expect(detectCycle([t('a'), t('b', ['a']), t('c', ['b'])])).toEqual([])
  })

  it('returns [] for an acyclic diamond', () => {
    const tasks = [t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b', 'c'])]
    expect(detectCycle(tasks)).toEqual([])
  })

  it('detects a simple 2-node cycle and reports the involved tasks', () => {
    const cycle = detectCycle([t('a', ['b']), t('b', ['a'])])
    expect(cycle.sort()).toEqual(['a', 'b'])
  })

  it('detects a self-dependency as a cycle', () => {
    expect(detectCycle([t('a', ['a'])])).toEqual(['a'])
  })

  it('reports only the tasks on/after the cycle, not acyclic roots', () => {
    // a -> b -> c -> b (b,c form a cycle); a is fine.
    const cycle = detectCycle([t('a'), t('b', ['a', 'c']), t('c', ['b'])]).sort()
    expect(cycle).toEqual(['b', 'c'])
  })
})

describe('findMissingDependencies', () => {
  it('flags edges pointing at unknown task ids', () => {
    const missing = findMissingDependencies([t('a', ['ghost']), t('b', ['a'])])
    expect(missing).toEqual([{ taskId: 'a', missing: ['ghost'] }])
  })

  it('returns [] when every edge resolves', () => {
    expect(findMissingDependencies([t('a'), t('b', ['a'])])).toEqual([])
  })
})

describe('computeReady (deps satisfied only when parents are MERGED)', () => {
  it('treats a dependency-free blocked task as ready', () => {
    expect(computeReady([t('a')])).toEqual(['a'])
  })

  it('does not ready a task whose parent is merely completed', () => {
    const tasks = [t('a', [], 'completed'), t('b', ['a'], 'blocked')]
    expect(computeReady(tasks)).toEqual([])
  })

  it('readies a task once its only parent is merged', () => {
    const tasks = [t('a', [], 'merged'), t('b', ['a'], 'blocked')]
    expect(computeReady(tasks)).toEqual(['b'])
  })

  it('diamond: D is ready only after BOTH B and C are merged', () => {
    const base = (bStatus: TaskStatus, cStatus: TaskStatus): GraphTask[] => [
      t('a', [], 'merged'),
      t('b', ['a'], bStatus),
      t('c', ['a'], cStatus),
      t('d', ['b', 'c'], 'blocked')
    ]
    expect(computeReady(base('merged', 'completed'))).not.toContain('d')
    expect(computeReady(base('completed', 'merged'))).not.toContain('d')
    expect(computeReady(base('merged', 'merged'))).toContain('d')
  })

  it('ignores non-blocked tasks', () => {
    expect(computeReady([t('a', [], 'running')])).toEqual([])
  })
})

describe('descendants (rejection cascade set)', () => {
  it('collects all transitive children in a diamond', () => {
    const tasks = [t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b', 'c'])]
    expect(descendants(tasks, 'a').sort()).toEqual(['b', 'c', 'd'])
  })

  it('a leaf has no descendants', () => {
    const tasks = [t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b', 'c'])]
    expect(descendants(tasks, 'd')).toEqual([])
  })

  it('returns only the affected subtree, not siblings', () => {
    // a -> b -> d ; a -> c (independent branch)
    const tasks = [t('a'), t('b', ['a']), t('c', ['a']), t('d', ['b'])]
    expect(descendants(tasks, 'b')).toEqual(['d'])
  })
})

describe('fifoReadyOrder', () => {
  it('orders ready tasks by createdAt ascending', () => {
    const tasks = [t('a', [], 'ready', 30), t('b', [], 'ready', 10), t('c', [], 'ready', 20)]
    expect(fifoReadyOrder(tasks)).toEqual(['b', 'c', 'a'])
  })

  it('breaks createdAt ties by input (insertion) order — stable sort', () => {
    const tasks = [t('x', [], 'ready', 5), t('y', [], 'ready', 5), t('z', [], 'ready', 5)]
    expect(fifoReadyOrder(tasks)).toEqual(['x', 'y', 'z'])
  })

  it('only includes ready tasks', () => {
    const tasks = [t('a', [], 'ready', 1), t('b', [], 'running', 0), t('c', [], 'blocked', 0)]
    expect(fifoReadyOrder(tasks)).toEqual(['a'])
  })
})
