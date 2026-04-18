import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  HelpCircle,
  LayoutDashboard,
  Swords,
  Film,
  FileSearch,
  ClipboardList,
  BarChart3,
  TrendingUp,
  Settings,
  Lightbulb,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface FeatureSectionProps {
  icon: LucideIcon
  title: string
  body: string
  why: string
}

function FeatureSection({ icon: Icon, title, body, why }: FeatureSectionProps) {
  return (
    <Card className="transition-colors hover:border-hextech-gold/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hextech-elevated border border-hextech-border-dim">
            <Icon className="h-4 w-4 text-hextech-gold" />
          </div>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-hextech-text leading-relaxed">{body}</p>
        <div className="flex items-start gap-2 rounded-md bg-hextech-elevated/50 border border-hextech-border-dim p-3">
          <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0 text-hextech-gold" />
          <p className="text-xs text-hextech-text-dim leading-relaxed">{why}</p>
        </div>
      </CardContent>
    </Card>
  )
}

const FEATURE_KEYS: Array<{ key: string; icon: LucideIcon }> = [
  { key: 'dashboard', icon: LayoutDashboard },
  { key: 'session', icon: Swords },
  { key: 'record', icon: Film },
  { key: 'review', icon: FileSearch },
  { key: 'history', icon: ClipboardList },
  { key: 'stats', icon: BarChart3 },
  { key: 'analytics', icon: TrendingUp },
  { key: 'settings', icon: Settings },
]

export function HelpPage() {
  const { t } = useTranslation()
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  const scrollTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tocItems = [
    { id: 'what-is', label: t('help.whatIs.title') },
    { id: 'workflow', label: t('help.workflow.title') },
    { id: 'features', label: t('help.featuresTitle') },
    { id: 'tips', label: t('help.tips.title') },
  ]

  const workflowSteps = t('help.workflow.steps', { returnObjects: true }) as string[]
  const tipItems = t('help.tips.items', { returnObjects: true }) as string[]

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-hextech-gold-bright flex items-center gap-3">
          <HelpCircle className="h-6 w-6" />
          {t('help.title')}
        </h1>
        <p className="mt-1 text-sm text-hextech-text">{t('help.subtitle')}</p>
      </div>

      {/* Table of contents */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('help.toc')}</CardTitle>
        </CardHeader>
        <CardContent>
          <nav className="flex flex-wrap gap-2">
            {tocItems.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="flex items-center gap-1.5 rounded-md border border-hextech-border-dim bg-hextech-elevated/50 px-3 py-1.5 text-xs text-hextech-text transition-colors hover:border-hextech-gold/40 hover:text-hextech-gold-bright"
              >
                <ArrowRight className="h-3 w-3" />
                {item.label}
              </button>
            ))}
          </nav>
        </CardContent>
      </Card>

      {/* What is NexusMind */}
      <section ref={(el) => { sectionRefs.current['what-is'] = el }}>
        <Card className="border-hextech-gold/20 bg-gradient-to-br from-hextech-dark to-hextech-elevated/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-hextech-gold" />
              {t('help.whatIs.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-hextech-text leading-relaxed">{t('help.whatIs.body')}</p>
            <div className="rounded-md bg-hextech-elevated/50 border border-hextech-border-dim p-3">
              <p className="text-xs text-hextech-gold leading-relaxed italic">{t('help.whatIs.why')}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* How it works - Workflow */}
      <section ref={(el) => { sectionRefs.current['workflow'] = el }}>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('help.workflow.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-hextech-text">{t('help.workflow.body')}</p>
            <ol className="space-y-2 pl-1">
              {workflowSteps.map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-hextech-elevated border border-hextech-gold/30 text-xs font-bold text-hextech-gold">
                    {index + 1}
                  </span>
                  <span className="text-sm text-hextech-text leading-relaxed pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      {/* Feature-by-feature guide */}
      <section ref={(el) => { sectionRefs.current['features'] = el }}>
        <h2 className="font-display text-lg font-semibold text-hextech-gold-bright mb-3">
          {t('help.featuresTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {FEATURE_KEYS.map(({ key, icon }) => (
            <FeatureSection
              key={key}
              icon={icon}
              title={t(`help.features.${key}.title`)}
              body={t(`help.features.${key}.body`)}
              why={t(`help.features.${key}.why`)}
            />
          ))}
        </div>
      </section>

      {/* Tips */}
      <section ref={(el) => { sectionRefs.current['tips'] = el }}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lightbulb className="h-5 w-5 text-hextech-gold" />
              {t('help.tips.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {tipItems.map((tip, index) => (
                <li key={index} className="flex items-start gap-3 rounded-md p-2 transition-colors hover:bg-hextech-elevated/30">
                  <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-hextech-gold/60" />
                  <span className="text-sm text-hextech-text leading-relaxed">{tip}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
