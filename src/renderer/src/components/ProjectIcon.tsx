import { useRef, useState, type ReactNode } from 'react'
import type { Project } from '../../../shared/types'
import { colorFor, initials, PROJECT_COLORS } from '../../../shared/util'
import { svc } from '../api'
import { Overlay, useUi } from '../ui'

const g = (d: ReactNode) => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>

/** Built-in project glyphs, drawn white on the project color. */
export const PRESETS: Record<string, ReactNode> = {
  code: g(<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />),
  web: g(<><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></>),
  mobile: g(<><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12h2" /></>),
  server: g(<><rect x="2" y="2.5" width="12" height="4.5" rx="1" /><rect x="2" y="9" width="12" height="4.5" rx="1" /><path d="M4.5 4.75h.01M4.5 11.25h.01" /></>),
  database: g(<><ellipse cx="8" cy="3.5" rx="5" ry="1.8" /><path d="M3 3.5v9c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-9M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" /></>),
  terminal: g(<><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" /><path d="m4.5 6 2 2-2 2M8.5 10.5h3" /></>),
  rocket: g(<><path d="M9.5 2.5c2.5-.8 4-.5 4-.5s.3 1.5-.5 4L8.5 10.5 5.5 7.5z" /><path d="M5.5 7.5 3 7l2-2.5h3M8.5 10.5 9 13l2.5-2v-3M4.5 11.5l-2 2" /></>),
  bolt: g(<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />),
  cube: g(<><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" /><path d="M2 5l6 3.5L14 5M8 8.5v6" /></>),
  leaf: g(<><path d="M13.5 2.5C6 2.5 2.5 6 2.5 11c0 1 .3 2 .5 2.5 5.5 0 10.5-3 10.5-11z" /><path d="M3 13.5c2-3.5 4.5-6 8-8" /></>),
  book: g(<><path d="M2.5 3c2-.8 3.8-.6 5.5.8 1.7-1.4 3.5-1.6 5.5-.8v10c-2-.8-3.8-.6-5.5.8-1.7-1.4-3.5-1.6-5.5-.8z" /><path d="M8 3.8v10" /></>),
  flask: g(<><path d="M6 1.5h4M6.5 1.5v4.5L2.8 12.3c-.5.9.1 2.2 1.2 2.2h8c1.1 0 1.7-1.3 1.2-2.2L9.5 6V1.5" /><path d="M4.5 10h7" /></>),
  game: g(<><path d="M4.5 4.5h7c2 0 3 2 3 4.5 0 1.8-.6 2.5-1.5 2.5-1.2 0-1.8-1.5-3-1.5h-4c-1.2 0-1.8 1.5-3 1.5-.9 0-1.5-.7-1.5-2.5 0-2.5 1-4.5 3-4.5z" /><path d="M5 6.8v2M4 7.8h2M10.5 7.3h.01M11.8 8.5h.01" /></>),
  chart: g(<path d="M2.5 2.5v11h11M5.5 10.5V8M8.5 10.5V5.5M11.5 10.5V7.5" />),
  heart: g(<path d="M8 13.5S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 7.5-6 7.5z" />),
  star: g(<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />),
}

const isImage = (icon: string | null) => !!icon && icon.startsWith('data:image/')
const preset = (icon: string | null) => (icon?.startsWith('preset:') ? PRESETS[icon.slice(7)] : undefined)

/** Background of a project tile: its color, or the uploaded picture. */
export const tileStyle = (p: Pick<Project, 'color' | 'icon'>): React.CSSProperties =>
  isImage(p.icon) ? { backgroundImage: `url("${p.icon}")`, backgroundColor: 'transparent' } : { background: p.color }

/** What sits on the tile: a glyph, the initials, or nothing over a picture. */
export function TileContent({ p }: { p: Pick<Project, 'short' | 'icon'> }) {
  if (isImage(p.icon)) return null
  return <>{preset(p.icon) ?? p.short}</>
}

/** Square-crop and shrink a picked image so it stays small in the database. */
function toIconDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const bad = () => reject(new Error('That file is not an image Bridge can read.'))
    const reader = new FileReader() // data: URL, since the page's CSP allows no blob: images
    reader.onerror = bad
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = 128
        const c = document.createElement('canvas')
        c.width = c.height = size
        const s = Math.min(img.width, img.height)
        c.getContext('2d')!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = bad
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export function ProjectIconModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const { fail } = useUi()
  const [color, setColor] = useState(project.color)
  const [short, setShort] = useState(project.short)
  const [icon, setIcon] = useState(project.icon)
  const file = useRef<HTMLInputElement>(null)
  const draft = { color, short: short.trim() || initials(project.name), icon }

  const save = async () => {
    try {
      await svc.updateProject(project.id, draft)
      onSaved()
      onClose()
    } catch (e) { fail(e) }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="modal pimodal" role="dialog" aria-label="Project icon">
        <h2>Project icon</h2>
        <div className="pihead">
          <span className="pj big" style={tileStyle(draft)}><TileContent p={draft} /></span>
          <div><div className="k">{project.name}</div><div className="h mono">{project.path}</div></div>
        </div>
        <label>Icon
          <div className="pigrid">
            <button type="button" className="pjopt" aria-pressed={!icon} title="Letters" data-icon="letters" onClick={() => setIcon(null)}>Aa</button>
            {Object.entries(PRESETS).map(([k, svg]) => (
              <button type="button" key={k} className="pjopt" aria-pressed={icon === `preset:${k}`} title={k} data-icon={k} onClick={() => setIcon(`preset:${k}`)}>{svg}</button>
            ))}
          </div>
        </label>
        {!isImage(icon) && (
          <label>Color
            <div className="swatches">{PROJECT_COLORS.map((c) => <button type="button" key={c} className="sw" style={{ background: c }} aria-pressed={color === c} aria-label={c} onClick={() => setColor(c)} />)}</div>
          </label>
        )}
        {!icon && <label>Letters<input className="inp" id="piShort" maxLength={2} value={short} onChange={(e) => setShort(e.target.value.toUpperCase())} /></label>}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" hidden id="piFile"
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) try { setIcon(await toIconDataUrl(f)) } catch (err) { fail(err) } }} />
        <div className="mact">
          <button type="button" className="btn" id="piUpload" onClick={() => file.current?.click()}>Upload image…</button>
          <button type="button" className="btn" id="piReset" onClick={() => { setIcon(null); setColor(colorFor(project.name)); setShort(initials(project.name)) }}>Reset</button>
          <span className="sp" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn pri" id="piSave" onClick={save}>Save</button>
        </div>
      </div>
    </Overlay>
  )
}
