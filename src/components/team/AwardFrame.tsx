/**
 * The weekly award frames of the player cards: the gold MVP frame (best
 * team stats of the week) with a light band sweeping it, and the blue
 * Grinder frame (most LP gained). The frame images have the card's 1:1.75
 * shape and sit 6 % outside it on every side.
 *
 * `AwardFlame` is the animated flame on top of the MVP frame, coloured by
 * the player's MVP streak.
 */
import { useState, type CSSProperties } from 'react'
import mvpFrame from '@/assets/frames/mvp.webp'
import grinderFrame from '@/assets/frames/grinder.webp'
import flameGlow from '@/assets/frames/flame-glow.webp'
import flameCore from '@/assets/frames/flame-core.webp'
import { FLAME_PALETTES, flameIntensity, flameTier, type FlamePalette } from '@/lib/awardFlame'
import { FlameShader } from './FlameShader'
import type { AwardKind } from '@/lib/ipc'

const FRAME_URL: Record<AwardKind, string> = { mvp: mvpFrame, grinder: grinderFrame }

/** `mvpStreak`: weeks in a row the player has been MVP; lights the flame on the MVP frame. */
export function AwardFrame({ kind, mvpStreak = 0 }: { kind: AwardKind; mvpStreak?: number }) {
  const url = FRAME_URL[kind]
  return (
    <div aria-hidden className="pointer-events-none absolute inset-[-6%]">
      <img src={url} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]" />
      {kind === 'mvp' && (
        <div
          className="card-motion absolute inset-0 animate-[card-sheen_4.8s_ease-in-out_infinite] mix-blend-plus-lighter"
          style={{
            WebkitMaskImage: `url(${url})`,
            maskImage: `url(${url})`,
            WebkitMaskSize: '100% 100%',
            maskSize: '100% 100%',
            backgroundImage: 'linear-gradient(105deg, transparent 38%, rgba(255,246,214,0) 43%, rgba(255,246,214,0.95) 50%, rgba(255,246,214,0) 57%, transparent 62%)',
            backgroundSize: '320% 100%',
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      {kind === 'mvp' && <AwardFlame streak={mvpStreak} />}
    </div>
  )
}

/** A layer filled with `background` and cut to the flame's shape. */
function masked(url: string, background: string): CSSProperties {
  return {
    background,
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
  }
}

/**
 * The flame sitting on the gem at the top middle of the MVP frame, wings
 * along the top border. Its colour follows the MVP streak (1 week grey,
 * 2 white, 3 blue, 5 red, 8 purple: src/lib/awardFlame.ts). The art is a
 * WebGL shader (FlameShader: real fire motion on the flame's silhouette),
 * with the CSS-masked flame as the fallback without WebGL.
 * Drawn inside the frame layer, so it tilts with the card.
 */
export function AwardFlame({ streak }: { streak: number }) {
  const [shaderFailed, setShaderFailed] = useState(false)
  const tier = flameTier(streak)
  if (!tier) return null
  const p = FLAME_PALETTES[tier]
  const { scale, speed } = flameIntensity(tier)
  return (
    <div
      aria-hidden
      data-flame={tier}
      // Wings reach the frame corners (110 % of the card); their line, 60 % down the art, rides the frame top just above the gem (the body would hide the crest lower).
      className="pointer-events-none absolute left-1/2 top-[-40cqw] h-[71cqw] w-[110cqw]"
      style={{ transform: `translateX(-50%) scale(${scale})`, transformOrigin: '50% 60%' }}
    >
      {/* Soft halo. */}
      <div
        className="card-motion absolute inset-[-8%] animate-[flame-breathe_2.4s_ease-in-out_infinite] blur-[6px]"
        style={{ ...masked(flameGlow, p.glow), animationDuration: `${2.4 * speed}s` }}
      />
      {shaderFailed ? (
        <CssFlame palette={p} speed={speed} />
      ) : (
        <FlameShader palette={p} speed={speed} onFail={() => setShaderFailed(true)} />
      )}
    </div>
  )
}

/** The flame without WebGL: the masks filled with the tier colours, flickering, with sparks. */
function CssFlame({ palette: p, speed }: { palette: FlamePalette; speed: number }) {
  const body = `linear-gradient(to top, ${p.deep} 8%, ${p.mid} 45%, ${p.light} 85%)`
  return (
    <>
      <div className="card-motion absolute inset-0 origin-[50%_80%] animate-[flame-flicker_1.6s_ease-in-out_infinite]" style={{ animationDuration: `${1.6 * speed}s`, filter: `drop-shadow(0 0 4px ${p.glow})` }}>
        {/* Body, then a copy licking upward, then the hot core. */}
        <div className="absolute inset-0" style={masked(flameGlow, body)} />
        <div
          className="card-motion absolute inset-0 animate-[flame-lick_1.8s_ease-out_infinite] mix-blend-plus-lighter [clip-path:polygon(36%_0,64%_0,62%_70%,38%_70%)]"
          style={{ ...masked(flameGlow, body), animationDuration: `${1.8 * speed}s` }}
        />
        <div
          className="card-motion absolute inset-0 animate-[flame-core_0.9s_ease-in-out_infinite] mix-blend-plus-lighter"
          style={{ ...masked(flameCore, p.core), animationDuration: `${0.9 * speed}s` }}
        />
      </div>
      {/* Sparks rising from the flame. */}
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="card-motion absolute bottom-[45%] h-[1.4cqw] w-[1.4cqw] animate-[flame-spark_2.2s_ease-out_infinite] rounded-full opacity-0"
          style={{
            left: `${44 + i * 4}%`,
            background: p.light,
            boxShadow: `0 0 4px 1px ${p.glow}`,
            animationDelay: `${i * 0.55}s`,
            animationDuration: `${2.2 * speed}s`,
            ['--spark-x' as string]: `${(i % 2 ? 1 : -1) * (3 + i * 2)}cqw`,
          }}
        />
      ))}
    </>
  )
}
