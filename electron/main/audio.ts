import type { AudioDevice } from 'native-audio-node'

export interface AudioDeviceInfo {
  id: string
  name: string
  manufacturer: string | null
  isDefault: boolean
  sampleRate: number
  channelCount: number
}

export interface AudioDevicesSummary {
  inputs: AudioDeviceInfo[]
  outputs: AudioDeviceInfo[]
  defaultInputId: string | null
  defaultOutputId: string | null
  defaultInputName: string | null
  defaultOutputName: string | null
}

/**
 * Safely calls native-audio-node's `listAudioDevices()`. Returns an empty array
 * if the native module failed to load (e.g. on an unsupported OS) instead of
 * throwing, so callers can always render a best-effort UI.
 */
async function listAudioDevicesSafe(): Promise<AudioDevice[]> {
  try {
    const nativeAudio = await import('native-audio-node')
    return nativeAudio.listAudioDevices()
  } catch (err) {
    console.warn('[audio] listAudioDevices failed:', err)
    return []
  }
}

function toInfo(d: AudioDevice): AudioDeviceInfo {
  return {
    id: d.id,
    name: d.name,
    manufacturer: d.manufacturer ?? null,
    isDefault: d.isDefault,
    sampleRate: d.sampleRate,
    channelCount: d.channelCount,
  }
}

/**
 * Returns a serialisable summary of all audio devices + the current Windows
 * default input / output. Intended for the Settings UI via IPC.
 */
export async function getAudioDevicesSummary(): Promise<AudioDevicesSummary> {
  const devices = await listAudioDevicesSafe()
  const inputs = devices.filter(d => d.isInput).map(toInfo)
  const outputs = devices.filter(d => d.isOutput).map(toInfo)
  const defaultInput = inputs.find(d => d.isDefault) ?? null
  const defaultOutput = outputs.find(d => d.isDefault) ?? null
  return {
    inputs,
    outputs,
    defaultInputId: defaultInput?.id ?? null,
    defaultOutputId: defaultOutput?.id ?? null,
    defaultInputName: defaultInput?.name ?? null,
    defaultOutputName: defaultOutput?.name ?? null,
  }
}

/**
 * Resolves the current Windows default microphone *name* (suitable for
 * ffmpeg's dshow input). Returns null if no default input can be found.
 */
export async function resolveDefaultMicName(): Promise<string | null> {
  const devices = await listAudioDevicesSafe()
  return devices.find(d => d.isInput && d.isDefault)?.name ?? null
}

/**
 * Resolves a stored mic identifier (device id OR device name — for backward
 * compatibility with label-based storage) to a concrete ffmpeg-compatible
 * device name. Returns null if the device cannot be found.
 *
 * Selection rules (in order):
 *   1. Empty / null → Windows default input.
 *   2. Matches a known device `id` → use that device's name.
 *   3. Matches a known device `name` → use that name.
 *   4. Legacy label (e.g. "Default - 5 - LC27G7xT (AMD...)") → fall back to
 *      sanitised label so dshow has something to try (best-effort).
 */
export async function resolveMicDeviceName(storedValue: string | null | undefined): Promise<string | null> {
  const devices = await listAudioDevicesSafe()
  const inputs = devices.filter(d => d.isInput)

  if (!storedValue || !storedValue.trim()) {
    return inputs.find(d => d.isDefault)?.name ?? null
  }

  const trimmed = storedValue.trim()
  const byId = inputs.find(d => d.id === trimmed)
  if (byId) return byId.name
  const byName = inputs.find(d => d.name === trimmed)
  if (byName) return byName.name

  // Legacy: user stored a Chromium MediaDeviceInfo.label like
  // "Default - Microphone (USB Audio)" or "Microphone (046d:0aaa)".
  // Strip those prefixes/suffixes and retry, then fall back to the sanitised
  // string as a best-effort for dshow.
  const sanitized = trimmed
    .replace(/^Default\s*-\s*/i, '')
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .trim()
  const byStripped = inputs.find(d => d.name === sanitized)
  if (byStripped) return byStripped.name

  return sanitized || null
}
