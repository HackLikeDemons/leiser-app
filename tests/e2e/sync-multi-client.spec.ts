import { test } from '@playwright/test'
import {
  addContextOption,
  ageTodoUpdatedAt,
  bootClient,
  configureSyncIdentity,
  createTodoFromCapture,
  expectContextOptionVisible,
  expectInReview,
  expectTodoHidden,
  expectTodoVisible,
  syncNow,
} from './helpers/app'

const runSyncE2E = process.env.E2E_RUN_SYNC === '1'

function createSyncIdentity() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  return {
    roomId: `e2e-room-${suffix}`,
    token: `e2e-token-${suffix}`,
  }
}

test.describe('Sync multi-client', () => {
  test.skip(!runSyncE2E, 'Set E2E_RUN_SYNC=1 and provide reachable runtime sync backend.')

  test('TODO created on client A is synced to client B', async ({ browser }) => {
    const sync = createSyncIdentity()
    const text = `e2e-todo-${Date.now()}`

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await configureSyncIdentity(pageA, sync.roomId, sync.token)
      await configureSyncIdentity(pageB, sync.roomId, sync.token)

      await bootClient(pageA)
      await bootClient(pageB)

      await createTodoFromCapture(pageA, text)
      await syncNow(pageA)
      await syncNow(pageB)
      await syncNow(pageA)

      await expectTodoVisible(pageB, text)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('TODO older than 14 days is auto-returned to review and propagated', async ({ browser }) => {
    const sync = createSyncIdentity()
    const text = `e2e-stale-${Date.now()}`

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await configureSyncIdentity(pageA, sync.roomId, sync.token)
      await configureSyncIdentity(pageB, sync.roomId, sync.token)

      await bootClient(pageA)
      await bootClient(pageB)

      await createTodoFromCapture(pageA, text)
      await syncNow(pageA)
      await syncNow(pageB)

      await ageTodoUpdatedAt(pageB, text, 15)
      await pageB.reload()

      await expectTodoHidden(pageB, text)
      await expectInReview(pageB, text)

      await syncNow(pageB)
      await syncNow(pageA)
      await pageA.reload()

      await expectTodoHidden(pageA, text)
      await expectInReview(pageA, text)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('Kontextliste aus den Einstellungen wird zwischen Clients synchronisiert', async ({ browser }) => {
    const sync = createSyncIdentity()
    const label = `Weiterbildung ${Date.now()}`

    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    try {
      await configureSyncIdentity(pageA, sync.roomId, sync.token)
      await configureSyncIdentity(pageB, sync.roomId, sync.token)

      await bootClient(pageA)
      await bootClient(pageB)

      await addContextOption(pageA, label)
      await syncNow(pageA)
      await syncNow(pageB)

      await expectContextOptionVisible(pageB, label)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
