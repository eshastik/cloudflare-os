/** Host-owned microphone controls. A sandbox request only opens the controls;
 * capture starts on the human's click and returns bytes only to that frame. */
export function openGatekeeperAudioRecording(target: Window, requestId: string): () => void {
  const panel = document.createElement('dialog')
  const label = document.createElement('p')
  label.textContent = 'Запись для открытого приложения. До 5 минут и 20 МБ.'
  const start = document.createElement('button')
  start.textContent = 'Включить микрофон'
  const stop = document.createElement('button')
  stop.textContent = 'Завершить и прикрепить'
  stop.disabled = true
  const cancel = document.createElement('button')
  cancel.textContent = 'Отмена'
  panel.append(label, start, stop, cancel)
  document.body.append(panel)
  panel.showModal()
  let closed = false
  let stream: MediaStream | undefined
  let recorder: MediaRecorder | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let chunks: Blob[] = []
  let size = 0
  const release = () => {
    clearTimeout(timer)
    stream?.getTracks().forEach(track => track.stop())
    stream = undefined
  }
  const dispose = () => {
    if (closed) return
    closed = true
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    release()
    chunks = []
    window.removeEventListener('pagehide', dispose)
    panel.remove()
  }
  const fail = () => {
    if (closed) return
    target.postMessage({type: 'gatekeeper-audio-result', requestId, error: true}, '*')
    dispose()
  }
  cancel.onclick = fail
  panel.oncancel = event => { event.preventDefault(); fail() }
  stop.onclick = () => {
    stop.disabled = true
    if (recorder?.state === 'recording') recorder.stop()
    release()
  }
  start.onclick = async () => {
    if (closed || start.disabled) return
    start.disabled = true
    label.textContent = 'Ожидание разрешения микрофона…'
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({audio: true, video: false})
      if (closed) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired
      recorder = new MediaRecorder(stream)
      recorder.ondataavailable = event => {
        if (closed) return
        size += event.data.size
        if (size > 20_000_000) { fail(); return }
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = fail
      recorder.onstop = async () => {
        release()
        if (closed) return
        const type = recorder!.mimeType.split(';', 1)[0].toLowerCase()
        if (!size || !type.startsWith('audio/')) { fail(); return }
        const blob = new Blob(chunks, {type})
        chunks = []
        try {
          const bytes = await blob.arrayBuffer()
          if (closed) return
          target.postMessage({type: 'gatekeeper-audio-result', requestId, mediaType: type, bytes}, '*', [bytes])
          dispose()
        } catch { fail() }
      }
      recorder.start(1000)
      label.textContent = 'Идёт запись. Завершите её, чтобы прикрепить аудио.'
      stop.disabled = false
      // An overlong recording is discarded, never silently accepted as complete.
      timer = setTimeout(fail, 5 * 60_000)
    } catch { fail() }
  }
  window.addEventListener('pagehide', dispose)
  return dispose
}
