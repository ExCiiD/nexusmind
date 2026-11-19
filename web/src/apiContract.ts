/**
 * #18 (FE-4 / L16): both implementations of `window.api` are checked against the contract the screens code against,
 * `AscendAPI` (src/lib/ipc.ts). Type-only: nothing here runs. It lives in the web project because that one type-checks
 * with the DOM library and follows imports, so it sees the preload, the web adapter and the contract at once
 * (`npm run typecheck` runs it). Missing web methods are allowed (`Partial`): the screens guard them, and
 * tests/unit/webApiCoverage.test.ts checks that every unguarded call the web bundle makes exists.
 */
import type { AscendAPI } from '@/lib/ipc'
import type { PreloadApi } from '../../electron/preload/index'
import type { webApi } from './api'

type Assert<T extends true> = T
type NoExtraKeys<Impl, Contract> = Exclude<keyof Impl, keyof Contract> extends never ? true : Exclude<keyof Impl, keyof Contract>

/** The desktop bridge implements every method of the contract, with compatible signatures. */
export const preloadImplementsContract = (api: PreloadApi): AscendAPI => api
/** …and exposes nothing the contract does not declare (an undeclared method is a typo or dead code). */
export type PreloadHasNoExtraKeys = Assert<NoExtraKeys<PreloadApi, AscendAPI>>

/** The web adapter implements part of the contract, each method with a compatible signature. */
export const webImplementsContract = (api: typeof webApi): Partial<AscendAPI> => api
export type WebHasNoExtraKeys = Assert<NoExtraKeys<typeof webApi, AscendAPI>>
