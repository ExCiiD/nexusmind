import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import privacyFr from '@/legal/privacy.fr.md?raw'
import privacyEn from '@/legal/privacy.en.md?raw'
import termsFr from '@/legal/terms.fr.md?raw'
import termsEn from '@/legal/terms.en.md?raw'

const DOCS = {
  privacy: { fr: privacyFr, en: privacyEn },
  terms: { fr: termsFr, en: termsEn },
}

/** Minimal Markdown rendering: headings, bullet lists, **bold**, _italics_, `code`. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**')) return <strong key={i} className="text-hextech-text-bright">{p.slice(2, -2)}</strong>
    if (p.startsWith('_') && p.endsWith('_') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>
    if (p.startsWith('`')) return <code key={i} className="rounded bg-hextech-elevated px-1">{p.slice(1, -1)}</code>
    return p
  })
}

function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\r?\n\r?\n/)
  return (
    <div className="space-y-3 text-sm leading-relaxed text-hextech-text">
      {blocks.map((block, i) => {
        const lines = block.split(/\r?\n/)
        if (lines[0].startsWith('# ')) return null // title shown in the dialog header
        if (lines[0].startsWith('## ')) {
          return (
            <div key={i} className="space-y-1">
              <h3 className="font-display text-base text-hextech-gold">{lines[0].slice(3)}</h3>
              {lines.slice(1).length > 0 && <Markdown source={lines.slice(1).join('\n')} />}
            </div>
          )
        }
        if (lines.every((l) => l.startsWith('- '))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{renderInline(l.slice(2))}</li>)}</ul>
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{renderInline(l)}{j < lines.length - 1 && <br />}</span>)}</p>
      })}
    </div>
  )
}

export function LegalDialog({ doc, onClose }: { doc: 'privacy' | 'terms' | null; onClose: () => void }) {
  const { i18n } = useTranslation()
  if (!doc) return null
  const source = DOCS[doc][i18n.language?.startsWith('fr') ? 'fr' : 'en']
  const title = source.split(/\r?\n/)[0].replace(/^#\s*/, '')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Markdown source={source} />
      </DialogContent>
    </Dialog>
  )
}
