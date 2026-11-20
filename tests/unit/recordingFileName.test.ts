import { describe, it, expect } from 'vitest'
import { recordingFileName, updateReview } from '../../src/lib/teamSessionReviewsCore'

describe('the recording is kept by its file name only', () => {
  it('drops the folders of a Windows or Unix path', () => {
    expect(recordingFileName('C:\\Users\\Kaito\\AppData\\Roaming\\Ascend\\recordings\\lol_123.mp4')).toBe('lol_123.mp4')
    expect(recordingFileName('/home/kaito/rec/meet.webm')).toBe('meet.webm')
    expect(recordingFileName('lol_1.mp4')).toBe('lol_1.mp4')
    expect(recordingFileName('C:\\Rec\\')).toBeNull()
    expect(recordingFileName(null)).toBeNull()
  })
  it('updateReview sends the file name, never the local path', async () => {
    let sent: Record<string, unknown> | null = null
    const q: any = { update: (row: Record<string, unknown>) => { sent = row; return q }, eq: () => Promise.resolve({ error: null }) }
    await updateReview({ from: () => q } as never, 'r1', { recordingLocalPath: 'C:\\Users\\Kaito\\rec\\lol_9.mp4', status: 'processing' })
    expect(sent).toMatchObject({ recording_local_path: 'lol_9.mp4', status: 'processing' })
  })
})
