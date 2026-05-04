<script setup>
import { useObservable } from '@vueuse/rxjs'
import { mdiCalendarPlus } from '@mdi/js'

import Calendar3 from '/src/components/Calendar3.vue'

import useRange from '/src/use/useRange';

import { app } from '/src/client-app.ts';

const { getObservable: ranges$, create: createRange } = useRange(app);

const ranges = useObservable(ranges$({}))

const exampleRanges = [
   { label: 'Vacances', color: '#f38ba8', start: new Date(2026, 4, 1),  end: new Date(2026, 4, 10) },
   { label: 'Formation', color: '#a6e3a1', start: new Date(2026, 4, 7), end: new Date(2026, 4, 18) },
   { label: 'Férié',     color: '#fab387', start: new Date(2026, 4, 22), end: new Date(2026, 4, 22) },
]

async function onSelect({ start, end }) {
   console.log('Selected range:', start, '→', end);
   const range = await createRange({
      label: "aaa",
      color: '#f38ba8',
      start, end,
      user_uid: '90282bfb-64dc-457c-88f8-525b527259e3',
   });
   console.log('range', range);
}
</script>

<template>
   <div class="app-wrapper">
      <header class="topbar">
         <span class="topbar-title">Selommes</span>
         <button class="topbar-btn" title="Nouvelle plage" @click="onNewRange">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
               <path :d="mdiCalendarPlus" fill="currentColor" />
            </svg>
         </button>
      </header>

      <Calendar3 :ranges="ranges" @select="onSelect" />
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

.topbar-title {
   font-size: 1.05rem;
   font-weight: 600;
   color: #cdd6f4;
   flex: 1;
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
</style>
