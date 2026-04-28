<script setup>
import { useObservable } from '@vueuse/rxjs'

import Calendar from '/src/components/Calendar.vue'
import Calendar3 from '/src/components/Calendar3.vue'


import useSelection from '/src/use/useSelection';

import { app } from '/src/client-app.ts';

const { getObservable: selections$, create: createSelection } = useSelection(app);

const selections = useObservable(selections$({}))

const exampleRanges = [
   { label: 'Vacances', color: '#f38ba8', start: new Date(2026, 3, 1),  end: new Date(2026, 3, 10) },
   { label: 'Formation', color: '#a6e3a1', start: new Date(2026, 3, 7), end: new Date(2026, 3, 18) },
   { label: 'Férié',     color: '#fab387', start: new Date(2026, 3, 22), end: new Date(2026, 3, 22) },
]

function onSelect({ start, end }) {
   console.log('Selected range:', start, '→', end)
}

async function create() {
   const selection = await createSelection({
      text:'test',
      start: '1962-12-27',
      end: '1962-12-27',
      userUid: '1234azer',
   })
   console.log('selection', selection)
}
</script>

<template>
   {{ selections }}
   <Calendar @select="onSelect" />
   <Calendar3 :ranges="exampleRanges" @select="onSelect" />
   <!-- <button @click="create">create</button> -->
</template>
