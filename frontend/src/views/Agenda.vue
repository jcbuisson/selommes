<script setup>
import { ref, computed, nextTick } from 'vue'
import { useObservable } from '@vueuse/rxjs'
import { mdiPlus } from '@mdi/js'
import { useLocalStorage } from '@vueuse/core'

import RangeCalendar from '/src/components/RangeCalendar.vue'

import useRange from '/src/use/useRange';
import useUser from '/src/use/useUser';

import useExpressXClient from '/src/use/useExpressXClient.ts';

const { app } = useExpressXClient()
const { getObservable: ranges$, create: createRange, update: updateRange, remove: removeRange } = useRange(app);
const { getObservable: users$ } = useUser(app);

const ranges = useObservable(ranges$({}))

const currentUserUid = useLocalStorage('selommes_user_uid');
const usersUid = useObservable(users$({ uid: currentUserUid?.value }));

const currentUserX = computed(() => {
   if (!currentUserUid.value) return
   if (!usersUid.value?.length) return
   return usersUid.value[0]
})

const showModal = ref(false)
const pendingRangeDate = ref(null)
const rangeConfirmationRef = ref(null)
const labelInput = ref('')
const startDateInput = ref('')
const endDateInput = ref('')
const rangeFormError = ref('')
const rangeDialogMode = ref('create')
const editingRangeUid = ref(null)
const selectedRangeUid = ref(null)
const calendarRef = ref(null)

function formatDateInput(date) {
   const year = date.getFullYear()
   const month = String(date.getMonth() + 1).padStart(2, '0')
   const day = String(date.getDate()).padStart(2, '0')
   return `${year}-${month}-${day}`
}

function serializeDate(value) {
   const date = value instanceof Date ? value : new Date(value)
   if (Number.isNaN(date.getTime())) throw new Error('Date de plage invalide')
   return date.toISOString()
}

function parseDateInput(value) {
   const [year, month, day] = value.split('-').map(Number)
   const date = new Date(year, month - 1, day)
   if (!year || !month || !day || Number.isNaN(date.getTime())) {
      throw new Error('Date de plage invalide')
   }
   return date
}

function formatDisplayDate(value) {
   return parseDateInput(value).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric',
   })
}

function resetRangeDialog() {
   showModal.value = false
   rangeDialogMode.value = 'create'
   editingRangeUid.value = null
   rangeFormError.value = ''
}

async function createCurrentUserRange(start, end) {
   const user = currentUserX.value
   if (!user) throw new Error('Votre profil est en cours de chargement. Réessayez dans quelques instants.')
   return createRange({
      label: labelInput.value.trim() || user.name,
      color: user.color,
      start: serializeDate(start),
      end: serializeDate(end),
      user_uid: user.uid,
   })
}

async function updateRangeDates(uid, start, end) {
   const range = ranges.value?.find(r => r.uid === uid)
   if (!range) throw new Error('Plage introuvable')

   return updateRange(uid, {
      user_uid: range.user_uid,
      label: labelInput.value.trim(),
      color: range.color,
      start: serializeDate(start),
      end: serializeDate(end),
   })
}

async function onNewRange({ start, end }) {
   rangeFormError.value = ''
   try {
      await createCurrentUserRange(start, end)
   } catch (error) {
      rangeFormError.value = error.message || 'Impossible de créer la plage'
   } finally {
      calendarRef.value?.clearSelection()
   }
}

async function onDateSelected(date) {
   pendingRangeDate.value = date
   await nextTick()
   rangeConfirmationRef.value?.showModal()
}

function cancelRangeConfirmation() {
   rangeConfirmationRef.value?.close()
   pendingRangeDate.value = null
}

function confirmNewRange() {
   const date = pendingRangeDate.value
   cancelRangeConfirmation()
   if (date) openCreateDialog(date)
}

function openCreateDialog(date = new Date()) {
   const defaultDate = formatDateInput(date)
   selectedRangeUid.value = null
   calendarRef.value?.clearSelection()
   labelInput.value = currentUserX.value?.name ?? ''
   startDateInput.value = defaultDate
   endDateInput.value = defaultDate
   rangeDialogMode.value = 'create'
   editingRangeUid.value = null
   rangeFormError.value = ''
   showModal.value = true
}

async function confirmCreate() {
   rangeFormError.value = ''
   try {
      const label = labelInput.value.trim()
      if (!label) {
         rangeFormError.value = 'Le libelle est obligatoire'
         return
      }
      const start = parseDateInput(startDateInput.value)
      const end = parseDateInput(endDateInput.value)
      if (end.getTime() < start.getTime()) {
         rangeFormError.value = 'La date de fin doit etre apres la date de debut'
         return
      }

      if (rangeDialogMode.value === 'edit' && editingRangeUid.value) {
         const uid = editingRangeUid.value
         await updateRangeDates(uid, start, end)
      } else {
         await createCurrentUserRange(start, end)
      }
      resetRangeDialog()
   } catch (error) {
      rangeFormError.value = error.message || 'Impossible de creer la plage'
   }
}

function cancelCreate() {
   resetRangeDialog()
   calendarRef.value?.clearSelection()
}

function openEditDialog(range) {
   rangeDialogMode.value = 'edit'
   editingRangeUid.value = range.uid
   labelInput.value = range.label
   startDateInput.value = formatDateInput(new Date(range.start))
   endDateInput.value = formatDateInput(new Date(range.end))
   rangeFormError.value = ''
   showModal.value = true
}

function openViewDialog(range) {
   rangeDialogMode.value = 'view'
   editingRangeUid.value = null
   labelInput.value = range.label
   startDateInput.value = formatDateInput(new Date(range.start))
   endDateInput.value = formatDateInput(new Date(range.end))
   rangeFormError.value = ''
   showModal.value = true
}

async function deleteEditingRange() {
   if (rangeDialogMode.value !== 'edit' || !editingRangeUid.value) return
   const uid = editingRangeUid.value
   resetRangeDialog()
   await removeRange(uid)
   selectedRangeUid.value = null
   calendarRef.value?.clearSelection()
}

function onSelectRange(uid) {
   if (!uid) {
      selectedRangeUid.value = null
      if (editingRangeUid.value) resetRangeDialog()
      return
   }
   const range = ranges.value?.find(r => r.uid === uid)
   if (range?.user_uid === currentUserUid?.value) {
      selectedRangeUid.value = uid
      openEditDialog(range)
   } else if (range) {
      selectedRangeUid.value = null
      openViewDialog(range)
      calendarRef.value?.clearSelection()
   } else {
      console.log('range clicked but belongs to another user:', uid)
      calendarRef.value?.clearSelection()
   }
}

async function onUpdateRange({ uid, start, end }) {
   console.log('update!')
   await updateRangeDates(uid, start, end)
   // calendarRef.value?.clearSelection()
}

</script>

<template>
   <div class="app-wrapper">
      <header class="topbar">
         <div class="topbar-heading">
            <img class="topbar-icon" src="/selommes-icon.svg" alt="" />
            <span class="topbar-title">Selommes</span>
         </div>
         <button class="topbar-btn" title="Nouvelle plage" @click="openCreateDialog()">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
               <path :d="mdiPlus" fill="currentColor" />
            </svg>
         </button>
      </header>

      <RangeCalendar
         ref="calendarRef"
         :ranges="ranges"
         :current-user-uid="currentUserUid"
         @new-range="onNewRange"
         @date-selected="onDateSelected"
         @update="onUpdateRange"
         @range-selected="onSelectRange"
      />
      <p v-if="rangeFormError && !showModal" class="modal-error" role="alert">{{ rangeFormError }}</p>

      <dialog
         v-if="pendingRangeDate"
         ref="rangeConfirmationRef"
         class="modal range-confirmation"
         aria-labelledby="range-confirmation-question"
         @cancel.prevent="cancelRangeConfirmation"
      >
         <p id="range-confirmation-question" class="modal-label">Voulez-vous créer une nouvelle plage de dates ?</p>
         <div class="modal-actions">
            <button class="modal-btn cancel" autofocus @click="cancelRangeConfirmation">Non</button>
            <button class="modal-btn confirm" @click="confirmNewRange">Oui</button>
         </div>
      </dialog>

      <div v-if="showModal" class="modal-backdrop">
         <div class="modal">
            <template v-if="rangeDialogMode === 'view'">
               <p class="modal-label">{{ labelInput }}</p>
               <div class="modal-field">
                  <span>Début</span>
                  <time :datetime="startDateInput">{{ formatDisplayDate(startDateInput) }}</time>
               </div>
               <div class="modal-field">
                  <span>Fin</span>
                  <time :datetime="endDateInput">{{ formatDisplayDate(endDateInput) }}</time>
               </div>
            </template>
            <template v-else>
               <label class="modal-field">
                  <span>Libelle</span>
                  <input
                     v-model="labelInput"
                     class="modal-input"
                     type="text"
                     autocomplete="off"
                     autofocus
                     @keydown.enter="confirmCreate"
                     @keydown.esc="cancelCreate"
                  />
               </label>
               <label class="modal-field">
                  <span>Debut</span>
                  <input
                     v-model="startDateInput"
                     class="modal-input"
                     type="date"
                     @keydown.enter="confirmCreate"
                     @keydown.esc="cancelCreate"
                  />
               </label>
               <label class="modal-field">
                  <span>Fin</span>
                  <input
                     v-model="endDateInput"
                     class="modal-input"
                     type="date"
                     @keydown.enter="confirmCreate"
                     @keydown.esc="cancelCreate"
                  />
               </label>
            </template>
            <p v-if="rangeFormError" class="modal-error">{{ rangeFormError }}</p>
            <div class="modal-actions">
               <button v-if="rangeDialogMode === 'edit'" class="modal-btn danger" @click="deleteEditingRange">Supprimer</button>
               <button class="modal-btn cancel" @click="cancelCreate">{{ rangeDialogMode === 'view' ? 'Fermer' : 'Annuler' }}</button>
               <button v-if="rangeDialogMode !== 'view'" class="modal-btn confirm" :disabled="!labelInput.trim() || !startDateInput || !endDateInput" @click="confirmCreate">
                  {{ rangeDialogMode === 'edit' ? 'Enregistrer' : 'Créer' }}
               </button>
            </div>
         </div>
      </div>
   </div>
</template>

<style scoped>
.app-wrapper {
   width: 100%;
   max-width: 900px;
   margin: 0 auto;
   padding: 1.5rem 1rem;
   box-sizing: border-box;
}

.topbar {
   display: flex;
   align-items: center;
   height: 48px;
   padding: 0 1rem;
   margin-bottom: 0;
   background: #1e1e2e;
   border: 1px solid #313244;
   border-bottom: none;
   border-radius: 12px 12px 0 0;
   gap: 1rem;
}

.topbar-heading {
   display: flex;
   align-items: center;
   gap: 0.6rem;
   flex: 1;
}

.topbar-icon {
   width: 30px;
   height: 30px;
   border-radius: 7px;
}

.topbar-title {
   font-size: 1.05rem;
   font-weight: 600;
   color: #cdd6f4;
}

.topbar-btn {
   display: flex;
   align-items: center;
   justify-content: center;
   width: 34px;
   height: 34px;
   padding: 0;
   border-radius: 8px;
   border: 1px solid #45475a;
   background: #313244;
   color: #cdd6f4;
   cursor: pointer;
   transition: background 0.15s, border-color 0.15s;
}

.topbar-btn:hover {
   background: #45475a;
   border-color: #89b4fa;
}

.topbar-btn svg {
   width: 20px;
   height: 20px;
}

.modal-backdrop {
   position: fixed;
   inset: 0;
   background: rgba(0, 0, 0, 0.5);
   display: flex;
   align-items: center;
   justify-content: center;
   padding: 1rem;
   z-index: 100;
   overflow: auto;
   box-sizing: border-box;
}

.modal {
   background: #1e1e2e;
   border: 1px solid #313244;
   border-radius: 12px;
   padding: 1.5rem;
   min-width: 280px;
   max-width: min(100%, 420px);
   max-height: 100%;
   box-sizing: border-box;
   overflow: auto;
   display: flex;
   flex-direction: column;
   gap: 1rem;
}

.modal-field {
   display: flex;
   flex-direction: column;
   gap: 0.35rem;
   color: #bac2de;
   font-size: 0.85rem;
   font-weight: 600;
}

.range-confirmation::backdrop {
   background: rgba(0, 0, 0, 0.5);
}

.modal-label {
   margin: 0;
   color: #cdd6f4;
   font-size: 1.05rem;
   line-height: 1.4;
}

.modal-input {
   background: #313244;
   border: 1px solid #45475a;
   border-radius: 8px;
   padding: 0.5rem 0.75rem;
   color: #cdd6f4;
   font-size: 0.95rem;
   outline: none;
   transition: border-color 0.15s;
}

.modal-input:focus {
   border-color: #89b4fa;
}

.modal-input[type="date"] {
   color-scheme: dark;
}

.modal-input[type="date"]::-webkit-calendar-picker-indicator {
   display: none;
}

.modal-error {
   margin: 0;
   color: #f38ba8;
   font-size: 0.85rem;
}

.modal-actions {
   display: flex;
   justify-content: flex-end;
   gap: 0.5rem;
}

.modal-actions .danger {
   margin-right: auto;
}

.modal-btn {
   padding: 0.4rem 1rem;
   border-radius: 8px;
   border: 1px solid #45475a;
   font-size: 0.9rem;
   cursor: pointer;
   transition: background 0.15s, border-color 0.15s;
}

.modal-btn.cancel {
   background: #313244;
   color: #cdd6f4;
}

.modal-btn.cancel:hover {
   background: #45475a;
}

.modal-btn.danger {
   background: #313244;
   border-color: #45475a;
   color: #f38ba8;
}

.modal-btn.danger:hover {
   background: #45475a;
   border-color: #f38ba8;
}

.modal-btn.confirm {
   background: #89b4fa;
   border-color: #89b4fa;
   color: #1e1e2e;
   font-weight: 600;
}

.modal-btn.confirm:hover:not(:disabled) {
   background: #b4d0fb;
}

.modal-btn.confirm:disabled {
   opacity: 0.4;
   cursor: default;
}
</style>
