import { DEFAULT_FAULT_SCHEDULE, startAlayaCareMockServer } from './app'

const port = Number(new URL(process.env.ALAYACARE_BASE_URL ?? 'http://localhost:4010').port || '4010')

void startAlayaCareMockServer({ port, faults: DEFAULT_FAULT_SCHEDULE }).then((running) => {
  console.log(
    `AlayaCare mock listening on ${running.baseUrl} (429 every ${DEFAULT_FAULT_SCHEDULE.rateLimitEvery} requests, 503 every ${DEFAULT_FAULT_SCHEDULE.unavailableEvery})`,
  )
})
