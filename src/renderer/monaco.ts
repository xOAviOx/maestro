import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'
import type { Environment } from 'monaco-editor'

/**
 * Configure Monaco to run fully offline from the bundled package — no CDN fetch
 * (which would violate the app CSP and the "no network calls" rule).
 *
 * We wire only the base editor worker (which hosts the diff computation). Syntax
 * highlighting runs on the main thread, so it works without the per-language
 * workers; we skip those to keep the bundle lean (no IntelliSense needed for a
 * read-only diff view).
 */
declare global {
  interface Window {
    MonacoEnvironment?: Environment
  }
}

window.MonacoEnvironment = {
  getWorker: (_workerId: string, _label: string): Worker => new editorWorker()
}

loader.config({ monaco })

/** Map a file path to a Monaco language id for syntax highlighting. */
export function languageForPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  const dot = lower.lastIndexOf('.')
  const ext = dot >= 0 ? lower.slice(dot + 1) : ''
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript'
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'scss':
      return 'scss'
    case 'less':
      return 'less'
    case 'html':
    case 'htm':
      return 'html'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'py':
      return 'python'
    case 'rs':
      return 'rust'
    case 'go':
      return 'go'
    case 'java':
      return 'java'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cc':
    case 'hpp':
      return 'cpp'
    case 'cs':
      return 'csharp'
    case 'rb':
      return 'ruby'
    case 'php':
      return 'php'
    case 'sh':
    case 'bash':
      return 'shell'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'xml':
      return 'xml'
    case 'sql':
      return 'sql'
    case 'toml':
      return 'ini'
    default:
      return 'plaintext'
  }
}
