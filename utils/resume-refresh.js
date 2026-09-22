export const RESUME_REFRESH_AFTER = 5 * 60 * 1000
export const FULL_REFRESH_AFTER = 30 * 60 * 1000

export function getResumeRefreshState(lastHandledSeq = 0) {
  let app = null
  try {
    app = getApp()
  } catch (e) {
    return { seq: 0, level: 0, elapsed: 0, shouldRefresh: false }
  }

  const state = app?.globalData || {}
  const seq = Number(state.resumeSeq || 0)
  const level = Number(state.resumeRefreshLevel || 0)
  const elapsed = Number(state.resumeElapsed || 0)
  const isNewResume = seq > 0 && seq !== Number(lastHandledSeq || 0)

  return {
    seq,
    level,
    elapsed,
    shouldRefresh: isNewResume && !state.resumeWasColdStart && level >= 1
  }
}
