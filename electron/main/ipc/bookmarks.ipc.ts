/**
 * Bookmarks IPC — per-recording, free-form video markers.
 *
 * Smaller surface than Mistakes (no tag schema, no game-time mapping).
 * Tied to a Recording, so they survive even when the linked Game is
 * deleted or the recording is orphaned.
 *
 * Channels:
 *   bookmark:list-by-recording → Bookmark[]
 *   bookmark:create            → Bookmark
 *   bookmark:update            → Bookmark (label / color / videoTimeMs)
 *   bookmark:delete            → void
 */

import { ipcMain } from 'electron'
import { getPrisma } from '../database'

export function registerBookmarkHandlers() {
  ipcMain.handle('bookmark:list-by-recording', async (_e, recordingId: string) => {
    const prisma = getPrisma()
    return prisma.bookmark.findMany({
      where: { recordingId },
      orderBy: { videoTimeMs: 'asc' },
    })
  })

  ipcMain.handle('bookmark:create', async (_e, args: { recordingId: string; videoTimeMs: number; label?: string; color?: string }) => {
    if (!args.recordingId) throw new Error('recordingId required')
    const prisma = getPrisma()
    return prisma.bookmark.create({
      data: {
        recordingId: args.recordingId,
        videoTimeMs: Math.max(0, Math.floor(args.videoTimeMs ?? 0)),
        label: args.label?.slice(0, 200) || null,
        color: args.color?.slice(0, 32) || null,
      },
    })
  })

  ipcMain.handle('bookmark:update', async (_e, args: { id: string; label?: string | null; color?: string | null; videoTimeMs?: number }) => {
    const prisma = getPrisma()
    const data: any = {}
    if (args.label !== undefined)       data.label = args.label?.slice(0, 200) || null
    if (args.color !== undefined)       data.color = args.color?.slice(0, 32) || null
    if (typeof args.videoTimeMs === 'number') data.videoTimeMs = Math.max(0, Math.floor(args.videoTimeMs))
    return prisma.bookmark.update({ where: { id: args.id }, data })
  })

  ipcMain.handle('bookmark:delete', async (_e, id: string) => {
    const prisma = getPrisma()
    await prisma.bookmark.delete({ where: { id } })
    return { success: true }
  })
}
