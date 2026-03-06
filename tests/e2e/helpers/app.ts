import { expect, type Page } from '@playwright/test'

const SYNC_ID_STORAGE_KEY = 'leiser-sync-id'
const SYNC_TOKEN_STORAGE_KEY = 'leiser-sync-token'

export async function configureSyncIdentity(page: Page, roomId: string, syncToken: string) {
  await page.addInitScript(
    ({ roomIdValue, syncTokenValue, roomKey, tokenKey }) => {
      window.localStorage.setItem(roomKey, roomIdValue)
      window.localStorage.setItem(tokenKey, syncTokenValue)
    },
    {
      roomIdValue: roomId,
      syncTokenValue: syncToken,
      roomKey: SYNC_ID_STORAGE_KEY,
      tokenKey: SYNC_TOKEN_STORAGE_KEY,
    },
  )
}

export async function bootClient(page: Page) {
  await page.goto('/')
  await openDataPanel(page)
  const enableButton = page.getByRole('button', { name: 'Sync aktivieren' })
  if (await enableButton.isVisible()) {
    await enableButton.click()
  }
  await expect(page.getByRole('button', { name: 'Sync deaktivieren' })).toBeVisible()
}

export async function openDataPanel(page: Page) {
  await page.getByRole('button', { name: 'Daten öffnen' }).click()
  await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible()
}

export async function openTab(page: Page, tabName: 'Erfassen' | 'Sortieren' | 'Reflektieren' | 'Handeln') {
  await page.getByRole('button', { name: tabName }).click()
}

export async function syncNow(page: Page) {
  await openDataPanel(page)
  const syncButton = page.getByRole('button', { name: /Sync now/ })
  await expect(syncButton).toBeVisible()
  await syncButton.click()
  await expect(page.getByRole('button', { name: 'Sync now (Debug)' })).toBeEnabled()
}

export async function createTodoFromCapture(page: Page, text: string) {
  await openTab(page, 'Erfassen')
  const input = page.locator('textarea').first()
  await input.fill(`- ${text}`)
  await input.press('Enter')

  await openTab(page, 'Sortieren')
  const noteRow = page.locator('li.note-item', { hasText: text }).first()
  await expect(noteRow).toBeVisible()
  await noteRow.getByTitle('Als Handlung markieren').click()
}

export async function expectTodoVisible(page: Page, text: string) {
  await openTab(page, 'Handeln')
  await expect(page.locator('li.note-item', { hasText: text }).first()).toBeVisible()
}

export async function expectTodoHidden(page: Page, text: string) {
  await openTab(page, 'Handeln')
  await expect(page.locator('li.note-item', { hasText: text })).toHaveCount(0)
}

export async function expectInReview(page: Page, text: string) {
  await openTab(page, 'Sortieren')
  await expect(page.locator('li.note-item', { hasText: text }).first()).toBeVisible()
}

export async function ageTodoUpdatedAt(page: Page, text: string, daysOld: number) {
  const oldIso = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString()

  await page.evaluate(
    async ({ targetText, updatedAt }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('leiser-db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['notes', 'notes_view'], 'readwrite')
        const notesStore = tx.objectStore('notes')
        const viewStore = tx.objectStore('notes_view')
        const cursorReq = viewStore.openCursor()

        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
        tx.oncomplete = () => resolve()

        cursorReq.onerror = () => reject(cursorReq.error)
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor) {
            return
          }

          const row = cursor.value as {
            id?: string
            text?: string
            status?: string
            deletedAt?: string | null
            updatedAt?: string
          }

          if (
            row?.id &&
            row.text === targetText &&
            row.status === 'TODO' &&
            (row.deletedAt == null || row.deletedAt === '')
          ) {
            const nextView = { ...row, updatedAt }
            const updateViewReq = cursor.update(nextView)
            updateViewReq.onerror = () => reject(updateViewReq.error)

            const getNoteReq = notesStore.get(row.id)
            getNoteReq.onerror = () => reject(getNoteReq.error)
            getNoteReq.onsuccess = () => {
              const note = getNoteReq.result as { updatedAt?: string } | undefined
              if (!note) {
                return
              }
              const putNoteReq = notesStore.put({ ...note, updatedAt })
              putNoteReq.onerror = () => reject(putNoteReq.error)
            }
          }

          cursor.continue()
        }
      })

      db.close()
    },
    { targetText: text, updatedAt: oldIso },
  )
}
