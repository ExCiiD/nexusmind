import { z } from 'zod'
import { validatedHandle, localPath } from './validate'
import { isMediaPathAllowed } from '../mediaAccess'
import { transcribeFile } from '../transcription'

/** Local Whisper transcription (Phase 5, Planning rework §9) — one handler,
 *  reused by both the per-game and the meeting review flows. */
export function registerTranscriptionHandlers(): void {
  validatedHandle('transcription:run', z.tuple([localPath, z.string().min(2).max(20)]), async (_e, filePath, language) => {
    if (!(await isMediaPathAllowed(filePath))) throw new Error('FILE_NOT_ALLOWED')
    return transcribeFile(filePath, language)
  })
}
