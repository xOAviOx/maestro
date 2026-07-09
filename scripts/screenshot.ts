/**
 * Deterministic screenshot capture for Maestro's features.
 *
 * Boots the standalone web build of the real renderer (vite.screenshots.config.ts)
 * against a mock `window.maestro`, launches headless Chromium, and for each scene
 * calls `window.__scenes[name]()` then writes docs/img/NN-name.png.
 *
 *   npm run screenshots            # capture every scene
 *   npm run screenshots -- diff    # capture only scenes whose name includes "diff"
 *
 * No Electron, no native modules, no live agents — see screenshots/README notes.
 */
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import { createServer, type ViteDevServer } from 'vite'
import { chromium, type Browser, type Page } from 'playwright'

const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'docs/img')
const PORT = 5199
const VIEWPORT = { width: 1600, height: 1000 }

/**
 * One capture per feature. `wait` selector is something that must exist before
 * we shoot (defaults to #root). `interact` runs Playwright actions (typing,
 * selecting) after the scene loads — used for dialogs whose realistic state
 * lives in React-controlled inputs that need real DOM events.
 */
interface Shot {
  scene: string
  file: string
  waitFor?: string
  interact?: (page: Page) => Promise<void>
}

const SHOTS: Shot[] = [
  { scene: 'sidebar', file: '01-sidebar.png' },
  { scene: 'agentChat', file: '02-agent-chat.png' },
  {
    scene: 'fanoutDialog',
    file: '03-fanout.png',
    waitFor: 'text=Fan out a task',
    interact: async (page) => {
      await page.getByPlaceholder('e.g. add login page').fill('Empty-state illustration')
      await page
        .getByPlaceholder('Describe the task sent to every variant…')
        .fill('Design an empty-state illustration for the todo list — friendly, on-brand, with a “Create your first todo” CTA.')
      // Add a third variant and make them distinct (Claude, Claude, Codex).
      await page.getByRole('button', { name: 'Add variant' }).click()
      const models = page.getByPlaceholder('model (optional)')
      await models.nth(0).fill('opus')
      await models.nth(1).fill('sonnet')
    }
  },
  { scene: 'comparison', file: '04-comparison.png', waitFor: 'text=Open full diff' },
  { scene: 'diff', file: '05-diff.png', waitFor: '.monaco-editor' },
  { scene: 'reviewBar', file: '06-review-merge.png', waitFor: 'text=Create PR' },
  { scene: 'queue', file: '07-task-queue.png' },
  { scene: 'permission', file: '08-permission.png', waitFor: 'text=Approve' },
  { scene: 'terminal', file: '09-terminal.png', waitFor: '.xterm' },
  { scene: 'workflowGraph', file: '10-workflow-dag.png', waitFor: '.react-flow' },
  { scene: 'workflowInspector', file: '11-workflow-inspector.png', waitFor: '.react-flow' },
  {
    scene: 'workflowBuilder',
    file: '12-workflow-builder.png',
    waitFor: 'text=New workflow',
    interact: async (page) => {
      // Seed the canvas from the diamond template so the builder shows a DAG.
      await page.getByRole('combobox').last().selectOption({ label: 'Parallel refactor (diamond)' })
      await page.waitForTimeout(700)
    }
  },
  { scene: 'dashboard', file: '13-cost-dashboard.png', waitFor: 'text=Session cost' },
  { scene: 'settings', file: '14-settings.png' }
]

async function main(): Promise<void> {
  const filter = process.argv.slice(2)
  const shots = filter.length
    ? SHOTS.filter((s) => filter.some((f) => s.scene.toLowerCase().includes(f.toLowerCase())))
    : SHOTS

  mkdirSync(OUT_DIR, { recursive: true })

  let server: ViteDevServer | undefined
  let browser: Browser | undefined
  try {
    server = await createServer({
      configFile: resolve(ROOT, 'vite.screenshots.config.ts'),
      server: { port: PORT }
    })
    await server.listen()
    const url = `http://localhost:${PORT}/`
    console.log(`▶ screenshot server on ${url}`)

    browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: VIEWPORT,
      deviceScaleFactor: 2, // crisp on HiDPI / when downscaled in the README
      colorScheme: 'dark'
    })
    page.on('pageerror', (e) => console.error('  page error:', e.message))

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, {
      timeout: 30_000
    })

    for (const shot of shots) {
      await page.evaluate(async (scene) => {
        const scenes = (window as unknown as { __scenes: Record<string, () => Promise<void>> }).__scenes
        const fn = scenes[scene]
        if (!fn) throw new Error(`no scene: ${scene}`)
        await fn()
      }, shot.scene)

      if (shot.waitFor) {
        try {
          await page.waitForSelector(shot.waitFor, { timeout: 8000, state: 'visible' })
        } catch {
          console.warn(`  ⚠ ${shot.scene}: selector "${shot.waitFor}" not found, shooting anyway`)
        }
      }

      if (shot.interact) {
        try {
          await shot.interact(page)
        } catch (e) {
          console.warn(`  ⚠ ${shot.scene}: interact step failed:`, (e as Error).message)
        }
      }

      // Small settle for animations/layout.
      await page.waitForTimeout(400)

      const path = resolve(OUT_DIR, shot.file)
      await page.screenshot({ path })
      console.log(`  ✓ ${shot.file}`)
    }
  } finally {
    await browser?.close()
    await server?.close()
  }
  console.log('done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
