<script setup>
import { ref } from 'vue'
import { useObservable } from '@vueuse/rxjs'
import { mdiCalendarPlus, mdiDelete } from '@mdi/js'

import RangeCalendar from '/src/components/RangeCalendar.vue'

import useRange from '/src/use/useRange';
import useUser from '/src/use/useUser';

import useExpressXClient from '/src/use/useExpressXClient.ts';

const { app } = useExpressXClient()
const { getObservable: ranges$, create: createRange, update: updateRange, remove: removeRange } = useRange(app);
const { findByUID: findUserByUID } = useUser(app);

const ranges = useObservable(ranges$({}))

const showModal = ref(false)
const labelInput = ref('')
const pendingRange = ref(null)
const selectedRangeUid = ref(null)
const calendarRef = ref(null)
const currentUserUid = localStorage.getItem('selommes_user_uid')

async function getCurrentUser() {
   const uid = localStorage.getItem('selommes_user_uid')
   if (!uid) throw new Error('Utilisateur non connecté')

   let user = null
   if (app.isConnected) {
      user = await app.service('user').findUnique({ uid })
      if (!user) {
         throw new Error("Le compte utilisateur n'est pas encore synchronisé")
      }
   } else {
      user = await findUserByUID(uid)
      if (!user) {
         const name = localStorage.getItem('selommes_user_name')
         const color = localStorage.getItem('selommes_user_color')
         if (name && color) user = { uid, name, color }
      }
   }

   if (!user?.name || !user?.color) {
      throw new Error('Le profil utilisateur est incomplet')
   }

   localStorage.setItem('selommes_user_name', user.name)
   localStorage.setItem('selommes_user_color', user.color)
   return user
}

function serializeDate(value) {
   const date = value instanceof Date ? value : new Date(value)
   if (Number.isNaN(date.getTime())) throw new Error('Date de plage invalide')
   return date.toISOString()
}

async function createCurrentUserRange(start, end) {
   const user = await getCurrentUser()
   return createRange({
      label: user.name,
      color: user.color,
      start: serializeDate(start),
      end: serializeDate(end),
      user_uid: user.uid,
   })
}

async function onNewRange({ start, end }) {
   console.log('select!')
   try {
      // labelInput.value = ''
      // showModal.value = true
      await createCurrentUserRange(start, end)
   } finally {
      calendarRef.value?.clearSelection()
   }
}

async function confirmCreate() {
   if (!pendingRange.value) return
   const { start, end } = pendingRange.value
   showModal.value = false
   pendingRange.value = null
   await createCurrentUserRange(start, end)
}

function cancelCreate() {
   showModal.value = false
}

function onSelectRange(uid) {
   if (!uid) {
      selectedRangeUid.value = null
      return
   }
   const range = ranges.value?.find(r => r.uid === uid)
   if (range?.user_uid === localStorage.getItem('selommes_user_uid')) {
      selectedRangeUid.value = uid
   } else {
      console.log('range clicked but belongs to another user:', uid)
      calendarRef.value?.clearSelection()
   }
}

async function onUpdateRange({ uid, start, end }) {
   console.log('update!')
   await updateRange(uid, { start, end })
   // calendarRef.value?.clearSelection()
}

async function deleteSelectedRange() {
   if (!selectedRangeUid.value) return
   await removeRange(selectedRangeUid.value)
   selectedRangeUid.value = null
   calendarRef.value?.clearSelection()
}
</script>

<template>
   <div class="app-wrapper">
      <header class="topbar">
         <div class="topbar-heading">
            <img class="topbar-icon" src="/selommes-icon.svg" alt="" />
            <span class="topbar-title">Selommes</span>
         </div>
         <button v-if="selectedRangeUid" class="topbar-btn topbar-btn--danger" title="Supprimer la plage" @click="deleteSelectedRange">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
               <path :d="mdiDelete" fill="currentColor" />
            </svg>
         </button>
         <!-- <button class="topbar-btn" title="Nouvelle plage" @click="onNewRange">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
               <path :d="mdiCalendarPlus" fill="currentColor" />
            </svg>
         </button> -->
      </header>

      <RangeCalendar
         ref="calendarRef"
         :ranges="ranges"
         :current-user-uid="currentUserUid"
         @new-range="onNewRange"
         @update="onUpdateRange"
         @range-selected="onSelectRange"
      />

      <div v-if="showModal" class="modal-backdrop" @click.self="cancelCreate">
         <div class="modal">
            <p class="modal-title">Texte à afficher</p>
            <input
               v-model="labelInput"
               class="modal-input"
               placeholder="ex: Vacances"
               autofocus
               @keydown.enter="confirmCreate"
               @keydown.esc="cancelCreate"
            />
            <div class="modal-actions">
               <button class="modal-btn cancel" @click="cancelCreate">Annuler</button>
               <button class="modal-btn confirm" :disabled="!labelInput.trim()" @click="confirmCreate">Créer</button>
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

.topbar-btn--danger:hover {
   border-color: #f38ba8;
   color: #f38ba8;
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
   z-index: 100;
}

.modal {
   background: #1e1e2e;
   border: 1px solid #313244;
   border-radius: 12px;
   padding: 1.5rem;
   min-width: 280px;
   display: flex;
   flex-direction: column;
   gap: 1rem;
}

.modal-title {
   margin: 0;
   font-size: 1rem;
   font-weight: 600;
   color: #cdd6f4;
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

.modal-actions {
   display: flex;
   justify-content: flex-end;
   gap: 0.5rem;
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
