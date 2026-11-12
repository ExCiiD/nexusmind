/**
 * Shared error boundary that catches any render error in its children
 * and shows a recoverable error card instead of letting the exception
 * unmount the whole React tree (which manifests as a "black screen").
 *
 * Use this at every tab / page entry point — pages should never be able
 * to crash the entire renderer just because one panel has a bug.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Short label shown in the error card heading. */
  label: string
}

interface State {
  error: Error | null
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to devtools console with the panel label so it's obvious
    // which boundary fired. The componentStack tells us exactly which
    // descendant blew up.
    console.error(`[PanelErrorBoundary:${this.props.label}]`, error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <Card className="p-4 border-red-500/50 bg-red-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-red-300">{this.props.label} crashed</h4>
              <p className="text-xs text-hextech-text-dim mt-1 break-words font-mono">
                {this.state.error.message}
              </p>
              <p className="text-[10px] text-hextech-text-dim/70 mt-1 italic">
                Open DevTools (Ctrl+Shift+I) for the full stack trace.
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={this.reset}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Try again
              </Button>
            </div>
          </div>
        </Card>
      )
    }
    return this.props.children
  }
}
